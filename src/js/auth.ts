/**
 * src/js/auth.ts
 * Google Identity Services (GIS) を用いた認証基盤。
 *
 * 【重要な設計方針】
 * 1. Sign in with Google (IDトークンモデル) と OAuth 2.0 Token Model (アクセストークンモデル) の役割を明確に分離します。
 *    - IDトークン (JWT): ユーザーの本人確認（署名・iss・aud・exp・email_verified検証用）
 *    - OAuthアクセストークン: Google Apps Script API (`scripts.run`) の実行権限
 * 2. セキュリティ要件に従い、OAuthアクセストークンは `localStorage` や `sessionStorage` に一切保存せず、
 *    JavaScriptのメモリ上（Zustandインメモリストア）でのみ保持します。
 * 3. アクセストークンの有効期限を管理し、期限切れ（または失効）時にはワンクリックまたは自動で再認証を要求します。
 */

export interface DecodedGoogleIdToken {
  iss: string;
  aud: string;
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  picture?: string;
  iat: number;
  exp: number;
}

/**
 * Apps Script API `scripts.run` で対象GASスクリプトを実行するために必要な最小限のOAuthスコープ
 * （GASプロジェクト側の appsscript.json で宣言したスコープと一致させます）
 */
export const REQUIRED_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/script.external_request',
  'https://www.googleapis.com/auth/script.scriptapp',
  'https://www.googleapis.com/auth/userinfo.email'
].join(' ');

/**
 * Google Identity Services (`https://accounts.google.com/gsi/client`) スクリプトを動的にロード
 */
let gisLoadPromise: Promise<void> | null = null;

export function loadGoogleIdentityScript(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('ブラウザ環境でのみ実行可能です'));
  }
  if ((window as unknown as { google?: { accounts?: unknown } }).google?.accounts) {
    return Promise.resolve();
  }
  if (gisLoadPromise) {
    return gisLoadPromise;
  }

  gisLoadPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Google認証スクリプトの読み込みに失敗しました')));
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      gisLoadPromise = null;
      reject(new Error('Google Identity Services スクリプトの読み込みに失敗しました。ネットワーク接続を確認してください。'));
    };
    document.head.appendChild(script);
  });

  return gisLoadPromise;
}

/**
 * JWT (IDトークン) のペイロードをデコードし、フロントエンド側での基本検証
 * （iss, aud, exp, email_verified）を実施する。
 * ※署名検証を含む最終的な厳密検証はGASバックエンド側 (`verifyGoogleIdToken_`) でも必ず実施します。
 */
export function decodeAndVerifyIdTokenClaims(
  idToken: string,
  expectedClientId: string
): DecodedGoogleIdToken {
  const parts = idToken.split('.');
  if (parts.length !== 3 || !parts[1]) {
    throw new Error('IDトークンの形式が不正です（JWT形式ではありません）。');
  }

  let payload: DecodedGoogleIdToken;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const jsonText = new TextDecoder('utf-8').decode(bytes);
    payload = JSON.parse(jsonText) as DecodedGoogleIdToken;
  } catch {
    throw new Error('IDトークンのペイロード解析に失敗しました。');
  }

  // 1. 発行者 (iss) 確認
  if (payload.iss !== 'https://accounts.google.com' && payload.iss !== 'accounts.google.com') {
    throw new Error('IDトークンの発行者 (iss) が Google アカウントではありません。');
  }

  // 2. Audience (aud) 確認
  if (expectedClientId && payload.aud !== expectedClientId) {
    throw new Error('IDトークンの Audience (aud) がクライアントIDと一致しません。');
  }

  // 3. 有効期限 (exp) 確認
  const nowSec = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp <= nowSec) {
    throw new Error('IDトークンの有効期限が切れています。再度ログインしてください。');
  }

  // 4. メール確認状態 (email_verified) 確認
  if (!payload.email || payload.email_verified !== true) {
    throw new Error('Googleアカウントのメールアドレスが確認済み (email_verified) ではありません。');
  }

  return payload;
}

/**
 * OAuth 2.0 Token Client を用いて Apps Script API 実行用のアクセストークンを取得する
 */
export async function requestGoogleAccessToken(options: {
  clientId: string;
  loginHintEmail?: string;
  prompt?: '' | 'consent' | 'select_account';
}): Promise<{ accessToken: string; expiresAt: number }> {
  await loadGoogleIdentityScript();

  const googleAccounts = (window as unknown as {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            hint?: string;
            prompt?: string;
            callback: (response: {
              access_token?: string;
              expires_in?: number | string;
              error?: string;
              error_description?: string;
            }) => void;
            error_callback?: (err: { type?: string; message?: string }) => void;
          }) => { requestAccessToken: (overrideConfig?: { prompt?: string; hint?: string }) => void };
        };
      };
    };
  }).google?.accounts?.oauth2;

  if (!googleAccounts) {
    throw new Error('Google OAuth2 クライアントの初期化に失敗しました。');
  }

  return new Promise<{ accessToken: string; expiresAt: number }>((resolve, reject) => {
    const tokenClient = googleAccounts.initTokenClient({
      client_id: options.clientId,
      scope: REQUIRED_OAUTH_SCOPES,
      hint: options.loginHintEmail,
      prompt: options.prompt ?? '',
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(
            new Error(
              response.error_description ||
                response.error ||
                'OAuthアクセストークンの取得がキャンセルまたは拒否されました。'
            )
          );
          return;
        }
        const expiresInSec = Number(response.expires_in || 3599);
        // 安全マージンとして30秒差し引いた時刻を有効期限とする
        const expiresAt = Date.now() + Math.max(60, expiresInSec - 30) * 1000;
        resolve({
          accessToken: response.access_token,
          expiresAt
        });
      },
      error_callback: (err) => {
        reject(
          new Error(
            err?.message ||
              (err?.type === 'popup_closed'
                ? '認証ポップアップが閉じられました。もう一度お試しください。'
                : 'Google OAuth 認可ポップアップでエラーが発生しました。')
          )
        );
      }
    });

    tokenClient.requestAccessToken({
      prompt: options.prompt ?? '',
      hint: options.loginHintEmail
    });
  });
}

/**
 * ログアウト時に Google OAuth アクセストークンを明示的に失効 (revoke) させ、自動選択も解除する
 */
export function revokeGoogleTokens(accessToken: string | null | undefined): Promise<void> {
  return new Promise((resolve) => {
    const g = (window as unknown as {
      google?: {
        accounts?: {
          id?: { disableAutoSelect: () => void };
          oauth2?: { revoke: (token: string, done: () => void) => void };
        };
      };
    }).google?.accounts;

    try {
      g?.id?.disableAutoSelect();
    } catch {
      // ignore
    }

    if (accessToken && g?.oauth2?.revoke) {
      try {
        g.oauth2.revoke(accessToken, () => resolve());
        return;
      } catch {
        resolve();
        return;
      }
    }
    resolve();
  });
}
