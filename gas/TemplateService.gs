/**
 * TemplateService.gs
 * 記事テンプレートを複数保存・管理するためのサービス（ArticleTemplatesシート）。
 * リポジトリ専用テンプレートと、全リポジトリ共通テンプレート（repositoryId === ''）の両方に対応します。
 */

function formatArticleTemplateRecord_(rec) {
  return {
    id: String(rec.id || ''),
    repositoryId: String(rec.repositoryId || ''),
    name: String(rec.name || ''),
    description: String(rec.description || ''),
    filenamePattern: String(rec.filenamePattern || '{slug}.md'),
    content: String(rec.content || ''),
    isDefault: parseBooleanCell_(rec.isDefault),
    createdAt: String(rec.createdAt || ''),
    updatedAt: String(rec.updatedAt || '')
  };
}

function validateArticleTemplateInput_(input) {
  if (!input || typeof input !== 'object') {
    throw createAppError_('VALIDATION_ERROR', 'テンプレートデータが不正です。', false);
  }

  var repositoryId = validateString_(input.repositoryId || '', '対象リポジトリID', {
    required: false,
    maxLength: 100
  });
  if (repositoryId) {
    getRepositoryByIdOrThrow_(repositoryId);
  }

  var name = validateString_(input.name, 'テンプレート名', {
    required: true,
    maxLength: 100
  });
  var description = validateString_(input.description || '', '説明', {
    required: false,
    maxLength: 300
  });
  var filenamePattern = validateString_(input.filenamePattern || '{slug}.md', 'ファイル名初期パターン', {
    required: false,
    maxLength: 150
  });
  var content = validateString_(input.content, 'テンプレート本文', {
    required: true,
    maxLength: 50000,
    trim: false
  });
  var isDefault = Boolean(input.isDefault);

  return {
    repositoryId: repositoryId,
    name: name,
    description: description,
    filenamePattern: filenamePattern,
    content: content,
    isDefault: isDefault
  };
}

/**
 * 記事テンプレート一覧を取得
 */
function listArticleTemplates_(params) {
  var p = params || {};
  var filterRepoId = p.repositoryId ? String(p.repositoryId).trim() : '';

  var records = getAllRecords_(CONFIG.SHEETS.ARTICLE_TEMPLATES);
  var list = [];

  for (var i = 0; i < records.length; i++) {
    var item = formatArticleTemplateRecord_(records[i]);
    // filterRepoId指定時は「共通テンプレート(空文字)」または「該当リポジトリ専用」を返す
    if (filterRepoId && item.repositoryId !== '' && item.repositoryId !== filterRepoId) {
      continue;
    }
    list.push(item);
  }

  list.sort(function(a, b) {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    return a.updatedAt < b.updatedAt ? 1 : -1;
  });

  return list;
}

/**
 * 記事テンプレートを新規作成
 */
function createArticleTemplate_(input, actorEmail) {
  return withScriptLock_(function() {
    var validated = validateArticleTemplateInput_(input);
    var now = nowIso_();
    var record = {
      id: generateId_('tpl'),
      repositoryId: validated.repositoryId,
      name: validated.name,
      description: validated.description,
      filenamePattern: validated.filenamePattern,
      content: validated.content,
      isDefault: validated.isDefault,
      createdAt: now,
      updatedAt: now
    };
    insertRecord_(CONFIG.SHEETS.ARTICLE_TEMPLATES, record);
    recordOperationLog_(
      actorEmail,
      'TEMPLATE_CREATE',
      'ArticleTemplate',
      record.id,
      '記事テンプレート「' + record.name + '」を作成しました。',
      'SUCCESS'
    );
    return formatArticleTemplateRecord_(record);
  });
}

/**
 * 記事テンプレートを更新
 */
function updateArticleTemplate_(id, input, actorEmail) {
  return withScriptLock_(function() {
    var targetId = validateString_(id, 'テンプレートID', { required: true });
    var validated = validateArticleTemplateInput_(input);
    var now = nowIso_();

    var updated = updateRecordById_(CONFIG.SHEETS.ARTICLE_TEMPLATES, targetId, function(existing) {
      return {
        id: existing.id,
        repositoryId: validated.repositoryId,
        name: validated.name,
        description: validated.description,
        filenamePattern: validated.filenamePattern,
        content: validated.content,
        isDefault: validated.isDefault,
        createdAt: existing.createdAt || now,
        updatedAt: now
      };
    });

    recordOperationLog_(
      actorEmail,
      'TEMPLATE_UPDATE',
      'ArticleTemplate',
      targetId,
      '記事テンプレート「' + updated.name + '」を更新しました。',
      'SUCCESS'
    );
    return formatArticleTemplateRecord_(updated);
  });
}

/**
 * 記事テンプレートを削除
 */
function deleteArticleTemplate_(id, actorEmail) {
  return withScriptLock_(function() {
    var targetId = validateString_(id, 'テンプレートID', { required: true });
    var deleted = deleteRecordById_(CONFIG.SHEETS.ARTICLE_TEMPLATES, targetId);
    recordOperationLog_(
      actorEmail,
      'TEMPLATE_DELETE',
      'ArticleTemplate',
      targetId,
      '記事テンプレート「' + deleted.name + '」を削除しました。',
      'SUCCESS'
    );
    return { deletedId: targetId };
  });
}
