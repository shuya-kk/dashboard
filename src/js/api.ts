/**
 * src/js/api.ts
 * Google Apps Script API (`https://script.googleapis.com/v1/scripts/{scriptId}:run`) 通信クライアント。
 *
 * - OAuthアクセストークンの有効期限確認・失効時の自動検知
 * - タイムアウト制御（30秒）
 * - 再試行可能なエラー（レート制限・一時的な通信失敗・ロック競合）と再認証が必要なエラー（401 / TOKEN_EXPIRED）の厳密な分類
 * - GitHub SHA競合エラー（GITHUB_SHA_CONFLICT）の詳細データ保持
 */

import { useAppStore } from './store';
import { getPublicConnectionConfig } from './utils';
import type { ShaConflictDetails } from '../types/domain';

export class AdminApiError extends Error {
  public readonly code: string;
  public readonly retryable: boolean;
  public readonly requiresReauth: boolean;
  public readonly details: ShaConflictDetails | Record<string, unknown> | null;

  constructor(options: {
    code: string;
    message: string;
    retryable?: boolean;
    requiresReauth?: boolean;
    details?: ShaConflictDetails | Record<string, unknown> | null;
  }) {
    super(options.message);
    this.name = 'AdminApiError';
    this.code = options.code;
    this.retryable = Boolean(options.retryable);
    this.requiresReauth = Boolean(options.requiresReauth);
    this.details = options.details ?? null;
  }
}

interface GasScriptsRunHttpResponse {
  done?: boolean;
  response?: {
    '@type'?: string;
    result?: {
      ok: boolean;
      data?: unknown;
      error?: {
        code?: string;
        message?: string;
        retryable?: boolean;
        details?: ShaConflictDetails | Record<string, unknown> | null;
      };
      timestamp?: string;
    };
  };
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: Array<{
      '@type'?: string;
      errorMessage?: string;
      errorType?: string;
    }>;
  };
}

const DEFAULT_TIMEOUT_MS = 30000;

/**
 * 管理API (`scripts.run` -> `adminApiDispatch`) を呼び出す共通関数
 */
export async function callAdminApi<TResponse = unknown>(
  action: string,
  params: Record<string, unknown> = {},
  options?: {
    timeoutMs?: number;
    maxRetries?: number;
  }
): Promise<TResponse> {
  const store = useAppStore.getState();
  const user = store.authUser;
  const conn = getPublicConnectionConfig();

  if (!conn.gasDeploymentId) {
    throw new AdminApiError({
      code: 'CONFIG_MISSING',
      message: 'GAS API Executable の Deployment ID（または Script ID）が設定されていません。接続設定を確認してください。',
      retryable: false,
      requiresReauth: false
    });
  }

  if (!user || !user.accessToken) {
    store.markTokenExpired('Googleアカウントでログインしていません。');
    throw new AdminApiError({
      code: 'UNAUTHORIZED',
      message: 'ログインが必要です。Googleアカウントでログインしてください。',
      retryable: false,
      requiresReauth: true
    });
  }

  // アクセストークンの有効期限チェック
  if (Date.now() >= user.accessTokenExpiresAt) {
    store.markTokenExpired('OAuthアクセストークンの有効期限が切れました。再認証してください。');
    throw new AdminApiError({
      code: 'TOKEN_EXPIRED',
      message: 'OAuthアクセストークンの有効期限が切れました。「アクセストークンを再取得」ボタンを押して再認証してください。',
      retryable: false,
      requiresReauth: true
    });
  }

  const maxRetries = options?.maxRetries ?? 1;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let attempt = 0;

  while (true) {
    attempt++;
    try {
      return await executeSingleGasRunRequest<TResponse>({
        deploymentId: conn.gasDeploymentId,
        accessToken: user.accessToken,
        idToken: user.idToken,
        action,
        params,
        timeoutMs
      });
    } catch (err) {
      if (err instanceof AdminApiError) {
        if (err.requiresReauth) {
          useAppStore.getState().markTokenExpired(err.message);
          throw err;
        }
        if (err.retryable && attempt <= maxRetries) {
          await sleepMs(700 * attempt);
          continue;
        }
        throw err;
      }
      throw new AdminApiError({
        code: 'UNKNOWN_ERROR',
        message: err instanceof Error ? err.message : '予期しない通信エラーが発生しました。',
        retryable: true
      });
    }
  }
}

async function executeSingleGasRunRequest<TResponse>(args: {
  deploymentId: string;
  accessToken: string;
  idToken: string;
  action: string;
  params: Record<string, unknown>;
  timeoutMs: number;
}): Promise<TResponse> {
  const endpoint = `https://script.googleapis.com/v1/scripts/${encodeURIComponent(args.deploymentId)}:run`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${args.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        function: 'adminApiDispatch',
        parameters: [
          {
            action: args.action,
            params: args.params,
            auth: {
              idToken: args.idToken
            }
          }
        ],
        devMode: false
      }),
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new AdminApiError({
        code: 'GAS_TIMEOUT',
        message: 'Google Apps Script APIの応答がタイムアウトしました（30秒）。処理対象が多すぎるか通信が不安定な可能性があります。',
        retryable: true
      });
    }
    throw new AdminApiError({
      code: 'NETWORK_ERROR',
      message: 'Apps Script APIへの通信に失敗しました。インターネット接続を確認して再試行してください。',
      retryable: true
    });
  } finally {
    clearTimeout(timer);
  }

  let body: GasScriptsRunHttpResponse | null = null;
  try {
    body = (await response.json()) as GasScriptsRunHttpResponse;
  } catch {
    body = null;
  }

  // HTTP 401: OAuthアクセストークンの失効
  if (response.status === 401) {
    throw new AdminApiError({
      code: 'OAUTH_TOKEN_EXPIRED',
      message: 'OAuthアクセストークンが失効しました。再認証を実行してください。',
      retryable: false,
      requiresReauth: true
    });
  }

  // HTTP 403: 権限不足（別のGoogleアカウント、またはApps Script API未有効化）
  if (response.status === 403) {
    const googleMsg = body?.error?.message || '';
    throw new AdminApiError({
      code: 'APPS_SCRIPT_FORBIDDEN',
      message:
        'Apps Script APIの実行権限がありません。許可されたGoogleアカウントでログインしているか、およびGoogle CloudでApps Script APIが有効化されているか確認してください。（詳細: ' +
        (googleMsg || 'HTTP 403') +
        '）',
      retryable: false,
      requiresReauth: false
    });
  }

  // HTTP 404: Deployment ID / Script ID 不正
  if (response.status === 404) {
    throw new AdminApiError({
      code: 'GAS_NOT_FOUND',
      message:
        '指定されたGAS Deployment ID（またはScript ID）が見つかりません。GASが「API 実行可能ファイル (API Executable)」としてデプロイされているか確認してください。',
      retryable: false
    });
  }

  // HTTP 429 / 5xx
  if (!response.ok) {
    const errMsg = body?.error?.message || `HTTP ${response.status}`;
    throw new AdminApiError({
      code: 'APPS_SCRIPT_HTTP_ERROR',
      message: `Apps Script API 呼び出しエラーが発生しました (${errMsg})`,
      retryable: response.status >= 500 || response.status === 429
    });
  }

  // scripts.run 自体がスクリプト例外を返した場合
  if (body?.error) {
    const detailMsg = body.error.details?.[0]?.errorMessage || body.error.message || 'GAS実行エラー';
    const isTimeout =
      detailMsg.includes('Exceeded maximum execution time') ||
      detailMsg.includes('最大実行時間を超えました');

    throw new AdminApiError({
      code: isTimeout ? 'GAS_EXECUTION_TIMEOUT' : 'GAS_SCRIPT_ERROR',
      message: isTimeout
        ? 'GASの最大実行時間を超過しました。時間を置いて再試行してください。'
        : `GAS実行エラー: ${detailMsg}`,
      retryable: isTimeout
    });
  }

  const appResult = body?.response?.result;
  if (!appResult) {
    throw new AdminApiError({
      code: 'EMPTY_GAS_RESULT',
      message: 'GASから有効なレスポンスが返却されませんでした。関数名 `adminApiDispatch` がデプロイに含まれているか確認してください。',
      retryable: false
    });
  }

  if (!appResult.ok) {
    const errObj = appResult.error || {};
    const errCode = errObj.code || 'APP_ERROR';
    const requiresReauth = errCode === 'UNAUTHORIZED' || errCode === 'TOKEN_EXPIRED';

    throw new AdminApiError({
      code: errCode,
      message: errObj.message || '処理中にエラーが発生しました。',
      retryable: Boolean(errObj.retryable),
      requiresReauth,
      details: errObj.details ?? null
    });
  }

  return appResult.data as TResponse;
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
