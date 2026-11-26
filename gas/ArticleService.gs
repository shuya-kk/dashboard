/**
 * ArticleService.gs
 * GitHub APIを用いた記事一覧取得、記事詳細取得、新規作成、更新（SHA競合検知・差分提示付き）、削除、
 * およびリポジトリ内への画像アップロードを担当します。
 */

/**
 * ファイルパスが対象リポジトリの記事ディレクトリ・拡張子に一致するか判定
 */
function isArticleMarkdownPath_(path, repoConfig) {
  var p = String(path || '');
  var dir = String(repoConfig.articlesDir || '').replace(/^\/+|\/+$/g, '');
  if (dir) {
    if (p.indexOf(dir + '/') !== 0) {
      return false;
    }
  }
  var ext = String(repoConfig.markdownExt || '.md').toLowerCase();
  var lowerPath = p.toLowerCase();
  if (ext === '.md') {
    return lowerPath.slice(-3) === '.md' || lowerPath.slice(-4) === '.mdx';
  }
  return lowerPath.slice(-ext.length) === ext;
}

/**
 * ファイルパスとリポジトリ設定から公開ページURLとGitHubファイルURLを生成
 */
function buildArticleUrls_(repoConfig, filePath) {
  var dir = String(repoConfig.articlesDir || '').replace(/^\/+|\/+$/g, '');
  var relPath = String(filePath || '');
  if (dir && relPath.indexOf(dir + '/') === 0) {
    relPath = relPath.substring(dir.length + 1);
  }
  var slug = relPath.replace(/\.(mdx|markdown|md)$/i, '');
  var filename = relPath.split('/').pop().replace(/\.(mdx|markdown|md)$/i, '');

  var githubUrl =
    'https://github.com/' +
    encodeURIComponent(repoConfig.owner) +
    '/' +
    encodeURIComponent(repoConfig.repo) +
    '/blob/' +
    encodeURIComponent(repoConfig.branch || 'main') +
    '/' +
    filePath;

  var publicUrl = '';
  if (repoConfig.siteUrl) {
    var pattern = repoConfig.articleUrlPattern || '{siteUrl}/posts/{slug}';
    publicUrl = pattern
      .replace(/\{siteUrl\}/g, repoConfig.siteUrl.replace(/\/+$/, ''))
      .replace(/\{slug\}/g, slug)
      .replace(/\{filename\}/g, filename)
      .replace(/\{path\}/g, relPath);
  }

  return {
    slug: slug,
    filename: filename,
    githubUrl: githubUrl,
    publicUrl: publicUrl
  };
}

/**
 * Markdownテキストからタイトル・日付・下書き状態などの簡易メタ情報を抽出
 */
function extractMarkdownMetadata_(content) {
  var text = String(content || '');
  var title = '';
  var date = '';
  var draft = false;

  // YAML Frontmatter (--- ... ---) または TOML (+++ ... +++)
  var fmMatch = text.match(/^(?:---|\+\+\+)\r?\n([\s\S]*?)\r?\n(?:---|\+\+\+)/);
  if (fmMatch) {
    var fm = fmMatch[1];
    var titleMatch = fm.match(/^\s*title\s*[:=]\s*["']?([^"'\r\n]+)["']?\s*$/m);
    if (titleMatch) title = titleMatch[1].trim();

    var dateMatch = fm.match(/^\s*(?:date|pubDate|publishedAt|updatedAt|createdAt)\s*[:=]\s*["']?([^"'\r\n]+)["']?\s*$/m);
    if (dateMatch) date = dateMatch[1].trim();

    var draftMatch = fm.match(/^\s*draft\s*[:=]\s*(true|false)\s*$/im);
    if (draftMatch) draft = draftMatch[1].toLowerCase() === 'true';
  }

  // Frontmatterにタイトルがない場合は最初の # 見出しを参照
  if (!title) {
    var h1Match = text.match(/^#\s+(.+)$/m);
    if (h1Match) {
      title = h1Match[1].trim();
    }
  }

  return {
    title: title,
    date: date,
    draft: draft
  };
}

/**
 * 指定リポジトリの記事一覧を取得（短期キャッシュ対応・強制再取得フラグ付き）
 */
function listArticles_(params) {
  var p = params || {};
  var repoId = validateString_(p.repositoryId, 'リポジトリID', { required: true });
  var forceRefresh = Boolean(p.forceRefresh);
  var repoConfig = getRepositoryByIdOrThrow_(repoId);

  var cache = CacheService.getScriptCache();
  var cacheKey = 'articles_tree_' + repoId;

  if (!forceRefresh) {
    var cachedJson = cache.get(cacheKey);
    if (cachedJson) {
      try {
        return JSON.parse(cachedJson);
      } catch (e) {
        // キャッシュ破損時は再取得
      }
    }
  }

  var treeData = fetchGitHubRepoTree_(repoConfig);
  var treeItems = (treeData && Array.isArray(treeData.tree)) ? treeData.tree : [];
  var articles = [];

  for (var i = 0; i < treeItems.length; i++) {
    var item = treeItems[i];
    if (item.type !== 'blob') continue;
    if (!isArticleMarkdownPath_(item.path, repoConfig)) continue;

    var urls = buildArticleUrls_(repoConfig, item.path);
    articles.push({
      path: item.path,
      sha: item.sha,
      size: item.size || 0,
      slug: urls.slug,
      filename: urls.filename,
      title: urls.filename, // 一覧高速取得時はファイル名を初期タイトルとし、上位件数または詳細取得でFrontmatterタイトルを補完
      updatedAt: '',
      githubUrl: urls.githubUrl,
      publicUrl: urls.publicUrl
    });
  }

  // ファイル数が30件以下の場合は、最新コミット情報やFrontmatterタイトルを軽量補完（GASの実行時間とAPI制限を保護するため上限20件まで）
  var enrichLimit = Math.min(articles.length, 15);
  for (var j = 0; j < enrichLimit; j++) {
    try {
      var commitInfo = fetchLatestCommitForPath_(repoConfig, articles[j].path);
      if (commitInfo && commitInfo.date) {
        articles[j].updatedAt = commitInfo.date;
      }
    } catch (e2) {
      // コミット日時取得失敗時も一覧全体は失敗させない
    }
  }

  // 更新日時降順（日時がない場合はパス降順）でソート
  articles.sort(function(a, b) {
    if (a.updatedAt && b.updatedAt) {
      return a.updatedAt < b.updatedAt ? 1 : (a.updatedAt > b.updatedAt ? -1 : 0);
    }
    if (a.updatedAt) return -1;
    if (b.updatedAt) return 1;
    return a.path < b.path ? 1 : -1;
  });

  var result = {
    repositoryId: repoConfig.id,
    repositoryName: repoConfig.displayName,
    branch: repoConfig.branch,
    articlesDir: repoConfig.articlesDir,
    truncated: Boolean(treeData && treeData.truncated),
    totalCount: articles.length,
    articles: articles
  };

  // 60秒キャッシュして連続アクセス時のGitHub API消費を抑える
  try {
    var serialized = JSON.stringify(result);
    if (serialized.length < 95000) {
      cache.put(cacheKey, serialized, 60);
    }
  } catch (e3) {}

  return result;
}

/**
 * 記事キャッシュを無効化
 */
function invalidateArticleListCache_(repoId) {
  try {
    CacheService.getScriptCache().remove('articles_tree_' + repoId);
  } catch (e) {}
}

/**
 * 記事詳細（最新のMarkdown本文・SHA・メタデータ・最新コミット日時）を取得
 */
function getArticleDetail_(params) {
  var p = params || {};
  var repoId = validateString_(p.repositoryId, 'リポジトリID', { required: true });
  var filePath = validateString_(p.path, 'ファイルパス', { required: true });
  var repoConfig = getRepositoryByIdOrThrow_(repoId);

  var fileData = fetchGitHubFileContent_(repoConfig, filePath);
  var urls = buildArticleUrls_(repoConfig, fileData.path);
  var meta = extractMarkdownMetadata_(fileData.content);
  var latestCommit = null;
  try {
    latestCommit = fetchLatestCommitForPath_(repoConfig, fileData.path);
  } catch (e) {}

  return {
    repositoryId: repoConfig.id,
    path: fileData.path,
    name: fileData.name,
    sha: fileData.sha,
    size: fileData.size,
    content: fileData.content,
    title: meta.title || urls.filename,
    date: meta.date || (latestCommit ? latestCommit.date : ''),
    draft: meta.draft,
    updatedAt: latestCommit ? latestCommit.date : '',
    lastCommitMessage: latestCommit ? latestCommit.message : '',
    githubUrl: fileData.htmlUrl || urls.githubUrl,
    publicUrl: urls.publicUrl
  };
}

/**
 * ファイルパスの安全性検証（ディレクトリトラバーサル防止）
 */
function buildAndValidateArticlePath_(repoConfig, requestedPathOrFilename) {
  var raw = validateString_(requestedPathOrFilename, 'ファイル名またはパス', {
    required: true,
    maxLength: 240
  }).replace(/^\/+|\/+$/g, '');

  if (raw.indexOf('..') !== -1 || raw.indexOf('\\') !== -1) {
    throw createAppError_('VALIDATION_ERROR', 'ファイルパスに不正な文字列（.. や \\）を含めることはできません。', false);
  }

  var dir = String(repoConfig.articlesDir || '').replace(/^\/+|\/+$/g, '');
  var ext = String(repoConfig.markdownExt || '.md');
  var fullPath = raw;

  // ディレクトリが含まれていない場合は、リポジトリの記事保存ディレクトリを付与
  if (dir && fullPath.indexOf(dir + '/') !== 0) {
    fullPath = dir + '/' + fullPath;
  }

  // 拡張子が付いていない場合は自動付与
  if (!/\.(md|mdx|markdown)$/i.test(fullPath)) {
    fullPath = fullPath + ext;
  }

  return fullPath;
}

/**
 * 新規記事を作成（GitHub Contents API）
 */
function createArticle_(params, actorEmail) {
  var p = params || {};
  var repoId = validateString_(p.repositoryId, 'リポジトリID', { required: true });
  var repoConfig = getRepositoryByIdOrThrow_(repoId);
  var targetPath = buildAndValidateArticlePath_(repoConfig, p.filename || p.path);
  var content = validateString_(p.content, '記事本文', {
    required: true,
    maxLength: 500000,
    trim: false
  });
  var commitMessage = validateString_(
    p.commitMessage || ('docs: create article ' + targetPath),
    'コミットメッセージ',
    { required: true, maxLength: 200 }
  );

  // 既存ファイルの上書き防止チェック
  var existingFile = null;
  try {
    existingFile = fetchGitHubFileContent_(repoConfig, targetPath);
  } catch (err) {
    if (err.code !== 'GITHUB_NOT_FOUND') {
      throw err;
    }
  }

  if (existingFile) {
    throw createAppError_(
      'ARTICLE_ALREADY_EXISTS',
      '同じパスのファイル（' + targetPath + '）が既に存在します。別のファイル名を指定するか、既存記事として編集してください。',
      false
    );
  }

  var putResult = putGitHubTextFile_(repoConfig, targetPath, content, commitMessage, null);
  invalidateArticleListCache_(repoId);

  var savedSha = (putResult && putResult.content && putResult.content.sha) ? putResult.content.sha : '';
  var urls = buildArticleUrls_(repoConfig, targetPath);

  recordOperationLog_(
    actorEmail,
    'ARTICLE_CREATE',
    'Article',
    repoConfig.owner + '/' + repoConfig.repo + ':' + targetPath,
    '記事「' + targetPath + '」を新規作成しました。',
    'SUCCESS'
  );

  return {
    repositoryId: repoConfig.id,
    path: targetPath,
    sha: savedSha,
    githubUrl: (putResult && putResult.content && putResult.content.html_url) || urls.githubUrl,
    publicUrl: urls.publicUrl,
    commitSha: (putResult && putResult.commit && putResult.commit.sha) || ''
  };
}

/**
 * 既存記事を更新（最新SHA確認・競合時は無条件上書きせずリモート最新版を返して差分提示）
 */
function updateArticle_(params, actorEmail) {
  var p = params || {};
  var repoId = validateString_(p.repositoryId, 'リポジトリID', { required: true });
  var targetPath = validateString_(p.path, 'ファイルパス', { required: true });
  var expectedSha = validateString_(p.sha, '対象ファイルのSHA', { required: true });
  var content = validateString_(p.content, '記事本文', {
    required: true,
    maxLength: 500000,
    trim: false
  });
  var repoConfig = getRepositoryByIdOrThrow_(repoId);
  var commitMessage = validateString_(
    p.commitMessage || ('docs: update article ' + targetPath),
    'コミットメッセージ',
    { required: true, maxLength: 200 }
  );

  // 1. まずGitHub上の最新ファイル状態を取得してSHA競合を事前確認
  var latestRemote = fetchGitHubFileContent_(repoConfig, targetPath);
  if (latestRemote.sha !== expectedSha) {
    throw createAppError_(
      'GITHUB_SHA_CONFLICT',
      '編集開始後にGitHub上のファイルが更新されたため、SHAが一致しません。リモート最新版との差分を確認してください。',
      false,
      {
        conflict: true,
        path: targetPath,
        expectedSha: expectedSha,
        remoteSha: latestRemote.sha,
        remoteContent: latestRemote.content
      }
    );
  }

  // 2. SHAを指定して更新（万一直後に競合した場合もキャッチして最新版を返す）
  var putResult;
  try {
    putResult = putGitHubTextFile_(repoConfig, targetPath, content, commitMessage, expectedSha);
  } catch (err) {
    if (err.code === 'GITHUB_SHA_CONFLICT') {
      var conflictRemote = fetchGitHubFileContent_(repoConfig, targetPath);
      throw createAppError_(
        'GITHUB_SHA_CONFLICT',
        '保存時にSHA競合が検出されました。リモート最新版との差分を確認してください。',
        false,
        {
          conflict: true,
          path: targetPath,
          expectedSha: expectedSha,
          remoteSha: conflictRemote.sha,
          remoteContent: conflictRemote.content
        }
      );
    }
    throw err;
  }

  invalidateArticleListCache_(repoId);

  var newSha = (putResult && putResult.content && putResult.content.sha) ? putResult.content.sha : '';
  var urls = buildArticleUrls_(repoConfig, targetPath);

  recordOperationLog_(
    actorEmail,
    'ARTICLE_UPDATE',
    'Article',
    repoConfig.owner + '/' + repoConfig.repo + ':' + targetPath,
    '記事「' + targetPath + '」を更新しました。',
    'SUCCESS'
  );

  return {
    repositoryId: repoConfig.id,
    path: targetPath,
    sha: newSha,
    githubUrl: (putResult && putResult.content && putResult.content.html_url) || urls.githubUrl,
    publicUrl: urls.publicUrl,
    commitSha: (putResult && putResult.commit && putResult.commit.sha) || ''
  };
}

/**
 * 記事を削除（SHA検証付き）
 */
function deleteArticle_(params, actorEmail) {
  var p = params || {};
  var repoId = validateString_(p.repositoryId, 'リポジトリID', { required: true });
  var targetPath = validateString_(p.path, 'ファイルパス', { required: true });
  var expectedSha = validateString_(p.sha, '対象ファイルのSHA', { required: true });
  var repoConfig = getRepositoryByIdOrThrow_(repoId);
  var commitMessage = validateString_(
    p.commitMessage || ('docs: delete article ' + targetPath),
    'コミットメッセージ',
    { required: true, maxLength: 200 }
  );

  var latestRemote = fetchGitHubFileContent_(repoConfig, targetPath);
  if (latestRemote.sha !== expectedSha) {
    throw createAppError_(
      'GITHUB_SHA_CONFLICT',
      '削除対象のファイルがリモートで更新されています（SHA不一致）。最新の内容を確認してから削除してください。',
      false,
      {
        conflict: true,
        path: targetPath,
        expectedSha: expectedSha,
        remoteSha: latestRemote.sha,
        remoteContent: latestRemote.content
      }
    );
  }

  deleteGitHubFile_(repoConfig, targetPath, expectedSha, commitMessage);
  invalidateArticleListCache_(repoId);

  recordOperationLog_(
    actorEmail,
    'ARTICLE_DELETE',
    'Article',
    repoConfig.owner + '/' + repoConfig.repo + ':' + targetPath,
    '記事「' + targetPath + '」を削除しました。',
    'SUCCESS'
  );

  return {
    repositoryId: repoConfig.id,
    deletedPath: targetPath
  };
}

/**
 * リポジトリ内の画像保存ディレクトリに画像をアップロードする（GitHub Contents API）
 */
function uploadArticleImage_(params, actorEmail) {
  var p = params || {};
  var repoId = validateString_(p.repositoryId, 'リポジトリID', { required: true });
  var repoConfig = getRepositoryByIdOrThrow_(repoId);
  var rawFilename = validateString_(p.filename, '画像ファイル名', { required: true, maxLength: 120 });
  var base64Data = validateString_(p.base64Data, '画像データ', { required: true });

  var safeName = rawFilename.replace(/[^a-zA-Z0-9._-]/g, '-');
  if (!/\.(png|jpe?g|gif|webp|svg|avif)$/i.test(safeName)) {
    throw createAppError_('VALIDATION_ERROR', 'アップロード可能な画像拡張子は png, jpg, jpeg, gif, webp, svg, avif です。', false);
  }

  var imagesDir = String(repoConfig.imagesDir || 'public/images').replace(/^\/+|\/+$/g, '');
  var targetPath = imagesDir ? (imagesDir + '/' + safeName) : safeName;

  var existingSha = null;
  try {
    var existing = fetchGitHubFileContent_(repoConfig, targetPath);
    if (existing && existing.sha) {
      existingSha = existing.sha;
    }
  } catch (e) {}

  var commitMessage = 'assets: upload image ' + targetPath;
  var putResult = putGitHubBase64File_(repoConfig, targetPath, base64Data, commitMessage, existingSha);

  // Markdown埋め込み用URLを算出（public/ 配下の場合はサイトルート相対パス /images/... に変換）
  var markdownUrl = '/' + targetPath.replace(/^public\//, '');
  var downloadUrl = (putResult && putResult.content && putResult.content.download_url) || '';

  recordOperationLog_(
    actorEmail,
    'IMAGE_UPLOAD',
    'Asset',
    repoConfig.owner + '/' + repoConfig.repo + ':' + targetPath,
    '画像「' + targetPath + '」をアップロードしました。',
    'SUCCESS'
  );

  return {
    path: targetPath,
    markdownUrl: markdownUrl,
    downloadUrl: downloadUrl,
    sha: (putResult && putResult.content && putResult.content.sha) || ''
  };
}
