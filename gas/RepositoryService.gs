/**
 * RepositoryService.gs
 * GitHubリポジトリ設定（Repositoriesシート）のCRUDとバリデーションを提供します。
 * トークンそのものは一切保持・返却せず、Script Propertiesの参照キー（GITHUB_TOKEN_*）のみを扱います。
 */

/**
 * シート行オブジェクトをフロントエンド用Repository型に整形
 */
function formatRepositoryRecord_(rec) {
  return {
    id: String(rec.id || ''),
    displayName: String(rec.displayName || ''),
    owner: String(rec.owner || ''),
    repo: String(rec.repo || ''),
    branch: String(rec.branch || 'main'),
    articlesDir: String(rec.articlesDir || ''),
    imagesDir: String(rec.imagesDir || 'public/images'),
    markdownExt: String(rec.markdownExt || '.md'),
    frontmatterFormat: String(rec.frontmatterFormat || 'yaml'),
    defaultTemplate: String(rec.defaultTemplate || ''),
    siteUrl: String(rec.siteUrl || ''),
    articleUrlPattern: String(rec.articleUrlPattern || '{siteUrl}/posts/{slug}'),
    tokenPropertyKey: String(rec.tokenPropertyKey || 'GITHUB_TOKEN_PORTFOLIO'),
    isActive: parseBooleanCell_(rec.isActive),
    createdAt: String(rec.createdAt || ''),
    updatedAt: String(rec.updatedAt || '')
  };
}

/**
 * リポジトリ入力値の検証
 */
function validateRepositoryInput_(input) {
  if (!input || typeof input !== 'object') {
    throw createAppError_('VALIDATION_ERROR', 'リポジトリ設定データが不正です。', false);
  }

  var displayName = validateString_(input.displayName, '表示名', { required: true, maxLength: 100 });
  var owner = validateString_(input.owner, 'GitHubオーナー', {
    required: true,
    maxLength: 100,
    pattern: /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/,
    patternMessage: 'GitHubオーナー名は有効なGitHubユーザー名またはOrganization名で入力してください。'
  });
  var repo = validateString_(input.repo, 'リポジトリ名', {
    required: true,
    maxLength: 100,
    pattern: /^[a-zA-Z0-9._-]+$/,
    patternMessage: 'リポジトリ名は英数字・ハイフン・アンダースコア・ドットで入力してください。'
  });
  var branch = validateString_(input.branch || 'main', 'ブランチ名', {
    required: true,
    maxLength: 100
  });

  var articlesDir = validateString_(input.articlesDir || '', '記事保存ディレクトリ', {
    required: false,
    maxLength: 200
  }).replace(/^\/+|\/+$/g, '');

  var imagesDir = validateString_(input.imagesDir || 'public/images', '画像保存ディレクトリ', {
    required: false,
    maxLength: 200
  }).replace(/^\/+|\/+$/g, '');

  var markdownExt = validateString_(input.markdownExt || '.md', 'Markdown拡張子', {
    required: true,
    maxLength: 10
  });
  if (markdownExt !== '.md' && markdownExt !== '.mdx' && markdownExt !== '.markdown') {
    throw createAppError_('VALIDATION_ERROR', 'Markdown拡張子は .md / .mdx / .markdown のいずれかを指定してください。', false);
  }

  var frontmatterFormat = validateString_(input.frontmatterFormat || 'yaml', 'Frontmatter形式', {
    required: true,
    maxLength: 20
  }).toLowerCase();
  if (frontmatterFormat !== 'yaml' && frontmatterFormat !== 'toml' && frontmatterFormat !== 'json' && frontmatterFormat !== 'none') {
    throw createAppError_('VALIDATION_ERROR', 'Frontmatter形式は yaml / toml / json / none のいずれかを指定してください。', false);
  }

  var defaultTemplate = validateString_(input.defaultTemplate || '', '新規記事テンプレート', {
    required: false,
    maxLength: 10000,
    trim: false
  });

  var siteUrl = validateString_(input.siteUrl || '', '公開サイトURL', {
    required: false,
    maxLength: 300
  }).replace(/\/+$/, '');

  var articleUrlPattern = validateString_(input.articleUrlPattern || '{siteUrl}/posts/{slug}', '記事URL生成規則', {
    required: false,
    maxLength: 300
  });

  var tokenPropertyKey = validateString_(input.tokenPropertyKey, 'GitHubトークン参照キー', {
    required: true,
    maxLength: 100,
    pattern: /^GITHUB_TOKEN_[A-Z0-9_]+$/,
    patternMessage: 'GitHubトークン参照キーは "GITHUB_TOKEN_" で始まる大文字英数字・アンダースコア（例: GITHUB_TOKEN_PORTFOLIO）で指定してください。'
  });

  var isActive = input.isActive === undefined ? true : Boolean(input.isActive);

  return {
    displayName: displayName,
    owner: owner,
    repo: repo,
    branch: branch,
    articlesDir: articlesDir,
    imagesDir: imagesDir,
    markdownExt: markdownExt,
    frontmatterFormat: frontmatterFormat,
    defaultTemplate: defaultTemplate,
    siteUrl: siteUrl,
    articleUrlPattern: articleUrlPattern,
    tokenPropertyKey: tokenPropertyKey,
    isActive: isActive
  };
}

/**
 * 登録リポジトリ一覧を取得
 */
function listRepositories_() {
  var records = getAllRecords_(CONFIG.SHEETS.REPOSITORIES);
  var list = [];
  for (var i = 0; i < records.length; i++) {
    list.push(formatRepositoryRecord_(records[i]));
  }
  return list;
}

/**
 * ID指定でリポジトリ設定を取得（内部用・存在チェック付き）
 */
function getRepositoryByIdOrThrow_(repoId) {
  var rec = findRecordById_(CONFIG.SHEETS.REPOSITORIES, repoId);
  if (!rec) {
    throw createAppError_('NOT_FOUND', '指定されたリポジトリ設定（ID: ' + repoId + '）が見つかりません。', false);
  }
  return formatRepositoryRecord_(rec);
}

/**
 * リポジトリを新規登録
 */
function createRepository_(input, actorEmail) {
  return withScriptLock_(function() {
    var validated = validateRepositoryInput_(input);
    var now = nowIso_();
    var record = {
      id: generateId_('repo'),
      displayName: validated.displayName,
      owner: validated.owner,
      repo: validated.repo,
      branch: validated.branch,
      articlesDir: validated.articlesDir,
      imagesDir: validated.imagesDir,
      markdownExt: validated.markdownExt,
      frontmatterFormat: validated.frontmatterFormat,
      defaultTemplate: validated.defaultTemplate,
      siteUrl: validated.siteUrl,
      articleUrlPattern: validated.articleUrlPattern,
      tokenPropertyKey: validated.tokenPropertyKey,
      isActive: validated.isActive,
      createdAt: now,
      updatedAt: now
    };
    insertRecord_(CONFIG.SHEETS.REPOSITORIES, record);
    recordOperationLog_(
      actorEmail,
      'REPOSITORY_CREATE',
      'Repository',
      record.id,
      'リポジトリ「' + record.displayName + '」(' + record.owner + '/' + record.repo + ') を追加しました。',
      'SUCCESS'
    );
    return formatRepositoryRecord_(record);
  });
}

/**
 * リポジトリ設定を更新
 */
function updateRepository_(id, input, actorEmail) {
  return withScriptLock_(function() {
    var targetId = validateString_(id, 'リポジトリID', { required: true });
    var validated = validateRepositoryInput_(input);
    var now = nowIso_();

    var updated = updateRecordById_(CONFIG.SHEETS.REPOSITORIES, targetId, function(existing) {
      return {
        id: existing.id,
        displayName: validated.displayName,
        owner: validated.owner,
        repo: validated.repo,
        branch: validated.branch,
        articlesDir: validated.articlesDir,
        imagesDir: validated.imagesDir,
        markdownExt: validated.markdownExt,
        frontmatterFormat: validated.frontmatterFormat,
        defaultTemplate: validated.defaultTemplate,
        siteUrl: validated.siteUrl,
        articleUrlPattern: validated.articleUrlPattern,
        tokenPropertyKey: validated.tokenPropertyKey,
        isActive: validated.isActive,
        createdAt: existing.createdAt || now,
        updatedAt: now
      };
    });

    recordOperationLog_(
      actorEmail,
      'REPOSITORY_UPDATE',
      'Repository',
      targetId,
      'リポジトリ「' + updated.displayName + '」の設定を更新しました。',
      'SUCCESS'
    );
    return formatRepositoryRecord_(updated);
  });
}

/**
 * リポジトリ設定を削除（GitHub上のファイルは削除せず、管理対象登録のみ解除）
 */
function deleteRepository_(id, actorEmail) {
  return withScriptLock_(function() {
    var targetId = validateString_(id, 'リポジトリID', { required: true });
    var deleted = deleteRecordById_(CONFIG.SHEETS.REPOSITORIES, targetId);
    recordOperationLog_(
      actorEmail,
      'REPOSITORY_DELETE',
      'Repository',
      targetId,
      'リポジトリ「' + deleted.displayName + '」の登録を削除しました。',
      'SUCCESS'
    );
    return { deletedId: targetId };
  });
}
