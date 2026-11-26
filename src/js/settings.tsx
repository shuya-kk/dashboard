/**
 * src/js/settings.tsx
 * GitHubリポジトリ管理およびシステム設定セクション（Settings）。
 *
 * 1. 複数のGitHub Pagesリポジトリの登録・編集・削除・有効無効切り替え
 *    - 表示名、GitHubオーナー、リポジトリ名、ブランチ、記事保存ディレクトリ、画像保存ディレクトリ
 *    - Markdown拡張子 (.md / .mdx / .markdown)、Frontmatter形式 (yaml / toml / json / none)
 *    - 新規記事テンプレート、公開サイトURL、記事URL生成規則、GitHubトークン参照キー (GITHUB_TOKEN_*)
 * 2. Google Sheets データベース初期化・整合確認と時間主導型トリガーの設定
 * 3. 公開API（お知らせ取得GET / お問い合わせ登録POST）のエンドポイント確認とテスト
 */

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FolderGit2,
  Plus,
  Edit3,
  Trash2,
  Database,
  Clock,
  ExternalLink,
  CheckCircle2,
  KeyRound,
  Globe
} from 'lucide-react';
import { callAdminApi } from './api';
import { useAppStore } from './store';
import {
  formatDateTimeJst,
  getPublicConnectionConfig,
  savePublicConnectionConfig
} from './utils';
import { repositoryInputSchema } from '../schemas/validation';
import type {
  FrontmatterFormat,
  RepositoryConfig,
  SystemSettingsInfo
} from '../types/domain';

const DEFAULT_YAML_TEMPLATE = `---
title: "{title}"
date: "{date}"
description: ""
draft: false
tags: []
---

ここに記事本文を入力してください。
`;

export const SettingsSection: React.FC = () => {
  const queryClient = useQueryClient();
  const { pushToast, selectedRepositoryId, setSelectedRepositoryId } = useAppStore();

  // リポジトリモーダル状態
  const [isRepoModalOpen, setIsRepoModalOpen] = useState<boolean>(false);
  const [editingRepo, setEditingRepo] = useState<RepositoryConfig | null>(null);
  const [displayName, setDisplayName] = useState<string>('');
  const [owner, setOwner] = useState<string>('');
  const [repo, setRepo] = useState<string>('');
  const [branch, setBranch] = useState<string>('main');
  const [articlesDir, setArticlesDir] = useState<string>('src/content/blog');
  const [imagesDir, setImagesDir] = useState<string>('public/images');
  const [markdownExt, setMarkdownExt] = useState<'.md' | '.mdx' | '.markdown'>('.md');
  const [frontmatterFormat, setFrontmatterFormat] = useState<FrontmatterFormat>('yaml');
  const [defaultTemplate, setDefaultTemplate] = useState<string>(DEFAULT_YAML_TEMPLATE);
  const [siteUrl, setSiteUrl] = useState<string>('');
  const [articleUrlPattern, setArticleUrlPattern] = useState<string>('{siteUrl}/posts/{slug}');
  const [tokenPropertyKey, setTokenPropertyKey] = useState<string>('GITHUB_TOKEN_PORTFOLIO');
  const [isActive, setIsActive] = useState<boolean>(true);
  const [repoFormError, setRepoFormError] = useState<string | null>(null);

  const [deleteRepoTarget, setDeleteRepoTarget] = useState<RepositoryConfig | null>(null);

  // 公開API WebApp URLの保存用
  const [connConfig, setConnConfig] = useState(() => getPublicConnectionConfig());

  // リポジトリ一覧と利用可能なトークン参照キー一覧の取得
  const reposQuery = useQuery({
    queryKey: ['repositories'],
    queryFn: () =>
      callAdminApi<{ repositories: RepositoryConfig[]; availableTokenKeys: string[] }>('repositories.list')
  });

  // システム設定状態の取得
  const settingsQuery = useQuery({
    queryKey: ['systemSettings'],
    queryFn: () => callAdminApi<SystemSettingsInfo>('settings.get')
  });

  const repositories = reposQuery.data?.repositories ?? [];
  const availableTokenKeys = reposQuery.data?.availableTokenKeys ?? settingsQuery.data?.availableTokenKeys ?? [];

  const openCreateRepoModal = () => {
    setEditingRepo(null);
    setDisplayName('');
    setOwner('');
    setRepo('');
    setBranch('main');
    setArticlesDir('src/content/blog');
    setImagesDir('public/images');
    setMarkdownExt('.md');
    setFrontmatterFormat('yaml');
    setDefaultTemplate(DEFAULT_YAML_TEMPLATE);
    setSiteUrl('');
    setArticleUrlPattern('{siteUrl}/posts/{slug}');
    setTokenPropertyKey(availableTokenKeys[0] || 'GITHUB_TOKEN_PORTFOLIO');
    setIsActive(true);
    setRepoFormError(null);
    setIsRepoModalOpen(true);
  };

  const openEditRepoModal = (item: RepositoryConfig) => {
    setEditingRepo(item);
    setDisplayName(item.displayName);
    setOwner(item.owner);
    setRepo(item.repo);
    setBranch(item.branch);
    setArticlesDir(item.articlesDir);
    setImagesDir(item.imagesDir || 'public/images');
    setMarkdownExt(item.markdownExt);
    setFrontmatterFormat(item.frontmatterFormat);
    setDefaultTemplate(item.defaultTemplate);
    setSiteUrl(item.siteUrl);
    setArticleUrlPattern(item.articleUrlPattern);
    setTokenPropertyKey(item.tokenPropertyKey);
    setIsActive(item.isActive);
    setRepoFormError(null);
    setIsRepoModalOpen(true);
  };

  const saveRepoMutation = useMutation({
    mutationFn: async () => {
      const parsed = repositoryInputSchema.safeParse({
        displayName,
        owner,
        repo,
        branch,
        articlesDir,
        imagesDir,
        markdownExt,
        frontmatterFormat,
        defaultTemplate,
        siteUrl,
        articleUrlPattern,
        tokenPropertyKey,
        isActive
      });

      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message || '入力内容を確認してください');
      }

      if (editingRepo) {
        return callAdminApi<RepositoryConfig>('repositories.update', {
          id: editingRepo.id,
          ...parsed.data
        });
      }
      return callAdminApi<RepositoryConfig>('repositories.create', parsed.data);
    },
    onSuccess: (saved) => {
      setIsRepoModalOpen(false);
      if (!selectedRepositoryId && saved.isActive) {
        setSelectedRepositoryId(saved.id);
      }
      queryClient.invalidateQueries({ queryKey: ['repositories'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      pushToast({
        type: 'success',
        title: editingRepo ? 'リポジトリ設定を更新しました' : 'GitHubリポジトリを追加しました',
        message: `${saved.displayName} (${saved.owner}/${saved.repo})`
      });
    },
    onError: (err) => {
      setRepoFormError(err instanceof Error ? err.message : '保存エラー');
    }
  });

  const deleteRepoMutation = useMutation({
    mutationFn: (id: string) => callAdminApi<{ deletedId: string }>('repositories.delete', { id }),
    onSuccess: (res) => {
      setDeleteRepoTarget(null);
      if (selectedRepositoryId === res.deletedId) {
        setSelectedRepositoryId('');
      }
      queryClient.invalidateQueries({ queryKey: ['repositories'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      pushToast({
        type: 'success',
        title: 'リポジトリ登録を解除しました'
      });
    }
  });

  const initDbMutation = useMutation({
    mutationFn: () =>
      callAdminApi<{
        spreadsheetId: string;
        spreadsheetName: string;
        sheets: Array<{ name: string; created: boolean; rowCount: number }>;
      }>('settings.initDatabase'),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['systemSettings'] });
      pushToast({
        type: 'success',
        title: 'スプレッドシート構成を確認・初期化しました',
        message: `対象: ${res.spreadsheetName} (${res.sheets.length} シート正常)`
      });
    }
  });

  const setupTriggerMutation = useMutation({
    mutationFn: () =>
      callAdminApi<{ handlerFunction: string; alreadyExisted: boolean; active: boolean }>(
        'settings.setupTrigger'
      ),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['systemSettings'] });
      pushToast({
        type: 'success',
        title: res.alreadyExisted
          ? 'お知らせ公開予約トリガーは既に有効です'
          : 'お知らせ公開予約トリガー（5分間隔）を作成しました'
      });
    }
  });

  const handleSavePublicWebAppUrl = (e: React.FormEvent) => {
    e.preventDefault();
    savePublicConnectionConfig(connConfig);
    pushToast({
      type: 'success',
      title: '接続設定を更新しました'
    });
  };

  return (
    <div className="space-y-6">
      {/* 1. GitHub複数リポジトリ管理 */}
      <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <FolderGit2 className="w-4 h-4 text-slate-700" />
              <span>GitHubリポジトリ管理 (Repositories)</span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              複数のGitHub Pagesリポジトリを登録し、リポジトリごとに異なる記事保存ディレクトリ・Frontmatter形式・トークン参照キーを設定できます。
            </p>
          </div>
          <button
            type="button"
            onClick={openCreateRepoModal}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-slate-900 text-white rounded hover:bg-slate-800"
          >
            <Plus className="w-4 h-4" />
            <span>リポジトリを追加</span>
          </button>
        </div>

        {reposQuery.isLoading ? (
          <div className="p-8 text-center text-sm text-slate-600">リポジトリ設定を読み込み中...</div>
        ) : repositories.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            登録されているGitHubリポジトリがありません。「リポジトリを追加」から登録してください。
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                  <th className="py-2.5 px-4 font-semibold">状態</th>
                  <th className="py-2.5 px-4 font-semibold">表示名</th>
                  <th className="py-2.5 px-4 font-semibold">owner / repo (branch)</th>
                  <th className="py-2.5 px-4 font-semibold">記事ディレクトリ / 拡張子 / FM</th>
                  <th className="py-2.5 px-4 font-semibold">トークン参照キー</th>
                  <th className="py-2.5 px-4 font-semibold">公開サイトURL</th>
                  <th className="py-2.5 px-4 font-semibold text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {repositories.map((item) => {
                  const isCurrent = item.id === selectedRepositoryId;
                  return (
                    <tr key={item.id} className="hover:bg-slate-50">
                      <td className="py-2.5 px-4">
                        <span
                          className={`inline-block px-2 py-0.5 text-xs font-medium rounded border ${
                            item.isActive
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                              : 'bg-slate-100 text-slate-600 border-slate-300'
                          }`}
                        >
                          {item.isActive ? '有効' : '無効'}
                        </span>
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="font-semibold text-slate-900">{item.displayName}</div>
                        {isCurrent && (
                          <span className="text-[11px] text-blue-700 font-semibold">現在選択中</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-xs text-slate-800">
                        {item.owner}/{item.repo} <span className="text-slate-500">({item.branch})</span>
                      </td>
                      <td className="py-2.5 px-4 font-mono text-xs text-slate-700">
                        /{item.articlesDir || ''} ({item.markdownExt} / {item.frontmatterFormat})
                      </td>
                      <td className="py-2.5 px-4">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-mono bg-slate-100 text-slate-800 rounded border border-slate-200">
                          <KeyRound className="w-3 h-3 text-slate-500" />
                          {item.tokenPropertyKey}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-xs">
                        {item.siteUrl ? (
                          <a
                            href={item.siteUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                          >
                            <span>{item.siteUrl}</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="flex items-center justify-end gap-1.5">
                          {item.isActive && !isCurrent && (
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedRepositoryId(item.id);
                                pushToast({
                                  type: 'info',
                                  title: `操作対象を「${item.displayName}」に切り替えました`
                                });
                              }}
                              className="px-2 py-1 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-800 rounded border border-slate-300"
                            >
                              選択
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => openEditRepoModal(item)}
                            className="p-1.5 text-slate-700 hover:bg-slate-100 rounded border border-slate-200"
                            title="設定編集"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteRepoTarget(item)}
                            className="p-1.5 text-red-600 hover:bg-red-50 rounded border border-transparent hover:border-red-200"
                            title="登録削除"
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

      {/* 2. GAS・Google Sheets システム環境状態 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-md p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <Database className="w-4 h-4 text-slate-700" />
            <span>Google Sheets データベース & GAS トリガー状態</span>
          </div>

          {settingsQuery.isLoading ? (
            <div className="text-xs text-slate-500">システム設定情報を取得中...</div>
          ) : settingsQuery.data ? (
            <div className="space-y-2.5 text-xs">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded space-y-1.5">
                <div>
                  <span className="text-slate-500">認証済み管理者メール: </span>
                  <span className="font-mono font-semibold text-slate-900">
                    {settingsQuery.data.adminEmail}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">接続先スプレッドシート: </span>
                  <a
                    href={settingsQuery.data.spreadsheetUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-blue-600 hover:underline inline-flex items-center gap-1"
                  >
                    <span>{settingsQuery.data.spreadsheetName}</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <div>
                  <span className="text-slate-500">検出されたGitHubトークン参照キー (Script Properties): </span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {settingsQuery.data.availableTokenKeys.length > 0 ? (
                      settingsQuery.data.availableTokenKeys.map((k) => (
                        <span
                          key={k}
                          className="px-2 py-0.5 font-mono bg-white border border-slate-300 rounded text-slate-800"
                        >
                          {k}
                        </span>
                      ))
                    ) : (
                      <span className="text-amber-700">
                        GITHUB_TOKEN_* で始まるプロパティが未登録です（GASのプロジェクト設定で追加してください）
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 pt-1">
                  <Clock className="w-3.5 h-3.5 text-slate-600" />
                  <span className="text-slate-500">お知らせ公開予約トリガー: </span>
                  {settingsQuery.data.scheduledNoticeTriggerActive ? (
                    <span className="text-emerald-700 font-semibold inline-flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      有効 (publishScheduledNoticesTrigger)
                    </span>
                  ) : (
                    <span className="text-amber-700 font-semibold">未設定</span>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  disabled={initDbMutation.isPending}
                  onClick={() => initDbMutation.mutate()}
                  className="px-3 py-1.5 text-xs font-medium bg-slate-900 text-white rounded hover:bg-slate-800 disabled:opacity-50"
                >
                  {initDbMutation.isPending ? '確認中...' : '5シートのヘッダー構成を確認・初期化'}
                </button>
                <button
                  type="button"
                  disabled={setupTriggerMutation.isPending}
                  onClick={() => setupTriggerMutation.mutate()}
                  className="px-3 py-1.5 text-xs font-medium bg-white text-slate-800 border border-slate-300 rounded hover:bg-slate-50 disabled:opacity-50"
                >
                  {setupTriggerMutation.isPending ? '設定中...' : '公開予約トリガー（5分間隔）を設定'}
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {/* 3. 公開连接設定 & アプリ向け公開API仕様 */}
        <div className="bg-white border border-slate-200 rounded-md p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <Globe className="w-4 h-4 text-slate-700" />
            <span>クライアント接続識別子 & アプリ向け公開API</span>
          </div>
          <p className="text-xs text-slate-500">
            ※ここには公開識別子（OAuth Client ID、GAS Deployment ID、公開WebアプリURL）のみを設定します。秘密情報は一切含まれません。
          </p>

          <form onSubmit={handleSavePublicWebAppUrl} className="space-y-2.5 text-xs">
            <div>
              <label className="block font-semibold text-slate-700 mb-0.5">
                Google OAuth クライアントID
              </label>
              <input
                type="text"
                value={connConfig.googleClientId}
                onChange={(e) => setConnConfig({ ...connConfig, googleClientId: e.target.value })}
                className="w-full px-2.5 py-1.5 font-mono border border-slate-300 rounded bg-white"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-0.5">
                GAS API Executable デプロイID (またはスクリプトID)
              </label>
              <input
                type="text"
                value={connConfig.gasDeploymentId}
                onChange={(e) => setConnConfig({ ...connConfig, gasDeploymentId: e.target.value })}
                className="w-full px-2.5 py-1.5 font-mono border border-slate-300 rounded bg-white"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-0.5">
                アプリ向け公開API WebアプリURL (doGet / doPost)
              </label>
              <input
                type="text"
                value={connConfig.gasWebAppUrl}
                onChange={(e) => setConnConfig({ ...connConfig, gasWebAppUrl: e.target.value })}
                placeholder="https://script.google.com/macros/s/.../exec"
                className="w-full px-2.5 py-1.5 font-mono border border-slate-300 rounded bg-white"
              />
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                className="px-3 py-1.5 text-xs font-semibold bg-slate-900 text-white rounded hover:bg-slate-800"
              >
                接続識別子を保存
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* リポジトリ追加・編集モーダル */}
      {isRepoModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-md max-w-2xl w-full p-5 space-y-4 shadow-lg max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                {editingRepo ? 'GitHubリポジトリ設定の編集' : 'GitHubリポジトリの新規追加'}
              </h3>
              <button
                type="button"
                onClick={() => setIsRepoModalOpen(false)}
                className="text-xs text-slate-500 hover:text-slate-900"
              >
                閉じる
              </button>
            </div>

            {repoFormError && (
              <div className="p-2.5 bg-red-50 border border-red-200 rounded text-xs text-red-800 font-medium">
                {repoFormError}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">表示名 *</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="個人技術ブログ / アプリ公式サイト"
                  className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded bg-white"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  GitHubトークン参照キー (Script Properties) *
                </label>
                <input
                  type="text"
                  list="token-keys-datalist"
                  value={tokenPropertyKey}
                  onChange={(e) => setTokenPropertyKey(e.target.value)}
                  placeholder="GITHUB_TOKEN_PORTFOLIO"
                  className="w-full px-3 py-1.5 text-sm font-mono border border-slate-300 rounded bg-white"
                />
                <datalist id="token-keys-datalist">
                  {availableTokenKeys.map((k) => (
                    <option key={k} value={k} />
                  ))}
                </datalist>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">GitHubオーナー *</label>
                <input
                  type="text"
                  value={owner}
                  onChange={(e) => setOwner(e.target.value)}
                  placeholder="octocat"
                  className="w-full px-3 py-1.5 text-sm font-mono border border-slate-300 rounded bg-white"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">リポジトリ名 *</label>
                <input
                  type="text"
                  value={repo}
                  onChange={(e) => setRepo(e.target.value)}
                  placeholder="my-blog-repo"
                  className="w-full px-3 py-1.5 text-sm font-mono border border-slate-300 rounded bg-white"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">ブランチ *</label>
                <input
                  type="text"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  placeholder="main"
                  className="w-full px-3 py-1.5 text-sm font-mono border border-slate-300 rounded bg-white"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  記事保存ディレクトリ（ルートの場合は空欄）
                </label>
                <input
                  type="text"
                  value={articlesDir}
                  onChange={(e) => setArticlesDir(e.target.value)}
                  placeholder="src/content/blog"
                  className="w-full px-3 py-1.5 text-sm font-mono border border-slate-300 rounded bg-white"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  画像アップロード保存ディレクトリ
                </label>
                <input
                  type="text"
                  value={imagesDir}
                  onChange={(e) => setImagesDir(e.target.value)}
                  placeholder="public/images"
                  className="w-full px-3 py-1.5 text-sm font-mono border border-slate-300 rounded bg-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Markdown拡張子 *</label>
                  <select
                    value={markdownExt}
                    onChange={(e) => setMarkdownExt(e.target.value as '.md' | '.mdx' | '.markdown')}
                    className="w-full px-2.5 py-1.5 text-sm font-mono border border-slate-300 rounded bg-white"
                  >
                    <option value=".md">.md</option>
                    <option value=".mdx">.mdx</option>
                    <option value=".markdown">.markdown</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Frontmatter形式 *</label>
                  <select
                    value={frontmatterFormat}
                    onChange={(e) => setFrontmatterFormat(e.target.value as FrontmatterFormat)}
                    className="w-full px-2.5 py-1.5 text-sm font-mono border border-slate-300 rounded bg-white"
                  >
                    <option value="yaml">YAML (---)</option>
                    <option value="toml">TOML (+++)</option>
                    <option value="json">JSON</option>
                    <option value="none">なし</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">公開サイトURL</label>
                <input
                  type="url"
                  value={siteUrl}
                  onChange={(e) => setSiteUrl(e.target.value)}
                  placeholder="https://username.github.io"
                  className="w-full px-3 py-1.5 text-sm font-mono border border-slate-300 rounded bg-white"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  記事URL生成規則（変数: {'{siteUrl}'}, {'{slug}'}, {'{filename}'}）
                </label>
                <input
                  type="text"
                  value={articleUrlPattern}
                  onChange={(e) => setArticleUrlPattern(e.target.value)}
                  placeholder="{siteUrl}/posts/{slug}"
                  className="w-full px-3 py-1.5 text-sm font-mono border border-slate-300 rounded bg-white"
                />
              </div>
            </div>

            <div className="text-xs">
              <label className="block font-semibold text-slate-700 mb-1">
                新規記事テンプレート（変数: {'{title}'}, {'{date}'}, {'{slug}'} が自動置換されます）
              </label>
              <textarea
                rows={7}
                value={defaultTemplate}
                onChange={(e) => setDefaultTemplate(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded bg-white leading-relaxed"
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                id="repo-is-active"
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="rounded border-slate-300"
              />
              <label htmlFor="repo-is-active" className="text-xs font-medium text-slate-800">
                このリポジトリを有効にする（記事管理画面の切り替えリストに表示する）
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setIsRepoModalOpen(false)}
                className="px-3.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded"
              >
                キャンセル
              </button>
              <button
                type="button"
                disabled={saveRepoMutation.isPending}
                onClick={() => saveRepoMutation.mutate()}
                className="px-4 py-1.5 text-xs font-semibold bg-slate-900 text-white rounded hover:bg-slate-800 disabled:opacity-50"
              >
                {saveRepoMutation.isPending ? '保存中...' : 'リポジトリ設定を保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* リポジトリ削除確認モーダル */}
      {deleteRepoTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-md max-w-md w-full p-5 space-y-4 shadow-lg">
            <h3 className="text-base font-bold text-red-700">リポジトリ登録の解除確認</h3>
            <p className="text-xs text-slate-700">
              リポジトリ「<strong>{deleteRepoTarget.displayName}</strong> ({deleteRepoTarget.owner}/{deleteRepoTarget.repo})」を管理対象リスト（Repositoriesシート）から削除しますか？
              <br />
              ※GitHub上のリポジトリや記事ファイル自体は削除されません。
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteRepoTarget(null)}
                className="px-3.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded"
              >
                キャンセル
              </button>
              <button
                type="button"
                disabled={deleteRepoMutation.isPending}
                onClick={() => deleteRepoMutation.mutate(deleteRepoTarget.id)}
                className="px-4 py-1.5 text-xs font-semibold bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
              >
                {deleteRepoMutation.isPending ? '削除中...' : '登録を解除する'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
