/**
 * src/js/app.tsx
 * 統合管理システムのルートReactアプリケーション。
 *
 * - 未認証時は管理機能を一切描画せず、Google Identity Services のログイン画面（および初回接続設定パネル）のみを表示
 * - Sign in with Google (IDトークン検証) -> OAuth 2.0 Token Client (Apps Script APIアクセストークン取得)
 *   -> GAS `auth.verify` (管理者メールアドレス一致確認) の3段階認証を通過した本人だけに管理画面を表示
 * - トークン有効期限監視と失効時のワンクリック再認証バナー
 * - 6セクション（Dashboard / Articles / Notices / Inquiries / Applications / Settings）の統合レイアウト
 */

import React, { useEffect, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  LayoutDashboard,
  FileText,
  Bell,
  Inbox,
  AppWindow,
  Settings,
  LogOut,
  RefreshCw,
  AlertTriangle,
  X,
  Sliders,
  Menu,
  CloudSun
} from 'lucide-react';
import { useAppStore } from './store';
import {
  decodeAndVerifyIdTokenClaims,
  loadGoogleIdentityScript,
  requestGoogleAccessToken,
  revokeGoogleTokens
} from './auth';
import { callAdminApi } from './api';
import {
  getPublicConnectionConfig,
  savePublicConnectionConfig,
  getSavedAdminHint,
  saveAdminHint,
  clearSavedAdminHint
} from './utils';
import { publicConnectionConfigSchema } from '../schemas/validation';
import { DashboardSection } from './dashboard';
import { ArticlesSection } from './articles';
import { NoticesSection } from './notices';
import { InquiriesSection } from './inquiries';
import { ApplicationsSection } from './applications';
import { SettingsSection } from './settings';
import type { SectionId } from '../types/domain';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,
      retry: 1,
      refetchOnWindowFocus: false
    }
  }
});

const NAV_ITEMS: Array<{
  id: SectionId;
  label: string;
  badgeColor: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'dashboard', label: 'ホーム', badgeColor: 'bg-blue-100 text-blue-600', icon: LayoutDashboard },
  { id: 'articles', label: '記事ノート', badgeColor: 'bg-indigo-100 text-indigo-600', icon: FileText },
  { id: 'notices', label: 'お知らせ', badgeColor: 'bg-amber-100 text-amber-600', icon: Bell },
  { id: 'inquiries', label: 'おたより', badgeColor: 'bg-sky-100 text-sky-600', icon: Inbox },
  { id: 'applications', label: 'マイアプリ', badgeColor: 'bg-emerald-100 text-emerald-600', icon: AppWindow },
  { id: 'settings', label: '設定', badgeColor: 'bg-slate-100 text-slate-600', icon: Settings }
];

export const AdminDashboardApp: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <AdminShell />
    </QueryClientProvider>
  );
};

const AdminShell: React.FC = () => {
  const {
    authUser,
    tokenExpiredMessage,
    authError,
    activeSection,
    setActiveSection,
    setAuthUser,
    updateAccessToken,
    setAuthError,
    clearAuth,
    toasts,
    pushToast,
    dismissToast
  } = useAppStore();

  const [isAuthenticating, setIsAuthenticating] = useState<boolean>(false);
  const [isReauthenticating, setIsReauthenticating] = useState<boolean>(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState<boolean>(false);

  // アクセストークンの残り有効期限を定期監視（15秒ごと）
  useEffect(() => {
    if (!authUser) return;
    const timer = window.setInterval(() => {
      if (Date.now() >= authUser.accessTokenExpiresAt) {
        useAppStore
          .getState()
          .markTokenExpired('OAuthアクセストークンの有効期限が切れました。再認証を実行してください。');
      }
    }, 15000);
    return () => window.clearInterval(timer);
  }, [authUser]);

  // ログアウト処理
  const handleLogout = async () => {
    const currentToken = authUser?.accessToken;
    clearSavedAdminHint();
    clearAuth();
    queryClient.clear();
    await revokeGoogleTokens(currentToken);
    pushToast({
      type: 'info',
      title: 'ログアウトしました'
    });
  };

  // トークン失効時の再認証
  const handleReauthenticate = async () => {
    if (!authUser) return;
    const conn = getPublicConnectionConfig();
    setIsReauthenticating(true);
    try {
      const tokenRes = await requestGoogleAccessToken({
        clientId: conn.googleClientId,
        loginHintEmail: authUser.email,
        prompt: ''
      });
      updateAccessToken(tokenRes.accessToken, tokenRes.expiresAt);
      pushToast({
        type: 'success',
        title: 'OAuthアクセストークンを再取得しました'
      });
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : '再認証に失敗しました');
    } finally {
      setIsReauthenticating(false);
    }
  };

  // 未ログイン時は管理機能を一切表示せずログイン画面のみを表示
  if (!authUser) {
    return (
      <>
        <LoginGateway
          isAuthenticating={isAuthenticating}
          setIsAuthenticating={setIsAuthenticating}
          authError={authError}
          setAuthError={setAuthError}
          onAuthenticated={(user) => {
            saveAdminHint({
              email: user.email,
              name: user.name,
              picture: user.picture
            });
            setAuthUser(user);
            pushToast({
              type: 'success',
              title: '管理者認証に成功しました',
              message: `ログインアカウント: ${user.email}`
            });
          }}
        />
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      </>
    );
  }

  return (
    <div className="admin-shell">
      {/* スマホ用ドロワー背景オーバーレイ */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 bg-slate-900/35 backdrop-blur-xs z-30 md:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* 左サイドバー（すっきり＆柔らかなパステルブルー基調・枠線なし） */}
      <aside className={`admin-sidebar ${isMobileMenuOpen ? 'mobile-open' : ''}`}>
        <div className="p-5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
              <CloudSun className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-bold text-slate-900 tracking-tight">
                Dev Atelier
              </div>
              <div className="text-[11px] text-slate-500">
                個人開発スタジオ
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsMobileMenuOpen(false)}
            className="md:hidden p-1.5 text-slate-500 hover:text-slate-900 bg-white rounded-full"
            aria-label="メニューを閉じる"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <nav className="flex-1 px-3 py-1 space-y-1.5 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveSection(item.id);
                  setIsMobileMenuOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl text-left transition-all ${
                  active
                    ? 'bg-white text-slate-900 font-bold shadow-sm'
                    : 'text-slate-600 hover:bg-white/60 hover:text-slate-900 font-medium'
                }`}
              >
                <div
                  className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 transition-transform ${
                    active ? 'bg-blue-600 text-white scale-105' : item.badgeColor
                  }`}
                >
                  <Icon className="w-4 h-4" />
                </div>
                <span className="text-xs">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-3.5 m-3 rounded-2xl bg-white/80 space-y-2.5 text-xs">
          <div className="flex items-center gap-2">
            {authUser.picture ? (
              <img
                src={authUser.picture}
                alt=""
                className="w-7 h-7 rounded-full shrink-0"
              />
            ) : (
              <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 font-bold flex items-center justify-center shrink-0">
                {authUser.email.slice(0, 1).toUpperCase()}
              </div>
            )}
            <span className="font-mono text-[11px] font-medium text-slate-700 truncate">
              {authUser.email.split('@')[0]}
            </span>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-full"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>ログアウト</span>
          </button>
        </div>
      </aside>

      {/* メイン領域 */}
      <div className="admin-main">
        <header className="admin-header">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => setIsMobileMenuOpen(true)}
              className="md:hidden p-2 -ml-1 text-slate-700 bg-white hover:bg-slate-100 rounded-full shadow-2xs shrink-0"
              aria-label="メニューを開く"
            >
              <Menu className="w-4 h-4" />
            </button>
            <h1 className="text-base sm:text-lg font-bold text-slate-900 truncate">
              {NAV_ITEMS.find((n) => n.id === activeSection)?.label}
            </h1>
          </div>

          <button
            type="button"
            disabled={isReauthenticating}
            onClick={handleReauthenticate}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-white hover:bg-slate-100 rounded-full shadow-2xs shrink-0"
            title="OAuthアクセストークンの有効期限を延長します"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isReauthenticating ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">トークン更新</span>
          </button>
        </header>

        {tokenExpiredMessage && (
          <div className="mx-3 sm:mx-6 mt-2 bg-amber-50 rounded-2xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 shadow-2xs">
            <div className="flex items-center gap-2 text-xs text-amber-900 font-medium">
              <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
              <span>{tokenExpiredMessage}</span>
            </div>
            <button
              type="button"
              disabled={isReauthenticating}
              onClick={handleReauthenticate}
              className="px-3.5 py-1 text-xs font-semibold bg-amber-800 text-white rounded-full hover:bg-amber-900"
            >
              {isReauthenticating ? '再認証中...' : '再認証する'}
            </button>
          </div>
        )}

        <main className="admin-content">
          {activeSection === 'dashboard' && <DashboardSection />}
          {activeSection === 'articles' && <ArticlesSection />}
          {activeSection === 'notices' && <NoticesSection />}
          {activeSection === 'inquiries' && <InquiriesSection />}
          {activeSection === 'applications' && <ApplicationsSection />}
          {activeSection === 'settings' && <SettingsSection />}
        </main>

        {/* スマホ用下部フローティングボトムナビゲーション */}
        <nav className="md:hidden fixed bottom-2.5 left-2.5 right-2.5 z-20 bg-white/95 backdrop-blur-md rounded-2xl grid grid-cols-6 py-1.5 px-1 shadow-lg">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveSection(item.id)}
                className={`flex flex-col items-center justify-center py-1 rounded-xl text-[10px] ${
                  active ? 'text-blue-600 font-bold bg-blue-50' : 'text-slate-500'
                }`}
              >
                <Icon className="w-4 h-4 mb-0.5" />
                <span className="truncate max-w-full px-0.5">{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
};

/**
 * 未ログイン時のGoogle認証ゲートウェイ画面
 */
interface LoginGatewayProps {
  isAuthenticating: boolean;
  setIsAuthenticating: (v: boolean) => void;
  authError: string | null;
  setAuthError: (msg: string | null) => void;
  onAuthenticated: (user: {
    email: string;
    name: string;
    picture: string;
    idToken: string;
    idTokenExp: number;
    accessToken: string;
    accessTokenExpiresAt: number;
  }) => void;
}

const LoginGateway: React.FC<LoginGatewayProps> = ({
  isAuthenticating,
  setIsAuthenticating,
  authError,
  setAuthError,
  onAuthenticated
}) => {
  const googleButtonContainerRef = useRef<HTMLDivElement | null>(null);
  const [connConfig, setConnConfig] = useState(() => getPublicConnectionConfig());
  const [savedHint, setSavedHint] = useState(() => getSavedAdminHint());
  const [showConfigEditor, setShowConfigEditor] = useState<boolean>(
    () => !connConfig.googleClientId || !connConfig.gasDeploymentId
  );
  const [configError, setConfigError] = useState<string | null>(null);
  const [pendingIdToken, setPendingIdToken] = useState<{
    idToken: string;
    email: string;
    name: string;
    picture: string;
    exp: number;
  } | null>(null);

  const isConfigured = Boolean(connConfig.googleClientId && connConfig.gasDeploymentId);

  // 前回ログイン済みのアカウントヒントがある場合、ワンクリックでOAuthトークン再取得＋GAS本人確認で即時復帰
  const handleQuickResumeSession = async (hintEmail: string, hintName: string, hintPicture: string, idTokenStr = '', idTokenExp = 0) => {
    setIsAuthenticating(true);
    setAuthError(null);
    try {
      const tokenRes = await requestGoogleAccessToken({
        clientId: connConfig.googleClientId,
        loginHintEmail: hintEmail,
        prompt: ''
      });

      const tempUser = {
        email: hintEmail,
        name: hintName || hintEmail,
        picture: hintPicture,
        idToken: idTokenStr,
        idTokenExp: idTokenExp || Math.floor(tokenRes.expiresAt / 1000),
        accessToken: tokenRes.accessToken,
        accessTokenExpiresAt: tokenRes.expiresAt
      };
      useAppStore.getState().setAuthUser(tempUser);

      const verifyRes = await callAdminApi<{ authenticated: boolean; email: string }>('auth.verify', {});
      const confirmedUser = {
        ...tempUser,
        email: verifyRes.email || hintEmail
      };

      onAuthenticated(confirmedUser);
    } catch (err) {
      useAppStore.getState().clearAuth();
      setAuthError(
        err instanceof Error
          ? err.message
          : 'セッションの再開に失敗しました。もう一度Googleログインを実行してください。'
      );
    } finally {
      setIsAuthenticating(false);
    }
  };

  // Google Identity Services Sign in with Google ボタン & 自動One Tap復帰の初期化
  useEffect(() => {
    if (!isConfigured || !googleButtonContainerRef.current) return;

    let cancelled = false;
    loadGoogleIdentityScript()
      .then(() => {
        if (cancelled || !googleButtonContainerRef.current) return;
        const gId = (window as unknown as {
          google?: {
            accounts?: {
              id?: {
                initialize: (cfg: {
                  client_id: string;
                  callback: (res: { credential?: string }) => void;
                  auto_select?: boolean;
                }) => void;
                renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
                prompt: () => void;
              };
            };
          };
        }).google?.accounts?.id;

        if (!gId) return;

        const hasHint = Boolean(getSavedAdminHint());

        gId.initialize({
          client_id: connConfig.googleClientId,
          // 前回ログイン済み（ログアウトしていない）場合は auto_select を有効にして自動選択させる
          auto_select: hasHint,
          callback: async (response) => {
            if (!response.credential) {
              setAuthError('Google IDトークンが取得できませんでした。');
              return;
            }
            try {
              const claims = decodeAndVerifyIdTokenClaims(
                response.credential,
                connConfig.googleClientId
              );
              const nextPending = {
                idToken: response.credential,
                email: claims.email,
                name: claims.name || claims.email,
                picture: claims.picture || '',
                exp: claims.exp
              };
              setPendingIdToken(nextPending);
              setSavedHint({
                email: nextPending.email,
                name: nextPending.name,
                picture: nextPending.picture
              });
              saveAdminHint({
                email: nextPending.email,
                name: nextPending.name,
                picture: nextPending.picture
              });
              setAuthError(null);
            } catch (err) {
              setAuthError(err instanceof Error ? err.message : 'IDトークン検証エラー');
            }
          }
        });

        googleButtonContainerRef.current.innerHTML = '';
        gId.renderButton(googleButtonContainerRef.current, {
          theme: 'outline',
          size: 'large',
          type: 'standard',
          text: 'signin_with',
          shape: 'rectangular',
          width: 320
        });

        if (hasHint) {
          try {
            gId.prompt();
          } catch {
            // ignore One Tap prompt error
          }
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setAuthError(err instanceof Error ? err.message : 'Google認証スクリプトのロードに失敗しました');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [connConfig.googleClientId, isConfigured, setAuthError]);

  // Step 2: OAuth 2.0 アクセストークンを取得し、GAS側の adminApiDispatch('auth.verify') で管理者本人か検証
  const handleCompleteOAuthAndVerify = async () => {
    if (!pendingIdToken) return;
    setIsAuthenticating(true);
    setAuthError(null);

    try {
      const tokenRes = await requestGoogleAccessToken({
        clientId: connConfig.googleClientId,
        loginHintEmail: pendingIdToken.email,
        prompt: ''
      });

      // 一時的にストアに設定してGAS側の本人確認APIを呼び出す
      const tempUser = {
        email: pendingIdToken.email,
        name: pendingIdToken.name,
        picture: pendingIdToken.picture,
        idToken: pendingIdToken.idToken,
        idTokenExp: pendingIdToken.exp,
        accessToken: tokenRes.accessToken,
        accessTokenExpiresAt: tokenRes.expiresAt
      };
      useAppStore.getState().setAuthUser(tempUser);

      // GAS 側で Session.getActiveUser().getEmail() === ADMIN_EMAIL および IDトークン検証を実施
      await callAdminApi<{ authenticated: boolean; email: string }>('auth.verify', {});

      onAuthenticated(tempUser);
    } catch (err) {
      useAppStore.getState().clearAuth();
      setAuthError(
        err instanceof Error
          ? err.message
          : '管理者認証またはGASバックエンドでの権限確認に失敗しました。'
      );
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleSaveConnectionConfig = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = publicConnectionConfigSchema.safeParse(connConfig);
    if (!parsed.success) {
      setConfigError(parsed.error.issues[0]?.message || '設定値を確認してください');
      return;
    }
    setConfigError(null);
    savePublicConnectionConfig(parsed.data);
    setConnConfig(parsed.data);
    setShowConfigEditor(false);
    setAuthError(null);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-md w-full p-7 space-y-5 shadow-md">
        <div className="pb-2 flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
            <CloudSun className="w-6 h-6" />
          </div>
          <div>
            <div className="text-base font-bold text-slate-900">
              Dev Atelier
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              あなた専用の個人開発スタジオ
            </p>
          </div>
        </div>

        {authError && (
          <div className="p-3 bg-red-50 border border-red-200 rounded text-xs text-red-800 space-y-1">
            <div className="font-bold">認証・認可エラー</div>
            <div>{authError}</div>
          </div>
        )}

        {!isConfigured || showConfigEditor ? (
          <form onSubmit={handleSaveConnectionConfig} className="space-y-3 text-xs">
            <div className="p-3 bg-slate-50 border border-slate-200 rounded text-slate-700 leading-relaxed">
              <strong>初期接続設定：</strong>
              ビルド時環境変数（<code>PUBLIC_GOOGLE_CLIENT_ID</code> / <code>PUBLIC_GAS_DEPLOYMENT_ID</code>）が未設定の場合、ここで公開識別子を設定して安全に初期化できます（※秘密情報は一切入力しないでください）。
            </div>

            {configError && (
              <div className="p-2.5 bg-red-50 border border-red-200 rounded text-red-800 font-medium">
                {configError}
              </div>
            )}

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Google OAuth クライアントID *
              </label>
              <input
                type="text"
                value={connConfig.googleClientId}
                onChange={(e) => setConnConfig({ ...connConfig, googleClientId: e.target.value })}
                placeholder="1234567890-abcdef.apps.googleusercontent.com"
                className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded bg-white"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                GAS API Executable デプロイID (またはスクリプトID) *
              </label>
              <input
                type="text"
                value={connConfig.gasDeploymentId}
                onChange={(e) => setConnConfig({ ...connConfig, gasDeploymentId: e.target.value })}
                placeholder="AKfycbx..."
                className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded bg-white"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                公開API WebアプリURL（任意）
              </label>
              <input
                type="text"
                value={connConfig.gasWebAppUrl}
                onChange={(e) => setConnConfig({ ...connConfig, gasWebAppUrl: e.target.value })}
                placeholder="https://script.google.com/macros/s/.../exec"
                className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded bg-white"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              {isConfigured && (
                <button
                  type="button"
                  onClick={() => setShowConfigEditor(false)}
                  className="px-3 py-1.5 border border-slate-300 rounded bg-white text-slate-700"
                >
                  キャンセル
                </button>
              )}
              <button
                type="submit"
                className="px-4 py-1.5 font-semibold bg-slate-900 text-white rounded hover:bg-slate-800"
              >
                接続設定を保存してログインへ進む
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            {/* 前回ログイン済みの場合：1クリックで即座にセッション復帰（アクセストークン自体はlocalStorageに保存せず安全に再取得） */}
            {savedHint && !pendingIdToken && (
              <div className="p-4 bg-blue-50 border border-blue-200 rounded space-y-3">
                <div className="text-xs">
                  <span className="text-blue-800 font-semibold block">前回のログインアカウントが記憶されています</span>
                  <span className="font-mono text-slate-900 font-bold mt-0.5 block">{savedHint.email}</span>
                  <span className="text-[11px] text-slate-600 block mt-1">
                    ※セキュリティ要件によりアクセストークンはブラウザに保存していませんが、下のボタン1クリックで即座に再開できます。
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={isAuthenticating}
                    onClick={() =>
                      handleQuickResumeSession(savedHint.email, savedHint.name, savedHint.picture)
                    }
                    className="flex-1 py-2 px-4 text-xs font-semibold bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                  >
                    {isAuthenticating ? 'セッションを再開中...' : `${savedHint.email} で即座に再開する（1クリック）`}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      clearSavedAdminHint();
                      setSavedHint(null);
                    }}
                    className="px-2.5 py-2 text-xs text-slate-600 hover:text-slate-900 border border-slate-300 bg-white rounded"
                    title="記憶したアカウントをクリア"
                  >
                    切替
                  </button>
                </div>
              </div>
            )}

            {/* Step 1: Google Identity Services Sign in with Google (IDトークン本人確認) */}
            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-700">
                {savedHint ? 'または Google ボタンからサインイン:' : 'Step 1: Googleアカウント本人確認 (IDトークン検証)'}
              </div>
              <div ref={googleButtonContainerRef} className="min-h-[44px] flex items-center" />
            </div>

            {/* Step 2: OAuth 2.0 アクセストークン取得とGAS管理者照合 */}
            {pendingIdToken && (
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded space-y-3">
                <div className="text-xs">
                  <span className="text-slate-500 block">確認済みGoogleアカウント:</span>
                  <span className="font-mono font-semibold text-slate-900">{pendingIdToken.email}</span>
                </div>
                <button
                  type="button"
                  disabled={isAuthenticating}
                  onClick={handleCompleteOAuthAndVerify}
                  className="w-full py-2 px-4 text-xs font-semibold bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                >
                  {isAuthenticating
                    ? 'Apps Script API の権限を確認中...'
                    : 'Step 2: GAS管理APIへのアクセスを認可してログイン'}
                </button>
              </div>
            )}

            <div className="pt-2 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
              <span>接続先GAS: {connConfig.gasDeploymentId.slice(0, 14)}...</span>
              <button
                type="button"
                onClick={() => setShowConfigEditor(true)}
                className="inline-flex items-center gap-1 text-slate-600 hover:text-slate-900 underline"
              >
                <Sliders className="w-3 h-3" />
                <span>接続設定を変更</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * トースト通知コンポーネント
 */
const ToastContainer: React.FC<{
  toasts: Array<{ id: string; type: 'success' | 'error' | 'warning' | 'info'; title: string; message?: string }>;
  onDismiss: (id: string) => void;
}> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-md w-full pointer-events-none">
      {toasts.map((t) => {
        const colorClass =
          t.type === 'success'
            ? 'bg-emerald-900 text-white border-emerald-700'
            : t.type === 'error'
            ? 'bg-red-900 text-white border-red-700'
            : t.type === 'warning'
            ? 'bg-amber-900 text-white border-amber-700'
            : 'bg-slate-900 text-white border-slate-700';
        return (
          <div
            key={t.id}
            className={`pointer-events-auto border rounded-md p-3 shadow-md flex items-start justify-between gap-3 text-xs ${colorClass}`}
          >
            <div className="space-y-0.5">
              <div className="font-bold">{t.title}</div>
              {t.message && <div className="opacity-90 break-all">{t.message}</div>}
            </div>
            <button
              type="button"
              onClick={() => onDismiss(t.id)}
              className="opacity-75 hover:opacity-100 shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
