/**
 * PublicApi.gs
 * アプリ向け公開API（GAS Webアプリの doGet / doPost エントリーポイント）。
 *
 * 管理者権限を一切持たず、以下の2操作のみを厳格に許可します。
 * 1. doGet: アプリIDを指定して公開済み（status === 'published'）のお知らせのみを取得
 * 2. doPost: アプリからのお問い合わせ登録（入力検証・スパム対策・レート制限付き）
 *
 * 管理データ（下書きのお知らせ、お問い合わせ一覧・個人情報、リポジトリ設定、操作ログ等）の
 * 閲覧・編集・削除は公開APIからは物理的に実行できない設計です。
 */

/**
 * JSONレスポンス（ContentService）を生成するヘルパー
 */
function createPublicJsonResponse_(payloadObj) {
  var output = ContentService.createTextOutput(JSON.stringify(payloadObj));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}

/**
 * 公開API: GET リクエスト
 * クエリパラメータ:
 *   - action=notices (省略時もnoticesとして扱う)
 *   - appId=<Applicationsシートのid または bundleId> （必須）
 */
function doGet(e) {
  try {
    var params = (e && e.parameter) ? e.parameter : {};
    var action = String(params.action || 'notices').trim();

    if (action !== 'notices') {
      return createPublicJsonResponse_({
        ok: false,
        error: {
          code: 'FORBIDDEN_ACTION',
          message: '公開API (GET) では公開済みお知らせの取得 (action=notices) のみ許可されています。'
        }
      });
    }

    var requestedAppKey = validateString_(params.appId, 'appId', { required: true, maxLength: 150 });

    // 期限到来済みの予約お知らせがあれば公開に昇格
    processScheduledNoticesInternal_();

    // appId または bundleId で有効なアプリを検索
    var apps = getAllRecords_(CONFIG.SHEETS.APPLICATIONS);
    var targetApp = null;
    for (var i = 0; i < apps.length; i++) {
      var a = apps[i];
      if (!parseBooleanCell_(a.isActive)) continue;
      if (String(a.id) === requestedAppKey || String(a.bundleId) === requestedAppKey) {
        targetApp = a;
        break;
      }
    }

    if (!targetApp) {
      return createPublicJsonResponse_({
        ok: false,
        error: {
          code: 'APP_NOT_FOUND',
          message: '指定された appId に該当する有効なアプリが見つかりません。'
        }
      });
    }

    // 対象アプリの status === 'published' のお知らせのみを抽出
    var allNotices = getAllRecords_(CONFIG.SHEETS.NOTICES);
    var publicNotices = [];
    for (var j = 0; j < allNotices.length; j++) {
      var n = allNotices[j];
      if (String(n.appId) !== String(targetApp.id)) continue;
      if (String(n.status) !== 'published') continue;

      publicNotices.push({
        id: String(n.id || ''),
        appId: String(n.appId || ''),
        title: String(n.title || ''),
        body: String(n.body || ''),
        publishedAt: String(n.publishedAt || n.createdAt || ''),
        updatedAt: String(n.updatedAt || '')
      });
    }

    publicNotices.sort(function(a, b) {
      return a.publishedAt < b.publishedAt ? 1 : -1;
    });

    return createPublicJsonResponse_({
      ok: true,
      app: {
        id: String(targetApp.id),
        name: String(targetApp.name),
        bundleId: String(targetApp.bundleId)
      },
      notices: publicNotices,
      timestamp: nowIso_()
    });
  } catch (err) {
    var isAppErr = err && err.name === 'AppError';
    return createPublicJsonResponse_({
      ok: false,
      error: {
        code: isAppErr ? err.code : 'PUBLIC_API_ERROR',
        message: isAppErr ? err.userMessage : 'リクエストの処理中にエラーが発生しました。'
      }
    });
  }
}

/**
 * 公開API: POST リクエスト（お問い合わせ登録専用）
 * リクエストボディ (JSON または application/x-www-form-urlencoded):
 *   - appId (Applicationsのid または bundleId)
 *   - name
 *   - email
 *   - subject
 *   - message
 */
function doPost(e) {
  try {
    var payload = {};
    if (e && e.postData && e.postData.contents) {
      try {
        payload = JSON.parse(e.postData.contents);
      } catch (parseErr) {
        payload = (e && e.parameter) ? e.parameter : {};
      }
    } else if (e && e.parameter) {
      payload = e.parameter;
    }

    // bundleId で指定された場合も内部の app.id に解決する
    var rawAppKey = validateString_(payload.appId, 'アプリID (appId)', { required: true, maxLength: 150 });
    var apps = getAllRecords_(CONFIG.SHEETS.APPLICATIONS);
    var resolvedAppId = rawAppKey;
    for (var i = 0; i < apps.length; i++) {
      if (String(apps[i].id) === rawAppKey || String(apps[i].bundleId) === rawAppKey) {
        resolvedAppId = String(apps[i].id);
        break;
      }
    }
    payload.appId = resolvedAppId;

    var result = submitPublicInquiry_(payload);

    return createPublicJsonResponse_({
      ok: true,
      data: result
    });
  } catch (err) {
    var isAppErr = err && err.name === 'AppError';
    return createPublicJsonResponse_({
      ok: false,
      error: {
        code: isAppErr ? err.code : 'PUBLIC_INQUIRY_ERROR',
        message: isAppErr ? err.userMessage : 'お問い合わせの送信処理中にエラーが発生しました。'
      }
    });
  }
}
