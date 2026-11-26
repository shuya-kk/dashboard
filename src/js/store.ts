/**
 * src/js/store.ts
 * Zustand によるアプリケーション全体の状態管理。
 *
 * - 認証ユーザー情報とOAuthアクセストークンはメモリ内のみで保持（localStorageには一切保存しない）
 * - 現在選択中のセクション（Dashboard / Articles / Notices / Inquiries / Applications / Settings）
 * - 現在操作中のGitHubリポジトリID
 * - エディタの未保存変更フラグ（dirty状態）と画面遷移時の破棄確認ガード
 * - 通知トースト（保存成功・失敗・警告の明示）
 */

import { create } from 'zustand';
import type { AuthenticatedAdminUser, SectionId } from '../types/domain';

export interface ToastNotice {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message?: string;
}

interface AppState {
  // 認証状態（インメモリ専用）
  authUser: AuthenticatedAdminUser | null;
  tokenExpiredMessage: string | null;
  authError: string | null;

  // ナビゲーション・選択状態
  activeSection: SectionId;
  selectedRepositoryId: string;
  isEditorDirty: boolean;

  // トースト通知
  toasts: ToastNotice[];

  // アクション
  setAuthUser: (user: AuthenticatedAdminUser | null) => void;
  updateAccessToken: (accessToken: string, expiresAt: number) => void;
  markTokenExpired: (message: string) => void;
  setAuthError: (message: string | null) => void;
  clearAuth: () => void;

  setActiveSection: (section: SectionId) => void;
  setSelectedRepositoryId: (repoId: string) => void;
  setEditorDirty: (dirty: boolean) => void;

  pushToast: (toast: Omit<ToastNotice, 'id'>) => void;
  dismissToast: (id: string) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  authUser: null,
  tokenExpiredMessage: null,
  authError: null,

  activeSection: 'dashboard',
  selectedRepositoryId: '',
  isEditorDirty: false,

  toasts: [],

  setAuthUser: (user) =>
    set({
      authUser: user,
      tokenExpiredMessage: null,
      authError: null
    }),

  updateAccessToken: (accessToken, expiresAt) =>
    set((state) => {
      if (!state.authUser) return state;
      return {
        authUser: {
          ...state.authUser,
          accessToken,
          accessTokenExpiresAt: expiresAt
        },
        tokenExpiredMessage: null,
        authError: null
      };
    }),

  markTokenExpired: (message) =>
    set({
      tokenExpiredMessage: message
    }),

  setAuthError: (message) =>
    set({
      authError: message
    }),

  clearAuth: () =>
    set({
      authUser: null,
      tokenExpiredMessage: null,
      authError: null,
      isEditorDirty: false
    }),

  setActiveSection: (section) => {
    const current = get();
    if (current.activeSection === section) return;
    if (current.isEditorDirty) {
      const confirmed =
        typeof window !== 'undefined'
          ? window.confirm('編集中の記事に未保存の変更があります。画面を切り替えると未保存の変更が失われますが、移動しますか？')
          : true;
      if (!confirmed) return;
    }
    set({
      activeSection: section,
      isEditorDirty: false
    });
  },

  setSelectedRepositoryId: (repoId) => {
    const current = get();
    if (current.selectedRepositoryId === repoId) return;
    if (current.isEditorDirty) {
      const confirmed =
        typeof window !== 'undefined'
          ? window.confirm('編集中の記事に未保存の変更があります。操作対象リポジトリを切り替えますか？')
          : true;
      if (!confirmed) return;
    }
    set({
      selectedRepositoryId: repoId,
      isEditorDirty: false
    });
  },

  setEditorDirty: (dirty) =>
    set({
      isEditorDirty: dirty
    }),

  pushToast: (toast) => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    set((state) => ({
      toasts: [...state.toasts, { ...toast, id }]
    }));
    if (typeof window !== 'undefined') {
      window.setTimeout(() => {
        set((state) => ({
          toasts: state.toasts.filter((t) => t.id !== id)
        }));
      }, 5000);
    }
  },

  dismissToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id)
    }))
}));
