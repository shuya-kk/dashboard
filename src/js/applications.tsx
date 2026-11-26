/**
 * src/js/applications.tsx
 * アプリ情報管理セクション（Applications）。
 *
 * Applicationsシート（id, name, bundleId, appStoreUrl, isActive, createdAt, updatedAt）の
 * 一覧表示・新規追加・編集・削除を管理します。
 * お知らせやお問い合わせ機能はこのマスターを参照します。
 */

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AppWindow,
  Plus,
  Edit3,
  Trash2,
  ExternalLink,
  Copy,
  Check,
  RefreshCw,
  ShieldCheck,
  AlertCircle
} from 'lucide-react';
import { callAdminApi } from './api';
import { useAppStore } from './store';
import { formatDateTimeJst } from './utils';
import { applicationInputSchema } from '../schemas/validation';
import type { ApplicationItem, AppStoreConnectConfigStatus } from '../types/domain';

const ASC_STATE_LABELS: Record<string, { label: string; className: string }> = {
  READY_FOR_SALE: { label: '配信中 (READY_FOR_SALE)', className: 'bg-emerald-50 text-emerald-800 border-emerald-300' },
  PREPARE_FOR_SUBMISSION: { label: '提出準備中', className: 'bg-amber-50 text-amber-800 border-amber-300' },
  WAITING_FOR_REVIEW: { label: '審査待ち', className: 'bg-blue-50 text-blue-800 border-blue-300' },
  IN_REVIEW: { label: '審査中', className: 'bg-blue-50 text-blue-800 border-blue-300' },
  REJECTED: { label: 'リジェクト', className: 'bg-red-50 text-red-800 border-red-300' },
  DEVELOPER_REMOVED_FROM_SALE: { label: '配信停止', className: 'bg-slate-100 text-slate-600 border-slate-300' }
};

export const ApplicationsSection: React.FC = () => {
  const queryClient = useQueryClient();
  const { pushToast } = useAppStore();

  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [editingApp, setEditingApp] = useState<ApplicationItem | null>(null);
  const [name, setName] = useState<string>('');
  const [bundleId, setBundleId] = useState<string>('');
  const [appStoreUrl, setAppStoreUrl] = useState<string>('');
  const [isActive, setIsActive] = useState<boolean>(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ApplicationItem | null>(null);
  const [copiedId, setCopiedId] = useState<string>('');
  const [showAscGuide, setShowAscGuide] = useState<boolean>(false);

  const appsQuery = useQuery({
    queryKey: ['applications'],
    queryFn: () =>
      callAdminApi<{
        applications: ApplicationItem[];
        ascStatus?: AppStoreConnectConfigStatus;
      }>('applications.list')
  });

  const applications = appsQuery.data?.applications ?? [];
  const ascStatus = appsQuery.data?.ascStatus;

  // App Store Connect API との同期 Mutation
  const syncAscMutation = useMutation({
    mutationFn: () =>
      callAdminApi<{
        totalFetched: number;
        createdCount: number;
        updatedCount: number;
        applications: ApplicationItem[];
      }>('applications.syncAsc'),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['applications'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      pushToast({
        type: 'success',
        title: 'App Store Connect API と同期しました',
        message: `取得: ${res.totalFetched}件（新規登録: ${res.createdCount}件 / 既存更新: ${res.updatedCount}件）`
      });
    },
    onError: (err) => {
      pushToast({
        type: 'error',
        title: 'App Store Connect との同期に失敗しました',
        message: err instanceof Error ? err.message : '同期エラー'
      });
    }
  });

  const openCreateModal = () => {
    setEditingApp(null);
    setName('');
    setBundleId('');
    setAppStoreUrl('');
    setIsActive(true);
    setFormError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (app: ApplicationItem) => {
    setEditingApp(app);
    setName(app.name);
    setBundleId(app.bundleId);
    setAppStoreUrl(app.appStoreUrl);
    setIsActive(app.isActive);
    setFormError(null);
    setIsModalOpen(true);
  };

  const saveAppMutation = useMutation({
    mutationFn: async () => {
      const parsed = applicationInputSchema.safeParse({
        name,
        bundleId,
        appStoreUrl,
        isActive
      });
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message || '入力内容を確認してください');
      }
      if (editingApp) {
        return callAdminApi<ApplicationItem>('applications.update', {
          id: editingApp.id,
          ...parsed.data
        });
      }
      return callAdminApi<ApplicationItem>('applications.create', parsed.data);
    },
    onSuccess: (saved) => {
      setIsModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ['applications'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      pushToast({
        type: 'success',
        title: editingApp ? 'アプリ情報を更新しました' : '新規アプリを登録しました',
        message: `${saved.name} (${saved.bundleId})`
      });
    },
    onError: (err) => {
      setFormError(err instanceof Error ? err.message : '保存エラー');
    }
  });

  const deleteAppMutation = useMutation({
    mutationFn: (id: string) => callAdminApi<{ deletedId: string }>('applications.delete', { id }),
    onSuccess: () => {
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ['applications'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      pushToast({
        type: 'success',
        title: 'アプリを削除しました'
      });
    },
    onError: (err) => {
      setDeleteTarget(null);
      pushToast({
        type: 'error',
        title: '削除に失敗しました',
        message: err instanceof Error ? err.message : '削除エラー'
      });
    }
  });

  const handleCopyId = (text: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedId(text);
    setTimeout(() => setCopiedId(''), 2000);
  };

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-md p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <AppWindow className="w-4 h-4 text-slate-700" />
            <span>管理対象アプリマスター & App Store Connect 連携</span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            お知らせ配信・お問い合わせ受付の対象アプリを管理します。App Store Connect API と連携してマイアプリ一覧・最新バージョン・審査状態を自動同期できます。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowAscGuide((prev) => !prev)}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded border border-slate-300"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-slate-700" />
            <span>
              ASC API設定状況:{' '}
              {ascStatus?.configured ? (
                <strong className="text-emerald-700">設定済</strong>
              ) : (
                <strong className="text-amber-700">未設定（手順を見る）</strong>
              )}
            </span>
          </button>

          <button
            type="button"
            disabled={syncAscMutation.isPending}
            onClick={() => syncAscMutation.mutate()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            title="GAS内部でES256 JWTを署名し、App Store Connect API (/v1/apps) から最新情報を同期します"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncAscMutation.isPending ? 'animate-spin' : ''}`} />
            <span>
              {syncAscMutation.isPending ? 'App Store Connect 同期中...' : 'App Store Connect から同期'}
            </span>
          </button>

          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-slate-900 text-white rounded hover:bg-slate-800"
          >
            <Plus className="w-4 h-4" />
            <span>手動でアプリ追加</span>
          </button>
        </div>
      </div>

      {/* App Store Connect API のセキュア設定ガイドパネル */}
      {(showAscGuide || (ascStatus && !ascStatus.configured)) && (
        <div className="bg-slate-50 border border-slate-300 rounded-md p-4 text-xs space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 font-bold text-slate-900">
              <ShieldCheck className="w-4 h-4 text-blue-600" />
              <span>App Store Connect API のセキュア連携設定（秘密鍵はブラウザに一切渡しません）</span>
            </div>
            <button
              type="button"
              onClick={() => setShowAscGuide(false)}
              className="text-slate-500 hover:text-slate-800"
            >
              閉じる
            </button>
          </div>
          <p className="text-slate-700 leading-relaxed">
            App Store Connect の API キー（<code>.p8</code> 秘密鍵・Key ID・Issuer ID）は、セキュリティのためフロントエンド（GitHub Pages）には一切入力・配置せず、<strong>GAS の「プロジェクトの設定」→「スクリプト プロパティ」</strong>に以下の3つを登録してください。GAS 内部で ES256 (ECDSA P-256) JWT を生成して Apple 公式 API と直接通信します。
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <div className="p-2.5 bg-white border border-slate-200 rounded">
              <div className="font-mono font-bold text-slate-900 flex items-center justify-between">
                <span>ASC_ISSUER_ID</span>
                <span className={ascStatus?.hasIssuerId ? 'text-emerald-700' : 'text-amber-700'}>
                  {ascStatus?.hasIssuerId ? '✓ 登録済' : '未登録'}
                </span>
              </div>
              <div className="text-slate-500 mt-0.5">
                App Store Connect「ユーザとアクセス → 統合 → App Store Connect API」上部の Issuer ID (UUID)
              </div>
            </div>
            <div className="p-2.5 bg-white border border-slate-200 rounded">
              <div className="font-mono font-bold text-slate-900 flex items-center justify-between">
                <span>ASC_KEY_ID</span>
                <span className={ascStatus?.hasKeyId ? 'text-emerald-700' : 'text-amber-700'}>
                  {ascStatus?.hasKeyId ? '✓ 登録済' : '未登録'}
                </span>
              </div>
              <div className="text-slate-500 mt-0.5">
                作成したキーの「キー ID」（例: <code>2X9R4HXF34</code>）
              </div>
            </div>
            <div className="p-2.5 bg-white border border-slate-200 rounded">
              <div className="font-mono font-bold text-slate-900 flex items-center justify-between">
                <span>ASC_PRIVATE_KEY</span>
                <span className={ascStatus?.hasPrivateKey ? 'text-emerald-700' : 'text-amber-700'}>
                  {ascStatus?.hasPrivateKey ? '✓ 登録済' : '未登録'}
                </span>
              </div>
              <div className="text-slate-500 mt-0.5">
                ダウンロードした <code>AuthKey_XXXX.p8</code> をテキストエディタで開いた全文（<code>-----BEGIN PRIVATE KEY-----</code> から末尾まで）
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
        {appsQuery.isLoading ? (
          <div className="p-8 text-center text-sm text-slate-600">アプリ一覧を取得中...</div>
        ) : applications.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            登録されているアプリがありません。「App Store Connect から同期」または「手動でアプリ追加」から登録してください。
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                  <th className="py-2.5 px-3 sm:px-4 font-semibold">状態</th>
                  <th className="py-2.5 px-3 sm:px-4 font-semibold">アプリ名</th>
                  <th className="py-2.5 px-3 sm:px-4 font-semibold">Bundle ID / Apple ID</th>
                  <th className="py-2.5 px-3 sm:px-4 font-semibold">App Store バージョン / 状態</th>
                  <th className="py-2.5 px-3 sm:px-4 font-semibold">App ID (公開API用)</th>
                  <th className="py-2.5 px-3 sm:px-4 font-semibold">ストアURL</th>
                  <th className="py-2.5 px-3 sm:px-4 font-semibold">更新日時 (JST)</th>
                  <th className="py-2.5 px-3 sm:px-4 font-semibold text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {applications.map((app) => {
                  const stateMeta = app.appStoreState
                    ? ASC_STATE_LABELS[app.appStoreState] || {
                        label: app.appStoreState,
                        className: 'bg-slate-100 text-slate-700 border-slate-300'
                      }
                    : null;

                  return (
                    <tr key={app.id} className="hover:bg-slate-50">
                      <td className="py-2.5 px-3 sm:px-4 whitespace-nowrap">
                        <span
                          className={`inline-block px-2 py-0.5 text-xs font-medium rounded border ${
                            app.isActive
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                              : 'bg-slate-100 text-slate-600 border-slate-300'
                          }`}
                        >
                          {app.isActive ? '有効' : '無効'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 sm:px-4 font-semibold text-slate-900">
                        <div>{app.name}</div>
                        {app.platform && (
                          <span className="text-[11px] font-mono text-slate-500">{app.platform}</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 sm:px-4 font-mono text-xs text-slate-700">
                        <div>{app.bundleId}</div>
                        {app.ascAppId && (
                          <div className="text-[11px] text-slate-500">Apple ID: {app.ascAppId}</div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 sm:px-4 text-xs">
                        {app.latestVersion || stateMeta ? (
                          <div className="flex flex-col items-start gap-1">
                            {app.latestVersion && (
                              <span className="font-mono font-bold text-slate-900">
                                v{app.latestVersion}
                              </span>
                            )}
                            {stateMeta && (
                              <span className={`px-2 py-0.5 text-[11px] rounded border ${stateMeta.className}`}>
                                {stateMeta.label}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400">手動登録</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 sm:px-4">
                        <button
                          type="button"
                          onClick={() => handleCopyId(app.id)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-mono bg-slate-100 hover:bg-slate-200 text-slate-700 rounded border border-slate-200"
                          title="クリックしてApp IDをコピー"
                        >
                          <span>{app.id}</span>
                          {copiedId === app.id ? (
                            <Check className="w-3 h-3 text-emerald-600" />
                          ) : (
                            <Copy className="w-3 h-3 text-slate-500" />
                          )}
                        </button>
                      </td>
                      <td className="py-2.5 px-3 sm:px-4 text-xs whitespace-nowrap">
                        {app.appStoreUrl ? (
                          <a
                            href={app.appStoreUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                          >
                            <span>App Store</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 sm:px-4 text-xs font-mono text-slate-500 whitespace-nowrap">
                        {formatDateTimeJst(app.updatedAt)}
                      </td>
                      <td className="py-2.5 px-3 sm:px-4">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEditModal(app)}
                            className="p-1.5 text-slate-700 hover:bg-slate-100 rounded border border-slate-200"
                            title="編集"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(app)}
                            className="p-1.5 text-red-600 hover:bg-red-50 rounded border border-transparent hover:border-red-200"
                            title="削除"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* アプリ追加・編集モーダル */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-md max-w-lg w-full p-5 space-y-4 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                {editingApp ? 'アプリ情報の編集' : '新規アプリの登録'}
              </h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-xs text-slate-500 hover:text-slate-900"
              >
                閉じる
              </button>
            </div>

            {formError && (
              <div className="p-2.5 bg-red-50 border border-red-200 rounded text-xs text-red-800 font-medium">
                {formError}
              </div>
            )}

            <div className="space-y-3 text-sm">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">アプリ名 *</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="My Habit Tracker"
                  className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Bundle ID / アプリ識別子 *
                </label>
                <input
                  type="text"
                  value={bundleId}
                  onChange={(e) => setBundleId(e.target.value)}
                  placeholder="com.example.habittracker"
                  className="w-full px-3 py-1.5 text-sm font-mono border border-slate-300 rounded bg-white"
                />
                <p className="text-xs text-slate-500 mt-1">
                  ※公開APIからのお知らせ取得・お問い合わせ送信時に <code>appId</code> として指定できます。
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  App Store / Google Play / WebサイトURL（任意）
                </label>
                <input
                  type="url"
                  value={appStoreUrl}
                  onChange={(e) => setAppStoreUrl(e.target.value)}
                  placeholder="https://apps.apple.com/jp/app/..."
                  className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded bg-white"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  id="app-is-active"
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="rounded border-slate-300"
                />
                <label htmlFor="app-is-active" className="text-xs font-medium text-slate-800">
                  有効にする（無効にすると公開APIからのお知らせ取得・新規問い合わせ受付を停止します）
                </label>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-3.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded"
              >
                キャンセル
              </button>
              <button
                type="button"
                disabled={saveAppMutation.isPending}
                onClick={() => saveAppMutation.mutate()}
                className="px-4 py-1.5 text-xs font-semibold bg-slate-900 text-white rounded hover:bg-slate-800 disabled:opacity-50"
              >
                {saveAppMutation.isPending ? '保存中...' : '保存する'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 削除確認モーダル */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-md max-w-md w-full p-5 space-y-4 shadow-lg">
            <h3 className="text-base font-bold text-red-700">アプリの削除確認</h3>
            <p className="text-xs text-slate-700">
              アプリ「<strong>{deleteTarget.name}</strong> ({deleteTarget.bundleId})」を削除しますか？
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="px-3.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded"
              >
                キャンセル
              </button>
              <button
                type="button"
                disabled={deleteAppMutation.isPending}
                onClick={() => deleteAppMutation.mutate(deleteTarget.id)}
                className="px-4 py-1.5 text-xs font-semibold bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
              >
                {deleteAppMutation.isPending ? '削除中...' : '削除する'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
