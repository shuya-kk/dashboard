/**
 * InquiryService.gs
 * Inquiriesシートを利用したお問い合わせ管理（一覧・詳細・対応状況変更・管理者メモ編集）
 * および公開APIからの新規問い合わせ受付（バリデーション・レート制限・重複送信防止）を提供します。
 */

function formatInquiryRecord_(rec) {
  return {
    id: String(rec.id || ''),
    appId: String(rec.appId || ''),
    name: String(rec.name || ''),
    email: String(rec.email || ''),
    subject: String(rec.subject || ''),
    message: String(rec.message || ''),
    createdAt: String(rec.createdAt || ''),
    status: String(rec.status || '未対応'),
    adminMemo: String(rec.adminMemo || ''),
    updatedAt: String(rec.updatedAt || rec.createdAt || '')
  };
}

/**
 * 管理画面用：お問い合わせ一覧を取得
 */
function listInquiries_(filterParams) {
  var f = filterParams || {};
  var filterAppId = f.appId ? String(f.appId).trim() : '';
  var filterStatus = f.status ? String(f.status).trim() : '';
  var keyword = f.keyword ? String(f.keyword).trim().toLowerCase() : '';

  var records = getAllRecords_(CONFIG.SHEETS.INQUIRIES);
  var list = [];

  for (var i = 0; i < records.length; i++) {
    var item = formatInquiryRecord_(records[i]);
    if (filterAppId && item.appId !== filterAppId) continue;
    if (filterStatus && item.status !== filterStatus) continue;
    if (keyword) {
      var haystack = (
        item.name + ' ' +
        item.email + ' ' +
        item.subject + ' ' +
        item.message + ' ' +
        item.adminMemo
      ).toLowerCase();
      if (haystack.indexOf(keyword) === -1) continue;
    }
    list.push(item);
  }

  // 作成日時の降順（最新が先頭）
  list.sort(function(a, b) {
    return a.createdAt < b.createdAt ? 1 : -1;
  });

  return list;
}

/**
 * 管理画面用：お問い合わせのステータスおよび管理者メモを更新（問い合わせ本文とは独立して保存）
 */
function updateInquiryAdmin_(id, input, actorEmail) {
  return withScriptLock_(function() {
    var targetId = validateString_(id, 'お問い合わせID', { required: true });
    if (!input || typeof input !== 'object') {
      throw createAppError_('VALIDATION_ERROR', '更新データが不正です。', false);
    }

    var status = validateString_(input.status, '対応状況', { required: true });
    if (CONFIG.INQUIRY_STATUSES.indexOf(status) === -1) {
      throw createAppError_(
        'VALIDATION_ERROR',
        '対応状況は「未対応」「対応中」「完了」のいずれかを指定してください。',
        false
      );
    }

    var adminMemo = validateString_(input.adminMemo || '', '管理者メモ', {
      required: false,
      maxLength: CONFIG.LIMITS.ADMIN_MEMO_MAX
    });

    var now = nowIso_();
    var updated = updateRecordById_(CONFIG.SHEETS.INQUIRIES, targetId, function(existing) {
      return {
        id: existing.id,
        appId: existing.appId,
        name: existing.name,
        email: existing.email,
        subject: existing.subject,
        message: existing.message,
        createdAt: existing.createdAt,
        status: status,
        adminMemo: adminMemo,
        updatedAt: now
      };
    });

    recordOperationLog_(
      actorEmail,
      'INQUIRY_UPDATE',
      'Inquiry',
      targetId,
      'お問い合わせ「' + updated.subject + '」の対応状況を「' + status + '」に更新しました。',
      'SUCCESS'
    );
    return formatInquiryRecord_(updated);
  });
}

/**
 * 公開API用：新規お問い合わせを受け付けて検証・保存する
 * 必須項目、メール形式、最大文字数、アプリIDの存在（有効状態）、送信頻度制限、重複送信対策を実施します。
 */
function submitPublicInquiry_(payload) {
  if (!payload || typeof payload !== 'object') {
    throw createAppError_('VALIDATION_ERROR', 'リクエスト形式が不正です。', false);
  }

  // ハニーポット（bot対策用隠しフィールドに値が入っていた場合は拒否）
  if (payload.website && String(payload.website).trim() !== '') {
    throw createAppError_('SPAM_DETECTED', '不正な送信が検出されました。', false);
  }

  var appId = validateString_(payload.appId, 'アプリID (appId)', { required: true, maxLength: 100 });
  var name = validateString_(payload.name, 'お名前 (name)', {
    required: true,
    maxLength: CONFIG.LIMITS.INQUIRY_NAME_MAX
  });
  var email = validateEmail_(payload.email, 'メールアドレス (email)');
  var subject = validateString_(payload.subject, '件名 (subject)', {
    required: true,
    maxLength: CONFIG.LIMITS.INQUIRY_SUBJECT_MAX
  });
  var message = validateString_(payload.message, 'お問い合わせ内容 (message)', {
    required: true,
    maxLength: CONFIG.LIMITS.INQUIRY_MESSAGE_MAX
  });

  // 制御文字（改行・タブ以外）が含まれていないか検証
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(name + subject + message)) {
    throw createAppError_('VALIDATION_ERROR', '入力内容に使用できない制御文字が含まれています。', false);
  }

  // アプリIDの存在と有効状態を確認
  var appRecord = findRecordById_(CONFIG.SHEETS.APPLICATIONS, appId);
  if (!appRecord || !parseBooleanCell_(appRecord.isActive)) {
    throw createAppError_('INVALID_APP_ID', '指定されたアプリIDは存在しないか、現在受付を停止しています。', false);
  }

  // スパム対策1：同一内容の重複送信チェック（30分以内）
  var cache = CacheService.getScriptCache();
  var contentHash = computeSha256Hex_(appId + '|' + email.toLowerCase() + '|' + subject + '|' + message);
  var dupKey = 'inq_dup_' + contentHash.substring(0, 32);
  if (cache.get(dupKey)) {
    throw createAppError_(
      'DUPLICATE_SUBMISSION',
      '同一内容のお問い合わせが既に送信されています。しばらくお待ちください。',
      false
    );
  }

  // スパム対策2：メールアドレスおよびアプリ単位の送信頻度制限（10分間に3回まで）
  var rateHash = computeSha256Hex_(email.toLowerCase()).substring(0, 24);
  var rateKey = 'inq_rate_' + rateHash;
  var currentCount = Number(cache.get(rateKey) || '0');
  if (currentCount >= CONFIG.RATE_LIMIT.INQUIRY_MAX_PER_WINDOW) {
    throw createAppError_(
      'RATE_LIMIT_EXCEEDED',
      '短時間に送信回数の上限に達しました。10分ほど時間をおいてから再度お試しください。',
      true
    );
  }

  return withScriptLock_(function() {
    var now = nowIso_();
    var newInquiry = {
      id: generateId_('inq'),
      appId: appId,
      name: name,
      email: email,
      subject: subject,
      message: message,
      createdAt: now,
      status: '未対応',
      adminMemo: '',
      updatedAt: now
    };

    insertRecord_(CONFIG.SHEETS.INQUIRIES, newInquiry);

    // レート制限カウンタと重複防止キーを更新
    cache.put(dupKey, '1', CONFIG.RATE_LIMIT.DUPLICATE_TTL_SECONDS);
    cache.put(rateKey, String(currentCount + 1), CONFIG.RATE_LIMIT.INQUIRY_WINDOW_SECONDS);

    return {
      inquiryId: newInquiry.id,
      receivedAt: now
    };
  });
}
