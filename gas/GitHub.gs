/**
 * GitHub.gs
 * GitHub REST API (2022-11-28) との通信クライアント。
 * トークン失効、レート制限、SHA競合 (409 / 422) を明確に区別して処理します。
 */

var GITHUB_API_BASE_ = 'https://api.github.com';

/**
 * GitHub REST API リクエストを実行する共通関数
 */
function githubRequest_(tokenPropertyKey, method, endpointPath, bodyObj) {
  var token = getGitHubTokenByKey_(tokenPropertyKey);
  var url = GITHUB_API_BASE_ + endpointPath;

  var headers = {
    'Authorization': 'Bearer ' + token,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'Personal-Dev-Admin-GAS'
  };

  var options = {
    method: method.toLowerCase(),
    headers: headers,
    muteHttpExceptions: true
  };

  if (bodyObj !== undefined && bodyObj !== null) {
    options.contentType = 'application/json; charset=utf-8';
    options.payload = JSON.stringify(bodyObj);
  }

  var response;
  try {
    response = UrlFetchApp.fetch(url, options);
  } catch (e) {
    throw createAppError_(
      'GITHUB_NETWORK_ERROR',
      'GitHub APIへの接続に失敗しました。ネットワーク状況を確認して再試行してください。',
      true
    );
  }

  var status = response.getResponseCode();
  var text = response.getContentText() || '';
  var resHeaders = response.getHeaders() || {};
  var json = null;

  if (text) {
    try {
      json = JSON.parse(text);
    } catch (e2) {
      json = null;
    }
  }

  if (status >= 200 && status < 300) {
    return json;
  }

  // エラーハンドリング（トークン自体は絶対に出力しない）
  var ghMessage = (json && json.message) ? String(json.message) : ('HTTP ' + status);

  if (status === 401) {
    throw createAppError_(
      'GITHUB_TOKEN_EXPIRED',
      'GitHubトークン（' + tokenPropertyKey + '）が無効または有効期限切れです。Fine-grained PATを再発行し、GASのScript Propertiesを更新してください。',
      false
    );
  }

  if (status === 403 || status === 429) {
    var remaining = resHeaders['x-ratelimit-remaining'] || resHeaders['X-RateLimit-Remaining'];
    var resetEpoch = resHeaders['x-ratelimit-reset'] || resHeaders['X-RateLimit-Reset'];
    if (String(remaining) === '0' || status === 429 || ghMessage.toLowerCase().indexOf('rate limit') !== -1) {
      var resetTimeStr = '';
      if (resetEpoch) {
        var resetDate = new Date(Number(resetEpoch) * 1000);
        resetTimeStr = '（解除予定: ' + Utilities.formatDate(resetDate, 'Asia/Tokyo', 'HH:mm:ss') + ' 頃）';
      }
      throw createAppError_(
        'GITHUB_RATE_LIMIT',
        'GitHub APIのレート制限に達しました' + resetTimeStr + '。しばらく待ってから再試行してください。',
        true
      );
    }
    throw createAppError_(
      'GITHUB_FORBIDDEN',
      'GitHubリポジトリへのアクセスが拒否されました。Fine-grained PATに対象リポジトリの「Contents: Read and write」権限が付与されているか確認してください。（詳細: ' + ghMessage + '）',
      false
    );
  }

  if (status === 404) {
    throw createAppError_(
      'GITHUB_NOT_FOUND',
      'GitHub上の対象リソースが見つかりません（owner / repo / branch またはファイルパスを確認してください）。',
      false
    );
  }

  if (status === 409) {
    throw createAppError_(
      'GITHUB_SHA_CONFLICT',
      'GitHub上のファイルが他の場所で更新されたため、SHAの競合が発生しました。最新の内容を読み込んで差分を確認してください。',
      false
    );
  }

  if (status === 422) {
    if (ghMessage.indexOf('sha') !== -1 || ghMessage.indexOf('does not match') !== -1) {
      throw createAppError_(
        'GITHUB_SHA_CONFLICT',
        'GitHub上のファイルSHAが一致しません。すでにリモートで更新されている可能性があります。',
        false
      );
    }
    throw createAppError_(
      'GITHUB_VALIDATION_ERROR',
      'GitHub APIの検証エラーが発生しました: ' + ghMessage,
      false
    );
  }

  throw createAppError_(
    'GITHUB_API_ERROR',
    'GitHub APIエラーが発生しました（HTTP ' + status + ': ' + ghMessage + '）',
    status >= 500
  );
}

/**
 * GitHub API 用にスラッシュ区切りのファイルパスをURLエンコードする
 */
function encodeGitHubPath_(filePath) {
  var cleaned = String(filePath || '').replace(/^\/+|\/+$/g, '');
  if (!cleaned) return '';
  var parts = cleaned.split('/');
  var encoded = [];
  for (var i = 0; i < parts.length; i++) {
    encoded.push(encodeURIComponent(parts[i]));
  }
  return encoded.join('/');
}

/**
 * UTF-8文字列をBase64エンコード（改行なし）
 */
function encodeUtf8ToBase64_(text) {
  var bytes = Utilities.newBlob(String(text || ''), 'text/plain; charset=utf-8').getBytes();
  return Utilities.base64Encode(bytes);
}

/**
 * GitHub Contents API の Base64 文字列を UTF-8 文字列にデコード
 */
function decodeBase64ToUtf8_(base64Str) {
  var cleaned = String(base64Str || '').replace(/\s+/g, '');
  var bytes = Utilities.base64Decode(cleaned);
  return Utilities.newBlob(bytes).getDataAsString('UTF-8');
}

/**
 * 指定ブランチの Git Tree (recursive) を取得する
 */
function fetchGitHubRepoTree_(repoConfig) {
  var owner = encodeURIComponent(repoConfig.owner);
  var repo = encodeURIComponent(repoConfig.repo);
  var branch = encodeURIComponent(repoConfig.branch || 'main');

  // ブランチの最新ツリーを recursive=1 で取得
  var endpoint = '/repos/' + owner + '/' + repo + '/git/trees/' + branch + '?recursive=1';
  return githubRequest_(repoConfig.tokenPropertyKey, 'GET', endpoint, null);
}

/**
 * 指定パスのファイル内容とSHAを GitHub Contents API で取得する
 */
function fetchGitHubFileContent_(repoConfig, filePath) {
  var owner = encodeURIComponent(repoConfig.owner);
  var repo = encodeURIComponent(repoConfig.repo);
  var branch = encodeURIComponent(repoConfig.branch || 'main');
  var encodedPath = encodeGitHubPath_(filePath);

  var endpoint = '/repos/' + owner + '/' + repo + '/contents/' + encodedPath + '?ref=' + branch;
  var data = githubRequest_(repoConfig.tokenPropertyKey, 'GET', endpoint, null);

  if (!data || Array.isArray(data) || data.type !== 'file') {
    throw createAppError_('GITHUB_NOT_A_FILE', '指定されたパスはファイルではありません: ' + filePath, false);
  }

  var contentText = '';
  if (data.encoding === 'base64' && data.content !== undefined) {
    contentText = decodeBase64ToUtf8_(data.content);
  }

  return {
    path: data.path,
    name: data.name,
    sha: data.sha,
    size: data.size || 0,
    htmlUrl: data.html_url || '',
    downloadUrl: data.download_url || '',
    content: contentText
  };
}

/**
 * GitHub Contents API でファイルを新規作成または更新する（UTF-8テキスト用）
 */
function putGitHubTextFile_(repoConfig, filePath, contentText, commitMessage, expectedSha) {
  var owner = encodeURIComponent(repoConfig.owner);
  var repo = encodeURIComponent(repoConfig.repo);
  var encodedPath = encodeGitHubPath_(filePath);
  var endpoint = '/repos/' + owner + '/' + repo + '/contents/' + encodedPath;

  var payload = {
    message: commitMessage,
    content: encodeUtf8ToBase64_(contentText),
    branch: repoConfig.branch || 'main'
  };

  if (expectedSha) {
    payload.sha = expectedSha;
  }

  return githubRequest_(repoConfig.tokenPropertyKey, 'PUT', endpoint, payload);
}

/**
 * GitHub Contents API でバイナリ（画像Base64）をアップロードする
 */
function putGitHubBase64File_(repoConfig, filePath, rawBase64, commitMessage, expectedSha) {
  var owner = encodeURIComponent(repoConfig.owner);
  var repo = encodeURIComponent(repoConfig.repo);
  var encodedPath = encodeGitHubPath_(filePath);
  var endpoint = '/repos/' + owner + '/' + repo + '/contents/' + encodedPath;

  var cleanedBase64 = String(rawBase64 || '').replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
  var payload = {
    message: commitMessage,
    content: cleanedBase64,
    branch: repoConfig.branch || 'main'
  };

  if (expectedSha) {
    payload.sha = expectedSha;
  }

  return githubRequest_(repoConfig.tokenPropertyKey, 'PUT', endpoint, payload);
}

/**
 * GitHub Contents API でファイルを削除する
 */
function deleteGitHubFile_(repoConfig, filePath, expectedSha, commitMessage) {
  var owner = encodeURIComponent(repoConfig.owner);
  var repo = encodeURIComponent(repoConfig.repo);
  var encodedPath = encodeGitHubPath_(filePath);
  var endpoint = '/repos/' + owner + '/' + repo + '/contents/' + encodedPath;

  var payload = {
    message: commitMessage,
    sha: expectedSha,
    branch: repoConfig.branch || 'main'
  };

  return githubRequest_(repoConfig.tokenPropertyKey, 'DELETE', endpoint, payload);
}

/**
 * 指定パスの直近コミット日時を取得（任意・一覧での更新日時補完用）
 */
function fetchLatestCommitForPath_(repoConfig, filePath) {
  var owner = encodeURIComponent(repoConfig.owner);
  var repo = encodeURIComponent(repoConfig.repo);
  var branch = encodeURIComponent(repoConfig.branch || 'main');
  var endpoint =
    '/repos/' +
    owner +
    '/' +
    repo +
    '/commits?sha=' +
    branch +
    '&path=' +
    encodeURIComponent(filePath) +
    '&per_page=1';

  var commits = githubRequest_(repoConfig.tokenPropertyKey, 'GET', endpoint, null);
  if (Array.isArray(commits) && commits.length > 0) {
    var c = commits[0];
    return {
      sha: c.sha,
      date: (c.commit && c.commit.committer && c.commit.committer.date) || (c.commit && c.commit.author && c.commit.author.date) || '',
      message: (c.commit && c.commit.message) || ''
    };
  }
  return null;
}

/**
 * GitHub Git Data API (Refs / Commits / Trees) を使用して複数ファイルの作成・更新・リネーム（旧パス削除）を
 * 単一のコミットとして一括保存する関数
 * @param {Object} repoConfig リポジトリ設定
 * @param {Array<{path: string, content: string, previousPath?: string}>} fileEntries 保存するファイル配列
 * @param {string} commitMessage コミットメッセージ
 */
function commitMultipleFilesAtomic_(repoConfig, fileEntries, commitMessage) {
  var owner = encodeURIComponent(repoConfig.owner);
  var repo = encodeURIComponent(repoConfig.repo);
  var branch = String(repoConfig.branch || 'main').trim();
  var tokenKey = repoConfig.tokenPropertyKey;

  // 1. 現在のブランチHEADのRefを取得
  var refData = githubRequest_(
    tokenKey,
    'GET',
    '/repos/' + owner + '/' + repo + '/git/ref/heads/' + encodeURIComponent(branch),
    null
  );
  var latestCommitSha = refData && refData.object && refData.object.sha;
  if (!latestCommitSha) {
    throw createAppError_('GITHUB_API_ERROR', 'ブランチ ' + branch + ' の最新コミットSHAを取得できませんでした。', false);
  }

  // 2. 現在のHEADコミットから base_tree SHA を取得
  var commitData = githubRequest_(
    tokenKey,
    'GET',
    '/repos/' + owner + '/' + repo + '/git/commits/' + latestCommitSha,
    null
  );
  var baseTreeSha = commitData && commitData.tree && commitData.tree.sha;
  if (!baseTreeSha) {
    throw createAppError_('GITHUB_API_ERROR', 'ベースツリーのSHAを取得できませんでした。', false);
  }

  // 3. 新しいツリーエントリを構築（ファイル名変更時は旧パスに sha: null を指定して削除）
  var treeNodes = [];
  for (var i = 0; i < fileEntries.length; i++) {
    var entry = fileEntries[i];
    if (entry.previousPath && entry.previousPath !== entry.path) {
      treeNodes.push({
        path: entry.previousPath,
        mode: '100644',
        type: 'blob',
        sha: null
      });
    }
    treeNodes.push({
      path: entry.path,
      mode: '100644',
      type: 'blob',
      content: entry.content
    });
  }

  // 4. 新しい Git Tree を作成
  var newTree = githubRequest_(
    tokenKey,
    'POST',
    '/repos/' + owner + '/' + repo + '/git/trees',
    {
      base_tree: baseTreeSha,
      tree: treeNodes
    }
  );

  // 5. 新しい Git Commit を作成
  var newCommit = githubRequest_(
    tokenKey,
    'POST',
    '/repos/' + owner + '/' + repo + '/git/commits',
    {
      message: commitMessage,
      tree: newTree.sha,
      parents: [latestCommitSha]
    }
  );

  // 6. ブランチの Ref を新しいコミットへ更新
  githubRequest_(
    tokenKey,
    'PATCH',
    '/repos/' + owner + '/' + repo + '/git/refs/heads/' + encodeURIComponent(branch),
    {
      sha: newCommit.sha,
      force: false
    }
  );

  return {
    commitSha: newCommit.sha,
    treeSha: newTree.sha
  };
}
