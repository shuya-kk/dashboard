/**
 * Api.gs
 * 管理画面専用のエントリーポイント（Apps Script API `scripts.run` から呼び出される関数）。
 *
 * すべてのリクエストで必ず verifyAdminAccess_() による Google アカウント本人確認・管理者メールアドレス照合を実施します。
 * 許可されていないアカウントや未認証リクエストはすべて拒否します。
 */

/**
 * Apps Script API `scripts.run` の単一エントリーポイント
 * @param {Object} requestPayload { action: string, params?: Object, auth?: { idToken?: string } }
 * @return {Object} { ok: boolean, data?: any, error?: { code: string, message: string, retryable: boolean, details?: any } }
 */
function adminApiDispatch(requestPayload) {
  try {
    var req = requestPayload || {};
    var action = String(req.action || '').trim();
    var params = req.params || {};
    var authContext = req.auth || {};

    // 1. 管理者認証・認可チェック（必須）
    var adminUser = verifyAdminAccess_(authContext);

    // 2. 初回シート初期化保証
    ensureDatabaseInitialized_();

    // 3. アクション別ルーティング
    var resultData = routeAdminAction_(action, params, adminUser.email);

    return {
      ok: true,
      data: resultData,
      timestamp: nowIso_()
    };
  } catch (err) {
    var isAppErr = err && err.name === 'AppError';
    var code = isAppErr ? err.code : 'INTERNAL_ERROR';
    var message = isAppErr
      ? err.userMessage
      : ('サーバー内部エラーが発生しました: ' + (err && err.message ? err.message : '不明なエラー'));
    var retryable = isAppErr ? Boolean(err.retryable) : false;
    var details = isAppErr ? err.details : null;

    return {
      ok: false,
      error: {
        code: code,
        message: message,
        retryable: retryable,
        details: details
      },
      timestamp: nowIso_()
    };
  }
}

/**
 * 管理APIのアクションディスパッチャ
 */
function routeAdminAction_(action, params, actorEmail) {
  switch (action) {
    // --- 認証・初期状態確認 ---
    case 'auth.verify':
      return {
        authenticated: true,
        email: actorEmail,
        availableTokenKeys: listAvailableGitHubTokenKeys_()
      };

    // --- Dashboard ---
    case 'dashboard.get':
      return getDashboardSummary_(params);

    // --- Repositories ---
    case 'repositories.list':
      return {
        repositories: listRepositories_(),
        availableTokenKeys: listAvailableGitHubTokenKeys_()
      };
    case 'repositories.create':
      return createRepository_(params, actorEmail);
    case 'repositories.update':
      return updateRepository_(params.id, params, actorEmail);
    case 'repositories.delete':
      return deleteRepository_(params.id, actorEmail);

    // --- Articles (GitHub REST API) ---
    case 'articles.list':
      return listArticles_(params);
    case 'articles.get':
      return getArticleDetail_(params);
    case 'articles.create':
      return createArticle_(params, actorEmail);
    case 'articles.update':
      return updateArticle_(params, actorEmail);
    case 'articles.batchSave':
      return batchSaveArticles_(params, actorEmail);
    case 'articles.delete':
      return deleteArticle_(params, actorEmail);
    case 'articles.uploadImage':
      return uploadArticleImage_(params, actorEmail);

    // --- Notices ---
    case 'notices.list':
      return {
        notices: listNotices_(params)
      };
    case 'notices.create':
      return createNotice_(params, actorEmail);
    case 'notices.update':
      return updateNotice_(params.id, params, actorEmail);
    case 'notices.delete':
      return deleteNotice_(params.id, actorEmail);
    case 'notices.runScheduled':
      return processScheduledNoticesInternal_();

    // --- Inquiries ---
    case 'inquiries.list':
      return {
        inquiries: listInquiries_(params)
      };
    case 'inquiries.update':
      return updateInquiryAdmin_(params.id, params, actorEmail);

    // --- Applications ---
    case 'applications.list':
      return {
        applications: listApplications_()
      };
    case 'applications.create':
      return createApplication_(params, actorEmail);
    case 'applications.update':
      return updateApplication_(params.id, params, actorEmail);
    case 'applications.delete':
      return deleteApplication_(params.id, actorEmail);

    // --- Settings / System ---
    case 'settings.get':
      return getSystemSettings_(actorEmail);
    case 'settings.initDatabase':
      return withScriptLock_(function() {
        var initRes = ensureDatabaseInitialized_();
        recordOperationLog_(
          actorEmail,
          'DB_INIT',
          'Spreadsheet',
          initRes.spreadsheetId,
          'スプレッドシートのシート構成・ヘッダーを確認・初期化しました。',
          'SUCCESS'
        );
        return initRes;
      });
    case 'settings.setupTrigger':
      return ensureScheduledNoticesTrigger_(actorEmail);

    default:
      throw createAppError_('UNKNOWN_ACTION', '未定義のAPIアクションです: ' + action, false);
  }
}

/**
 * Dashboard用集計データ取得（すべて実データから集計）
 */
function getDashboardSummary_(params) {
  processScheduledNoticesInternal_();

  var apps = listApplications_();
  var repos = listRepositories_();
  var notices = listNotices_({});
  var inquiries = listInquiries_({});
  var logs = getAllRecords_(CONFIG.SHEETS.OPERATION_LOGS);

  var publishedNoticesCount = 0;
  for (var i = 0; i < notices.length; i++) {
    if (notices[i].status === 'published') {
      publishedNoticesCount++;
    }
  }

  var pendingInquiriesCount = 0;
  for (var j = 0; j < inquiries.length; j++) {
    if (inquiries[j].status === '未対応') {
      pendingInquiriesCount++;
    }
  }

  // 有効なリポジトリの記事数をGitHub Treeから集計（エラーが発生したリポジトリがあってもダッシュボード全体は止めない）
  var totalArticlesCount = 0;
  var repoArticleCounts = [];
  for (var r = 0; r < repos.length; r++) {
    var repo = repos[r];
    if (!repo.isActive) continue;
    try {
      var artRes = listArticles_({ repositoryId: repo.id, forceRefresh: Boolean(params && params.forceRefresh) });
      totalArticlesCount += artRes.totalCount;
      repoArticleCounts.push({
        repositoryId: repo.id,
        displayName: repo.displayName,
        count: artRes.totalCount,
        error: null
      });
    } catch (e) {
      repoArticleCounts.push({
        repositoryId: repo.id,
        displayName: repo.displayName,
        count: 0,
        error: e && e.userMessage ? e.userMessage : '記事数の取得に失敗しました'
      });
    }
  }

  // 最近の操作履歴（最新10件）
  logs.sort(function(a, b) {
    return String(a.timestamp) < String(b.timestamp) ? 1 : -1;
  });
  var recentLogs = [];
  for (var k = 0; k < Math.min(logs.length, 10); k++) {
    recentLogs.push({
      id: String(logs[k].id || ''),
      timestamp: String(logs[k].timestamp || ''),
      actorEmail: String(logs[k].actorEmail || ''),
      action: String(logs[k].action || ''),
      targetType: String(logs[k].targetType || ''),
      targetId: String(logs[k].targetId || ''),
      summary: String(logs[k].summary || ''),
      status: String(logs[k].status || '')
    });
  }

  return {
    metrics: {
      applicationsCount: apps.length,
      repositoriesCount: repos.length,
      articlesCount: totalArticlesCount,
      noticesCount: notices.length,
      publishedNoticesCount: publishedNoticesCount,
      pendingInquiriesCount: pendingInquiriesCount
    },
    repoArticleCounts: repoArticleCounts,
    recentInquiries: inquiries.slice(0, 5),
    recentOperationLogs: recentLogs
  };
}

/**
 * システム設定状態の取得（秘密情報の値は一切返さず、設定有無とキー名のみ返す）
 */
function getSystemSettings_(actorEmail) {
  var ss = getSpreadsheet_();
  var triggers = ScriptApp.getProjectTriggers();
  var hasNoticeTrigger = false;
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'publishScheduledNoticesTrigger') {
      hasNoticeTrigger = true;
      break;
    }
  }

  return {
    adminEmail: actorEmail,
    spreadsheetId: ss.getId(),
    spreadsheetName: ss.getName(),
    spreadsheetUrl: ss.getUrl(),
    availableTokenKeys: listAvailableGitHubTokenKeys_(),
    oauthClientIdConfigured: Boolean(getOAuthClientId_()),
    scheduledNoticeTriggerActive: hasNoticeTrigger,
    timeZone: Session.getScriptTimeZone() || 'Asia/Tokyo'
  };
}

/**
 * GASエディタから手動で初回データベース初期化・トリガー設定を実行するためのセットアップ関数
 */
function initializeSystemManually() {
  var dbInfo = ensureDatabaseInitialized_();
  var triggerInfo = ensureScheduledNoticesTrigger_('manual-setup');
  Logger.log('Database initialized: ' + JSON.stringify(dbInfo));
  Logger.log('Trigger initialized: ' + JSON.stringify(triggerInfo));
  return {
    database: dbInfo,
    trigger: triggerInfo
  };
}
