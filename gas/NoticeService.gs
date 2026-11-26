/**
 * NoticeService.gs
 * Noticesシートを利用したアプリ別お知らせ管理、公開予約、および時間主導型トリガーによる自動公開処理を提供します。
 */

function formatNoticeRecord_(rec) {
  return {
    id: String(rec.id || ''),
    appId: String(rec.appId || ''),
    title: String(rec.title || ''),
    body: String(rec.body || ''),
    createdAt: String(rec.createdAt || ''),
    publishedAt: String(rec.publishedAt || ''),
    status: String(rec.status || 'draft'),
    updatedAt: String(rec.updatedAt || '')
  };
}

function validateNoticeInput_(input) {
  if (!input || typeof input !== 'object') {
    throw createAppError_('VALIDATION_ERROR', 'お知らせデータが不正です。', false);
  }

  var appId = validateString_(input.appId, '対象アプリID', { required: true });
  // アプリマスターの存在確認
  getApplicationByIdOrThrow_(appId);

  var title = validateString_(input.title, 'タイトル', {
    required: true,
    maxLength: CONFIG.LIMITS.NOTICE_TITLE_MAX
  });
  var body = validateString_(input.body, '本文', {
    required: true,
    maxLength: CONFIG.LIMITS.NOTICE_BODY_MAX
  });
  var status = validateString_(input.status || 'draft', 'ステータス', { required: true });
  if (CONFIG.NOTICE_STATUSES.indexOf(status) === -1) {
    throw createAppError_(
      'VALIDATION_ERROR',
      'お知らせのステータスは draft / scheduled / published / archived のいずれかを指定してください。',
      false
    );
  }

  var publishedAt = normalizeIsoDate_(input.publishedAt, '公開日時', status !== 'scheduled');

  if (status === 'published' && !publishedAt) {
    publishedAt = nowIso_();
  }

  if (status === 'scheduled') {
    var pubTime = new Date(publishedAt).getTime();
    if (isNaN(pubTime)) {
      throw createAppError_('VALIDATION_ERROR', '公開予約（scheduled）には有効な公開予定日時が必要です。', false);
    }
  }

  return {
    appId: appId,
    title: title,
    body: body,
    status: status,
    publishedAt: publishedAt
  };
}

/**
 * お知らせ一覧を取得（実行時に公開予約時刻を過ぎているものがあれば自動昇格も反映可能）
 */
function listNotices_(filterParams) {
  // 一覧取得前に期限到来済みのscheduledがあれば安全に公開へ昇格させる
  processScheduledNoticesInternal_();

  var f = filterParams || {};
  var filterAppId = f.appId ? String(f.appId).trim() : '';
  var filterStatus = f.status ? String(f.status).trim() : '';

  var records = getAllRecords_(CONFIG.SHEETS.NOTICES);
  var list = [];
  for (var i = 0; i < records.length; i++) {
    var item = formatNoticeRecord_(records[i]);
    if (filterAppId && item.appId !== filterAppId) continue;
    if (filterStatus && item.status !== filterStatus) continue;
    list.push(item);
  }

  // 更新日時または作成日時の降順
  list.sort(function(a, b) {
    var keyA = a.publishedAt || a.updatedAt || a.createdAt;
    var keyB = b.publishedAt || b.updatedAt || b.createdAt;
    return keyA < keyB ? 1 : -1;
  });

  return list;
}

/**
 * お知らせを新規作成
 */
function createNotice_(input, actorEmail) {
  return withScriptLock_(function() {
    var validated = validateNoticeInput_(input);
    var now = nowIso_();
    var record = {
      id: generateId_('ntc'),
      appId: validated.appId,
      title: validated.title,
      body: validated.body,
      createdAt: now,
      publishedAt: validated.publishedAt,
      status: validated.status,
      updatedAt: now
    };
    insertRecord_(CONFIG.SHEETS.NOTICES, record);
    recordOperationLog_(
      actorEmail,
      'NOTICE_CREATE',
      'Notice',
      record.id,
      'お知らせ「' + record.title + '」（状態: ' + record.status + '）を作成しました。',
      'SUCCESS'
    );
    return formatNoticeRecord_(record);
  });
}

/**
 * お知らせを更新（公開状態変更・公開予約・公開日時変更すべてに対応）
 */
function updateNotice_(id, input, actorEmail) {
  return withScriptLock_(function() {
    var targetId = validateString_(id, 'お知らせID', { required: true });
    var validated = validateNoticeInput_(input);
    var now = nowIso_();

    var updated = updateRecordById_(CONFIG.SHEETS.NOTICES, targetId, function(existing) {
      return {
        id: existing.id,
        appId: validated.appId,
        title: validated.title,
        body: validated.body,
        createdAt: existing.createdAt || now,
        publishedAt: validated.publishedAt,
        status: validated.status,
        updatedAt: now
      };
    });

    recordOperationLog_(
      actorEmail,
      'NOTICE_UPDATE',
      'Notice',
      targetId,
      'お知らせ「' + updated.title + '」（状態: ' + updated.status + '）を更新しました。',
      'SUCCESS'
    );
    return formatNoticeRecord_(updated);
  });
}

/**
 * お知らせを削除
 */
function deleteNotice_(id, actorEmail) {
  return withScriptLock_(function() {
    var targetId = validateString_(id, 'お知らせID', { required: true });
    var deleted = deleteRecordById_(CONFIG.SHEETS.NOTICES, targetId);
    recordOperationLog_(
      actorEmail,
      'NOTICE_DELETE',
      'Notice',
      targetId,
      'お知らせ「' + deleted.title + '」を削除しました。',
      'SUCCESS'
    );
    return { deletedId: targetId };
  });
}

/**
 * 公開予約日時を過ぎたお知らせ（status === 'scheduled' かつ publishedAt <= 現在時刻）を公開状態に変更する内部処理
 * トリガーの実行時刻は厳密な保証がないため、実行時に公開条件を再確認します。
 */
function processScheduledNoticesInternal_() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    return { publishedCount: 0, publishedIds: [] };
  }
  try {
    var sheet = getSheetByNameSafe_(CONFIG.SHEETS.NOTICES);
    var headers = CONFIG.HEADERS.Notices;
    var records = getAllRecords_(CONFIG.SHEETS.NOTICES);
    var nowMs = Date.now();
    var nowStr = new Date(nowMs).toISOString();
    var publishedIds = [];

    for (var i = 0; i < records.length; i++) {
      var rec = records[i];
      if (String(rec.status) !== 'scheduled') continue;
      if (!rec.publishedAt) continue;

      var pubMs = new Date(String(rec.publishedAt)).getTime();
      if (isNaN(pubMs)) continue;

      // 公開予定日時を過ぎていることを厳密に再確認
      if (pubMs <= nowMs) {
        rec.status = 'published';
        rec.updatedAt = nowStr;
        var row = [];
        for (var c = 0; c < headers.length; c++) {
          row.push(sanitizeForSheetCell_(rec[headers[c]]));
        }
        sheet.getRange(rec._rowIndex, 1, 1, headers.length).setValues([row]);
        publishedIds.push(rec.id);
        recordOperationLog_(
          'system-trigger',
          'NOTICE_AUTO_PUBLISH',
          'Notice',
          rec.id,
          '公開予約日時到来によりお知らせ「' + rec.title + '」を自動公開しました。',
          'SUCCESS'
        );
      }
    }

    return {
      publishedCount: publishedIds.length,
      publishedIds: publishedIds
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * GAS時間主導型トリガーから呼び出される公開予約チェック関数（トップレベル関数）
 */
function publishScheduledNoticesTrigger() {
  return processScheduledNoticesInternal_();
}

/**
 * 時間主導型トリガー（5分おき）を登録または確認する関数
 */
function ensureScheduledNoticesTrigger_(actorEmail) {
  var triggers = ScriptApp.getProjectTriggers();
  var exists = false;
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'publishScheduledNoticesTrigger') {
      exists = true;
      break;
    }
  }
  if (!exists) {
    ScriptApp.newTrigger('publishScheduledNoticesTrigger')
      .timeBased()
      .everyMinutes(5)
      .create();
    recordOperationLog_(
      actorEmail || 'system',
      'TRIGGER_SETUP',
      'Trigger',
      'publishScheduledNoticesTrigger',
      'お知らせ公開予約用の時間主導型トリガー（5分間隔）を設定しました。',
      'SUCCESS'
    );
  }
  return {
    handlerFunction: 'publishScheduledNoticesTrigger',
    alreadyExisted: exists,
    active: true
  };
}
