/**
 * Auth.gs
 * 管理者認証と権限確認を行います。
 *
 * 1. Apps Script API (scripts.run) 経由の実行時、Session.getActiveUser().getEmail()
 *    および OAuth トークンにより実行ユーザーのメールアドレスを検証します。
 * 2. さらにフロントエンドから渡された Google Identity Services の IDトークン（指定がある場合）を
 *    Google公式の tokeninfo エンドポイントまたはペイロード署名検証で確認し、
 *    発行者 (iss)・Audience (aud)・有効期限 (exp)・メール確認状態 (email_verified)・メールアドレスの一致を検証します。
 */

/**
 * 管理APIリクエストの認証・認可を検証する
 * @param {Object=} authContext フロントエンドから渡された認証コンテキスト ({ idToken?: string })
 * @return {{ email: string }} 検証済み管理者の情報
 */
function verifyAdminAccess_(authContext) {
  var allowedEmail = getAdminEmail_();
  var activeEmail = '';

  try {
    activeEmail = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  } catch (e) {
    activeEmail = '';
  }

  // Session.getEffectiveUser() も補助的に確認（API ExecutableのMYSELF設定時は実行者＝オーナー）
  var effectiveEmail = '';
  try {
    effectiveEmail = String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase();
  } catch (e2) {
    effectiveEmail = '';
  }

  // 1. セッションユーザーの検証
  if (!activeEmail && !effectiveEmail) {
    throw createAppError_(
      'UNAUTHORIZED',
      'Googleアカウントのセッション情報を確認できません。再度ログインしてください。',
      false
    );
  }

  var sessionEmail = activeEmail || effectiveEmail;
  if (sessionEmail !== allowedEmail) {
    throw createAppError_(
      'FORBIDDEN',
      'このGoogleアカウントには管理画面へのアクセス権限がありません。許可されたアカウントでログインしてください。',
      false
    );
  }

  // 2. IDトークンが提供されている場合は、Google公式仕様に基づいてIDトークンも厳密に検証する
  if (authContext && authContext.idToken) {
    verifyGoogleIdToken_(authContext.idToken, allowedEmail);
  }

  return {
    email: sessionEmail
  };
}

/**
 * Google Identity Services の IDトークン (JWT) を Google 公式 tokeninfo エンドポイントで検証する
 * 同一トークンの検証結果は短期キャッシュ（最大5分、かつexpを超えない）してUrlFetch消費を抑える。
 */
function verifyGoogleIdToken_(idToken, expectedEmail) {
  var rawToken = String(idToken || '').trim();
  if (!rawToken) {
    throw createAppError_('UNAUTHORIZED', 'IDトークンが空です。再ログインしてください。', false);
  }

  var cache = CacheService.getScriptCache();
  var cacheKey = 'idtoken_' + computeSha256Hex_(rawToken).substring(0, 32);
  var cachedEmail = cache.get(cacheKey);
  if (cachedEmail) {
    if (cachedEmail.toLowerCase() !== expectedEmail.toLowerCase()) {
      throw createAppError_('FORBIDDEN', 'IDトークンのメールアドレスが管理者と一致しません。', false);
    }
    return;
  }

  var url = 'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(rawToken);
  var response;
  try {
    response = UrlFetchApp.fetch(url, {
      method: 'get',
      muteHttpExceptions: true
    });
  } catch (e) {
    throw createAppError_('AUTH_VERIFY_FAILED', 'Google認証サーバーへの確認通信に失敗しました。', true);
  }

  if (response.getResponseCode() !== 200) {
    throw createAppError_(
      'TOKEN_EXPIRED',
      'Google IDトークンが無効または期限切れです。再ログインしてください。',
      false
    );
  }

  var payload;
  try {
    payload = JSON.parse(response.getContentText());
  } catch (e2) {
    throw createAppError_('AUTH_VERIFY_FAILED', 'IDトークン検証レスポンスの解析に失敗しました。', false);
  }

  // 発行者 (iss) の検証
  if (payload.iss !== 'https://accounts.google.com' && payload.iss !== 'accounts.google.com') {
    throw createAppError_('UNAUTHORIZED', 'IDトークンの発行者 (iss) が不正です。', false);
  }

  // Audience (aud) の検証（Script Properties に OAUTH_CLIENT_ID が設定されている場合）
  var expectedClientId = getOAuthClientId_();
  if (expectedClientId && payload.aud !== expectedClientId) {
    throw createAppError_('UNAUTHORIZED', 'IDトークンのAudience (aud) が設定されたOAuthクライアントIDと一致しません。', false);
  }

  // 有効期限 (exp) の検証
  var nowSec = Math.floor(Date.now() / 1000);
  var expSec = Number(payload.exp || 0);
  if (!expSec || expSec <= nowSec) {
    throw createAppError_('TOKEN_EXPIRED', 'IDトークンの有効期限が切れています。再認証してください。', false);
  }

  // メール確認状態 (email_verified) の検証
  var emailVerified = payload.email_verified === true || payload.email_verified === 'true';
  if (!emailVerified) {
    throw createAppError_('FORBIDDEN', 'Googleアカウントのメールアドレスが確認されていません。', false);
  }

  // メールアドレスの一致検証
  var tokenEmail = String(payload.email || '').trim().toLowerCase();
  if (tokenEmail !== expectedEmail.toLowerCase()) {
    throw createAppError_('FORBIDDEN', '許可されていないGoogleアカウントです。', false);
  }

  // 有効期限までの残り時間（最大300秒）だけキャッシュ
  var ttl = Math.min(300, Math.max(10, expSec - nowSec - 5));
  cache.put(cacheKey, tokenEmail, ttl);
}
