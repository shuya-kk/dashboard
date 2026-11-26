/**
 * AppService.gs
 * Applicationsシート（アプリ情報マスター）のCRUD処理を提供します。
 */

function formatApplicationRecord_(rec) {
  return {
    id: String(rec.id || ''),
    name: String(rec.name || ''),
    bundleId: String(rec.bundleId || ''),
    appStoreUrl: String(rec.appStoreUrl || ''),
    isActive: parseBooleanCell_(rec.isActive),
    createdAt: String(rec.createdAt || ''),
    updatedAt: String(rec.updatedAt || ''),
    ascAppId: String(rec.ascAppId || ''),
    sku: String(rec.sku || ''),
    latestVersion: String(rec.latestVersion || ''),
    appStoreState: String(rec.appStoreState || ''),
    platform: String(rec.platform || '')
  };
}

function validateApplicationInput_(input) {
  if (!input || typeof input !== 'object') {
    throw createAppError_('VALIDATION_ERROR', 'アプリデータが不正です。', false);
  }
  var name = validateString_(input.name, 'アプリ名', { required: true, maxLength: 100 });
  var bundleId = validateString_(input.bundleId, 'Bundle ID / 識別子', {
    required: true,
    maxLength: 150,
    pattern: /^[a-zA-Z0-9._-]+$/,
    patternMessage: 'Bundle ID / 識別子は英数字・ドット・ハイフン・アンダースコア（例: com.example.myapp）で入力してください。'
  });
  var appStoreUrl = validateString_(input.appStoreUrl || '', 'ストア / 公開URL', {
    required: false,
    maxLength: 300
  });
  if (appStoreUrl && !/^https?:\/\/.+/i.test(appStoreUrl)) {
    throw createAppError_('VALIDATION_ERROR', 'ストア / 公開URLは http:// または https:// から始まるURLを入力してください。', false);
  }
  var isActive = input.isActive === undefined ? true : Boolean(input.isActive);

  return {
    name: name,
    bundleId: bundleId,
    appStoreUrl: appStoreUrl,
    isActive: isActive
  };
}

function listApplications_() {
  var records = getAllRecords_(CONFIG.SHEETS.APPLICATIONS);
  var list = [];
  for (var i = 0; i < records.length; i++) {
    list.push(formatApplicationRecord_(records[i]));
  }
  list.sort(function(a, b) {
    return a.createdAt < b.createdAt ? 1 : -1;
  });
  return list;
}

function getApplicationByIdOrThrow_(appId) {
  var rec = findRecordById_(CONFIG.SHEETS.APPLICATIONS, appId);
  if (!rec) {
    throw createAppError_('NOT_FOUND', '指定されたアプリ（ID: ' + appId + '）が存在しません。', false);
  }
  return formatApplicationRecord_(rec);
}

function createApplication_(input, actorEmail) {
  return withScriptLock_(function() {
    var validated = validateApplicationInput_(input);
    var now = nowIso_();
    var record = {
      id: generateId_('app'),
      name: validated.name,
      bundleId: validated.bundleId,
      appStoreUrl: validated.appStoreUrl,
      isActive: validated.isActive,
      createdAt: now,
      updatedAt: now
    };
    insertRecord_(CONFIG.SHEETS.APPLICATIONS, record);
    recordOperationLog_(
      actorEmail,
      'APP_CREATE',
      'Application',
      record.id,
      'アプリ「' + record.name + '」(' + record.bundleId + ') を登録しました。',
      'SUCCESS'
    );
    return formatApplicationRecord_(record);
  });
}

function updateApplication_(id, input, actorEmail) {
  return withScriptLock_(function() {
    var targetId = validateString_(id, 'アプリID', { required: true });
    var validated = validateApplicationInput_(input);
    var now = nowIso_();

    var updated = updateRecordById_(CONFIG.SHEETS.APPLICATIONS, targetId, function(existing) {
      return {
        id: existing.id,
        name: validated.name,
        bundleId: validated.bundleId,
        appStoreUrl: validated.appStoreUrl,
        isActive: validated.isActive,
        createdAt: existing.createdAt || now,
        updatedAt: now,
        ascAppId: existing.ascAppId || '',
        sku: existing.sku || '',
        latestVersion: existing.latestVersion || '',
        appStoreState: existing.appStoreState || '',
        platform: existing.platform || ''
      };
    });

    recordOperationLog_(
      actorEmail,
      'APP_UPDATE',
      'Application',
      targetId,
      'アプリ「' + updated.name + '」を更新しました。',
      'SUCCESS'
    );
    return formatApplicationRecord_(updated);
  });
}

function deleteApplication_(id, actorEmail) {
  return withScriptLock_(function() {
    var targetId = validateString_(id, 'アプリID', { required: true });
    var deleted = deleteRecordById_(CONFIG.SHEETS.APPLICATIONS, targetId);
    recordOperationLog_(
      actorEmail,
      'APP_DELETE',
      'Application',
      targetId,
      'アプリ「' + deleted.name + '」を削除しました。',
      'SUCCESS'
    );
    return { deletedId: targetId };
  });
}
