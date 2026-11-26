/**
 * src/js/articles.tsx
 * GitHub記事管理セクション（Articles）。
 *
 * - リポジトリ切り替え
 * - 記事一覧取得（Git Trees API経由）、タイトル・パス検索、更新日時・パスでの並べ替え（TanStack Table）
 * - 新規記事作成（リポジトリごとのFrontmatter形式・テンプレート自動反映）
 * - 既存記事編集（最新内容・SHA取得、未保存状態の警告、sessionStorageへの一時保存と復元）
 * - 保存前の確認モーダル（対象リポジトリ、ブランチ、保存先パス、コミットメッセージの確認）
 * - 記事削除（対象ファイル・SHA確認後の削除確認ダイアログ）
 * - SHA競合（409 / SHA mismatch）発生時の無条件上書き防止と、リモート最新版との行単位差分（Diff）比較・解決モーダル
 */

import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  flexRender,
  createColumnHelper,
  type SortingState
} from '@tanstack/react-table';
import {
  FileText,
  Plus,
  RefreshCw,
  Search,
  ExternalLink,
  Trash2,
  Save,
  ArrowLeft,
  AlertTriangle,
  GitBranch,
  FolderGit2,
  CheckCircle2,
  ArrowUpDown
} from 'lucide-react';
import { callAdminApi, AdminApiError } from './api';
import { useAppStore } from './store';
import {
  buildInitialArticleMarkdown,
  clearArticleDraftFromSession,
  computeLineDiff,
  formatDateTimeJst,
  loadArticleDraftFromSession,
  saveArticleDraftToSession
} from './utils';
import { articleSaveSchema } from '../schemas/validation';
import { MarkdownEditor } from './markdown-editor';
import type {
  ArticleDetail,
  ArticleListResponse,
  ArticleSaveResult,
  ArticleSummary,
  RepositoryConfig,
  ShaConflictDetails
} from '../types/domain';

const columnHelper = createColumnHelper<ArticleSummary>();

export const ArticlesSection: React.FC = () => {
  const queryClient = useQueryClient();
  const {
    selectedRepositoryId,
    setSelectedRepositoryId,
    isEditorDirty,
    setEditorDirty,
    pushToast
  } = useAppStore();

  // モード管理: list (一覧) | create (新規作成) | edit (既存編集)
  const [mode, setMode] = useState<'list' | 'create' | 'edit'>('list');
  const [searchKeyword, setSearchKeyword] = useState<string>('');
  const [sorting, setSorting] = useState<SortingState>([{ id: 'updatedAt', desc: true }]);

  // 編集中の状態
  const [editingPath, setEditingPath] = useState<string>('');
  const [filenameInput, setFilenameInput] = useState<string>('');
  const [currentSha, setCurrentSha] = useState<string>('');
  const [originalContent, setOriginalContent] = useState<string>('');
  const [editorContent, setEditorContent] = useState<string>('');
  const [commitMessage, setCommitMessage] = useState<string>('');
  const [validationError, setValidationError] = useState<string | null>(null);

  // モーダル状態
  const [showSaveConfirmModal, setShowSaveConfirmModal] = useState<boolean>(false);
  const [deleteTarget, setDeleteTarget] = useState<{ path: string; sha: string; title: string } | null>(null);
  const [shaConflict, setShaConflict] = useState<ShaConflictDetails | null>(null);

  // ブラウザを閉じる・リロードする際の未保存警告
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isEditorDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isEditorDirty]);

  // 1. 登録リポジトリ一覧の取得
  const reposQuery = useQuery({
    queryKey: ['repositories'],
    queryFn: () =>
      callAdminApi<{ repositories: RepositoryConfig[]; availableTokenKeys: string[] }>('repositories.list')
  });

  const activeRepositories = useMemo(() => {
    return (reposQuery.data?.repositories ?? []).filter((r) => r.isActive);
  }, [reposQuery.data]);

  // 初回ロード時に選択リポジトリが未設定なら先頭を選択
  useEffect(() => {
    if (!selectedRepositoryId && activeRepositories.length > 0 && activeRepositories[0]) {
      setSelectedRepositoryId(activeRepositories[0].id);
    }
  }, [activeRepositories, selectedRepositoryId, setSelectedRepositoryId]);

  const currentRepo = useMemo(() => {
    return activeRepositories.find((r) => r.id === selectedRepositoryId) ?? null;
  }, [activeRepositories, selectedRepositoryId]);

  // 2. 選択中リポジトリの記事一覧取得
  const articlesQuery = useQuery({
    queryKey: ['articles', selectedRepositoryId],
    enabled: Boolean(selectedRepositoryId),
    queryFn: () =>
      callAdminApi<ArticleListResponse>('articles.list', {
        repositoryId: selectedRepositoryId,
        forceRefresh: false
      })
  });

  // 強制リフレッシュ
  const refreshMutation = useMutation({
    mutationFn: () =>
      callAdminApi<ArticleListResponse>('articles.list', {
        repositoryId: selectedRepositoryId,
        forceRefresh: true
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['articles', selectedRepositoryId], data);
      pushToast({
        type: 'info',
        title: '記事一覧を最新状態に更新しました',
        message: `${data.totalCount} 件のMarkdownファイルを取得しました`
      });
    },
    onError: (err) => {
      pushToast({
        type: 'error',
        title: '記事一覧の更新に失敗しました',
        message: err instanceof Error ? err.message : '通信エラー'
      });
    }
  });

  // 3. 既存記事の詳細（最新内容とSHA）取得
  const loadArticleDetailMutation = useMutation({
    mutationFn: (path: string) =>
      callAdminApi<ArticleDetail>('articles.get', {
        repositoryId: selectedRepositoryId,
        path
      }),
    onSuccess: (detail) => {
      setEditingPath(detail.path);
      setFilenameInput(detail.path);
      setCurrentSha(detail.sha);
      setOriginalContent(detail.content);

      // 一時保存データがあるか確認
      const savedDraft = loadArticleDraftFromSession(selectedRepositoryId, detail.path);
      if (savedDraft && savedDraft.content !== detail.content) {
        const restore = window.confirm(
          `この記事には一時保存された未保存の編集データ（保存時刻: ${formatDateTimeJst(savedDraft.savedAt)}）があります。復元しますか？`
        );
        if (restore) {
          setEditorContent(savedDraft.content);
          setEditorDirty(true);
        } else {
          clearArticleDraftFromSession(selectedRepositoryId, detail.path);
          setEditorContent(detail.content);
          setEditorDirty(false);
        }
      } else {
        setEditorContent(detail.content);
        setEditorDirty(false);
      }

      setCommitMessage(`docs: update ${detail.path}`);
      setValidationError(null);
      setShaConflict(null);
      setMode('edit');
    },
    onError: (err) => {
      pushToast({
        type: 'error',
        title: '記事の読み込みに失敗しました',
        message: err instanceof Error ? err.message : 'GitHubからの取得エラー'
      });
    }
  });

  // 4. 新規作成モードへの移行
  const handleStartCreate = () => {
    if (!currentRepo) return;
    const todaySlug = `${new Date().toISOString().slice(0, 10)}-new-article`;
    const initialMd = buildInitialArticleMarkdown({
      title: '新規記事タイトル',
      slug: todaySlug,
      format: currentRepo.frontmatterFormat,
      defaultTemplate: currentRepo.defaultTemplate
    });

    const draft = loadArticleDraftFromSession(currentRepo.id, '__new__');
    if (draft && draft.content.trim().length > 0 && draft.content !== initialMd) {
      const restore = window.confirm(
        `前回作成中だった新規記事の一時保存データ（${formatDateTimeJst(draft.savedAt)}）があります。復元しますか？`
      );
      if (restore) {
        setEditorContent(draft.content);
        setEditorDirty(true);
      } else {
        clearArticleDraftFromSession(currentRepo.id, '__new__');
        setEditorContent(initialMd);
        setEditorDirty(false);
      }
    } else {
      setEditorContent(initialMd);
      setEditorDirty(false);
    }

    setEditingPath('');
    setFilenameInput(`${todaySlug}${currentRepo.markdownExt}`);
    setCurrentSha('');
    setOriginalContent('');
    setCommitMessage(`docs: create ${todaySlug}${currentRepo.markdownExt}`);
    setValidationError(null);
    setShaConflict(null);
    setMode('create');
  };

  // エディタ内容変更時にdirty状態を更新し、sessionStorageに一時保存
  const handleEditorContentChange = (nextVal: string) => {
    setEditorContent(nextVal);
    const isDirtyNow = mode === 'create' ? nextVal.trim().length > 0 : nextVal !== originalContent;
    setEditorDirty(isDirtyNow);
    if (currentRepo) {
      saveArticleDraftToSession(currentRepo.id, mode === 'create' ? '__new__' : editingPath, nextVal);
    }
  };

  // 5. 記事保存（新規作成 / 更新）Mutation
  const saveArticleMutation = useMutation({
    mutationFn: async () => {
      if (!currentRepo) throw new Error('対象リポジトリが選択されていません');
      if (mode === 'create') {
        return callAdminApi<ArticleSaveResult>('articles.create', {
          repositoryId: currentRepo.id,
          filename: filenameInput,
          content: editorContent,
          commitMessage
        });
      }
      return callAdminApi<ArticleSaveResult>('articles.update', {
        repositoryId: currentRepo.id,
        path: editingPath,
        sha: currentSha,
        content: editorContent,
        commitMessage
      });
    },
    onSuccess: (res) => {
      setShowSaveConfirmModal(false);
      setShaConflict(null);
      if (currentRepo) {
        clearArticleDraftFromSession(currentRepo.id, mode === 'create' ? '__new__' : editingPath);
      }
      setEditingPath(res.path);
      setFilenameInput(res.path);
      setCurrentSha(res.sha);
      setOriginalContent(editorContent);
      setEditorDirty(false);
      setMode('edit');

      queryClient.invalidateQueries({ queryKey: ['articles', selectedRepositoryId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });

      pushToast({
        type: 'success',
        title: 'GitHubへ記事を保存しました',
        message: `パス: ${res.path} (SHA: ${res.sha.slice(0, 7)})`
      });
    },
    onError: (err) => {
      setShowSaveConfirmModal(false);
      if (err instanceof AdminApiError && err.code === 'GITHUB_SHA_CONFLICT' && err.details) {
        const details = err.details as unknown as ShaConflictDetails;
        if (details && details.conflict) {
          setShaConflict(details);
          pushToast({
            type: 'warning',
            title: 'SHA競合を検出しました',
            message: 'GitHub上のファイルが別箇所で更新されています。差分を確認してください。'
          });
          return;
        }
      }
      pushToast({
        type: 'error',
        title: '記事の保存に失敗しました',
        message: err instanceof Error ? err.message : 'GitHub API保存エラー'
      });
    }
  });

  // 6. 記事削除 Mutation
  const deleteArticleMutation = useMutation({
    mutationFn: async (target: { path: string; sha: string }) => {
      if (!currentRepo) throw new Error('リポジトリが選択されていません');
      return callAdminApi<{ repositoryId: string; deletedPath: string }>('articles.delete', {
        repositoryId: currentRepo.id,
        path: target.path,
        sha: target.sha,
        commitMessage: `docs: delete article ${target.path}`
      });
    },
    onSuccess: (res) => {
      setDeleteTarget(null);
      if (currentRepo) {
        clearArticleDraftFromSession(currentRepo.id, res.deletedPath);
      }
      setEditorDirty(false);
      setMode('list');
      queryClient.invalidateQueries({ queryKey: ['articles', selectedRepositoryId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      pushToast({
        type: 'success',
        title: '記事を削除しました',
        message: `削除ファイル: ${res.deletedPath}`
      });
    },
    onError: (err) => {
      setDeleteTarget(null);
      pushToast({
        type: 'error',
        title: '記事の削除に失敗しました',
        message: err instanceof Error ? err.message : '削除エラー'
      });
    }
  });

  // 7. 画像アップロード
  const uploadImageMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!currentRepo) throw new Error('リポジトリが未選択です');
      const base64Data = await readFileAsBase64(file);
      const timestampPrefix = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const filename = `${timestampPrefix}-${file.name}`;
      return callAdminApi<{ path: string; markdownUrl: string; downloadUrl: string; sha: string }>(
        'articles.uploadImage',
        {
          repositoryId: currentRepo.id,
          filename,
          base64Data
        }
      );
    },
    onSuccess: (res) => {
      pushToast({
        type: 'success',
        title: '画像をGitHubリポジトリに保存しました',
        message: `保存先: ${res.path}`
      });
    },
    onError: (err) => {
      pushToast({
        type: 'error',
        title: '画像のアップロードに失敗しました',
        message: err instanceof Error ? err.message : 'アップロードエラー'
      });
    }
  });

  // 保存前検証と確認モーダル表示
  const handleRequestSaveConfirmation = () => {
    if (!currentRepo) return;
    const parsed = articleSaveSchema.safeParse({
      repositoryId: currentRepo.id,
      filename: mode === 'create' ? filenameInput : editingPath,
      content: editorContent,
      commitMessage
    });

    if (!parsed.success) {
      const firstErr = parsed.error.issues[0]?.message || '入力内容を確認してください';
      setValidationError(firstErr);
      return;
    }

    setValidationError(null);
    setShowSaveConfirmModal(true);
  };

  // 一覧に戻る際の未保存確認
  const handleBackToList = () => {
    if (isEditorDirty) {
      const ok = window.confirm('未保存の変更があります。破棄して記事一覧に戻りますか？');
      if (!ok) return;
    }
    setEditorDirty(false);
    setShaConflict(null);
    setMode('list');
  };

  // TanStack Table カラム定義
  const columns = useMemo(
    () => [
      columnHelper.accessor('title', {
        header: 'ファイル名 / スラッグ',
        cell: (info) => {
          const row = info.row.original;
          return (
            <div className="flex flex-col">
              <button
                type="button"
                onClick={() => loadArticleDetailMutation.mutate(row.path)}
                className="text-left font-semibold text-slate-900 hover:text-blue-600 flex items-center gap-1.5"
              >
                <FileText className="w-4 h-4 text-slate-500 shrink-0" />
                <span>{row.filename}</span>
              </button>
              <span className="text-xs text-slate-500 font-mono mt-0.5">{row.path}</span>
            </div>
          );
        }
      }),
      columnHelper.accessor('updatedAt', {
        header: ({ column }) => (
          <button
            type="button"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
            className="flex items-center gap-1 font-semibold text-slate-700 hover:text-slate-900"
          >
            <span>最終コミット日時 (JST)</span>
            <ArrowUpDown className="w-3.5 h-3.5" />
          </button>
        ),
        cell: (info) => (
          <span className="text-xs text-slate-600">{formatDateTimeJst(info.getValue())}</span>
        )
      }),
      columnHelper.accessor('size', {
        header: 'サイズ',
        cell: (info) => (
          <span className="text-xs font-mono text-slate-600">
            {(info.getValue() / 1024).toFixed(1)} KB
          </span>
        )
      }),
      columnHelper.display({
        id: 'links',
        header: '外部リンク',
        cell: (info) => {
          const row = info.row.original;
          return (
            <div className="flex items-center gap-2 text-xs">
              {row.publicUrl && (
                <a
                  href={row.publicUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                >
                  <span>公開ページ</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
              {row.githubUrl && (
                <a
                  href={row.githubUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-slate-600 hover:text-slate-900 hover:underline"
                >
                  <span>GitHub</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          );
        }
      }),
      columnHelper.display({
        id: 'actions',
        header: '操作',
        cell: (info) => {
          const row = info.row.original;
          return (
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => loadArticleDetailMutation.mutate(row.path)}
                className="px-2.5 py-1 text-xs font-medium bg-slate-900 text-white rounded hover:bg-slate-800"
              >
                編集
              </button>
              <button
                type="button"
                onClick={() =>
                  setDeleteTarget({
                    path: row.path,
                    sha: row.sha,
                    title: row.filename
                  })
                }
                className="p-1 text-red-600 hover:bg-red-50 rounded border border-transparent hover:border-red-200"
                title="記事を削除"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          );
        }
      })
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedRepositoryId]
  );

  const filteredArticles = useMemo(() => {
    const all = articlesQuery.data?.articles ?? [];
    const kw = searchKeyword.trim().toLowerCase();
    if (!kw) return all;
    return all.filter(
      (a) =>
        a.title.toLowerCase().includes(kw) ||
        a.filename.toLowerCase().includes(kw) ||
        a.path.toLowerCase().includes(kw)
    );
  }, [articlesQuery.data, searchKeyword]);

  const table = useReactTable({
    data: filteredArticles,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: {
      pagination: {
        pageSize: 20
      }
    }
  });

  // 登録リポジトリが0件の場合の案内
  if (!reposQuery.isLoading && activeRepositories.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-md p-6">
        <h2 className="text-base font-bold text-slate-900 mb-2">有効なGitHubリポジトリが登録されていません</h2>
        <p className="text-sm text-slate-600 mb-4">
          記事管理を行うには、まず「Settings（設定）」セクションから管理対象のGitHub Pagesリポジトリ（オーナー名、リポジトリ名、記事保存ディレクトリ、GitHubトークン参照キー）を登録してください。
        </p>
        <button
          type="button"
          onClick={() => useAppStore.getState().setActiveSection('settings')}
          className="px-4 py-2 text-sm font-medium bg-slate-900 text-white rounded hover:bg-slate-800"
        >
          リポジトリ設定画面へ移動
        </button>
      </div>
    );
  }

  // 生成される予定の完全ファイルパス
  const previewTargetFilePath = useMemo(() => {
    if (!currentRepo) return '';
    if (mode === 'edit') return editingPath;
    const raw = filenameInput.trim().replace(/^\/+|\/+$/g, '');
    if (!raw) return '';
    const dir = currentRepo.articlesDir.replace(/^\/+|\/+$/g, '');
    const withDir = dir && !raw.startsWith(`${dir}/`) ? `${dir}/${raw}` : raw;
    return /\.(md|mdx|markdown)$/i.test(withDir) ? withDir : `${withDir}${currentRepo.markdownExt}`;
  }, [currentRepo, mode, editingPath, filenameInput]);

  return (
    <div className="space-y-4">
      {/* 上部バー：対象GitHubリポジトリ切り替えと状態表示 */}
      <div className="bg-white border border-slate-200 rounded-md p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <FolderGit2 className="w-4 h-4 text-slate-700" />
            <label htmlFor="repo-select" className="text-xs font-semibold text-slate-700">
              操作対象リポジトリ:
            </label>
          </div>
          <select
            id="repo-select"
            value={selectedRepositoryId}
            onChange={(e) => {
              setSelectedRepositoryId(e.target.value);
              setMode('list');
            }}
            className="px-3 py-1.5 text-sm font-medium border border-slate-300 rounded bg-white text-slate-900"
          >
            {activeRepositories.map((repo) => (
              <option key={repo.id} value={repo.id}>
                {repo.displayName} ({repo.owner}/{repo.repo})
              </option>
            ))}
          </select>

          {currentRepo && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono">
                <GitBranch className="w-3 h-3" />
                {currentRepo.branch}
              </span>
              <span className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono">
                dir: /{currentRepo.articlesDir || '(root)'}
              </span>
              <span className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono">
                ext: {currentRepo.markdownExt}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {mode === 'list' ? (
            <>
              <button
                type="button"
                disabled={refreshMutation.isPending || articlesQuery.isFetching}
                onClick={() => refreshMutation.mutate()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${refreshMutation.isPending ? 'animate-spin' : ''}`} />
                <span>GitHubから再取得</span>
              </button>
              <button
                type="button"
                onClick={handleStartCreate}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-slate-900 text-white rounded hover:bg-slate-800"
              >
                <Plus className="w-4 h-4" />
                <span>新規記事作成</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={handleBackToList}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>記事一覧に戻る</span>
            </button>
          )}
        </div>
      </div>

      {/* 記事詳細読み込み中オーバーレイ */}
      {loadArticleDetailMutation.isPending && (
        <div className="bg-white border border-slate-200 rounded-md p-6 text-center text-sm text-slate-600">
          GitHubから最新の記事データとSHAを取得しています...
        </div>
      )}

      {/* モード1: 記事一覧表示 */}
      {mode === 'list' && !loadArticleDetailMutation.isPending && (
        <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                placeholder="ファイル名・パス・タイトルで検索..."
                className="w-full pl-9 pr-3 py-1.5 text-sm border border-slate-300 rounded bg-white focus:outline-none focus:border-slate-600"
              />
            </div>
            <div className="text-xs text-slate-600">
              全 <span className="font-semibold text-slate-900">{filteredArticles.length}</span> 件
            </div>
          </div>

          {articlesQuery.isLoading ? (
            <div className="p-8 text-center text-sm text-slate-600">
              GitHub REST API (Git Trees) から記事一覧を取得しています...
            </div>
          ) : articlesQuery.isError ? (
            <div className="p-6 bg-red-50 border-b border-red-200 text-sm text-red-800 space-y-2">
              <div className="font-semibold">記事一覧の取得に失敗しました</div>
              <div>
                {articlesQuery.error instanceof Error
                  ? articlesQuery.error.message
                  : 'GitHub APIとの通信に失敗しました'}
              </div>
              <button
                type="button"
                onClick={() => articlesQuery.refetch()}
                className="px-3 py-1 text-xs font-medium bg-red-800 text-white rounded hover:bg-red-700"
              >
                再試行
              </button>
            </div>
          ) : filteredArticles.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              対象ディレクトリ（/{currentRepo?.articlesDir || ''}）に該当するMarkdown記事が見つかりません。
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left">
                  <thead>
                    {table.getHeaderGroups().map((headerGroup) => (
                      <tr key={headerGroup.id} className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                        {headerGroup.headers.map((header) => (
                          <th key={header.id} className="py-2.5 px-4 font-semibold">
                            {header.isPlaceholder
                              ? null
                              : flexRender(header.column.columnDef.header, header.getContext())}
                          </th>
                        ))}
                      </tr>
                    ))}
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-sm">
                    {table.getRowModel().rows.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-50">
                        {row.getVisibleCells().map((cell) => (
                          <td key={cell.id} className="py-2.5 px-4 align-middle">
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* ページネーション */}
              {table.getPageCount() > 1 && (
                <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
                  <div>
                    ページ {table.getState().pagination.pageIndex + 1} / {table.getPageCount()}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => table.previousPage()}
                      disabled={!table.getCanPreviousPage()}
                      className="px-2.5 py-1 border border-slate-300 rounded bg-white disabled:opacity-40"
                    >
                      前へ
                    </button>
                    <button
                      type="button"
                      onClick={() => table.nextPage()}
                      disabled={!table.getCanNextPage()}
                      className="px-2.5 py-1 border border-slate-300 rounded bg-white disabled:opacity-40"
                    >
                      次へ
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* モード2 & 3: 新規作成 / 既存記事編集 */}
      {(mode === 'create' || mode === 'edit') && currentRepo && !loadArticleDetailMutation.isPending && (
        <div className="space-y-4">
          {/* ファイル名・SHA・コミットメッセージ・保存操作バー */}
          <div className="bg-white border border-slate-200 rounded-md p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span
                  className={`px-2 py-0.5 text-xs font-semibold rounded ${
                    mode === 'create'
                      ? 'bg-blue-100 text-blue-800'
                      : 'bg-slate-200 text-slate-800'
                  }`}
                >
                  {mode === 'create' ? '新規記事作成' : '既存記事編集'}
                </span>
                {isEditorDirty && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-900 rounded border border-amber-300">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    未保存の変更あり（一時保存済み）
                  </span>
                )}
                {mode === 'edit' && currentSha && (
                  <span className="text-xs font-mono text-slate-500">
                    対象SHA: {currentSha.slice(0, 10)}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {mode === 'edit' && (
                  <button
                    type="button"
                    onClick={() =>
                      setDeleteTarget({
                        path: editingPath,
                        sha: currentSha,
                        title: editingPath
                      })
                    }
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded hover:bg-red-100"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>この記事を削除</span>
                  </button>
                )}

                <button
                  type="button"
                  disabled={saveArticleMutation.isPending}
                  onClick={handleRequestSaveConfirmation}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{saveArticleMutation.isPending ? 'GitHubへ保存中...' : '保存前の確認へ進む'}</span>
                </button>
              </div>
            </div>

            {validationError && (
              <div className="p-2.5 bg-red-50 border border-red-200 rounded text-xs text-red-800 font-medium">
                入力エラー: {validationError}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {mode === 'create'
                    ? `ファイル名（保存先: /${currentRepo.articlesDir || ''}）`
                    : '対象ファイルパス（GitHubリポジトリ内）'}
                </label>
                {mode === 'create' ? (
                  <div className="space-y-1">
                    <input
                      type="text"
                      value={filenameInput}
                      onChange={(e) => setFilenameInput(e.target.value)}
                      placeholder={`2026-11-26-my-post${currentRepo.markdownExt}`}
                      className="w-full px-3 py-1.5 text-sm font-mono border border-slate-300 rounded bg-white"
                    />
                    <div className="text-xs text-slate-500 font-mono">
                      生成パス: <strong className="text-slate-800">{previewTargetFilePath || '—'}</strong>
                    </div>
                  </div>
                ) : (
                  <input
                    type="text"
                    value={editingPath}
                    disabled
                    className="w-full px-3 py-1.5 text-sm font-mono border border-slate-200 rounded bg-slate-100 text-slate-700"
                  />
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  GitHub コミットメッセージ
                </label>
                <input
                  type="text"
                  value={commitMessage}
                  onChange={(e) => setCommitMessage(e.target.value)}
                  placeholder="docs: update article"
                  className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded bg-white"
                />
              </div>
            </div>
          </div>

          {/* CodeMirror 6 エディタ + リアルタイムプレビュー */}
          <MarkdownEditor
            value={editorContent}
            onChange={handleEditorContentChange}
            repository={currentRepo}
            onUploadImage={(file) => uploadImageMutation.mutateAsync(file)}
            isUploadingImage={uploadImageMutation.isPending}
          />
        </div>
      )}

      {/* モーダル1: 保存前の確認ダイアログ */}
      {showSaveConfirmModal && currentRepo && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-md max-w-lg w-full p-5 space-y-4 shadow-lg">
            <div className="flex items-center gap-2 text-base font-bold text-slate-900">
              <CheckCircle2 className="w-5 h-5 text-blue-600" />
              <span>GitHubへの記事保存確認</span>
            </div>
            <p className="text-xs text-slate-600">
              以下の内容で GitHub REST API (Contents API) を呼び出し、リポジトリへ直接コミットします。よろしいですか？
            </p>
            <div className="bg-slate-50 border border-slate-200 rounded p-3 text-xs space-y-1.5">
              <div>
                <span className="font-semibold text-slate-600">対象リポジトリ: </span>
                <span className="font-mono text-slate-900">
                  {currentRepo.owner}/{currentRepo.repo} (branch: {currentRepo.branch})
                </span>
              </div>
              <div>
                <span className="font-semibold text-slate-600">操作種別: </span>
                <span className="text-slate-900">{mode === 'create' ? '新規ファイル作成' : '既存ファイル更新'}</span>
              </div>
              <div>
                <span className="font-semibold text-slate-600">保存先パス: </span>
                <span className="font-mono text-slate-900">{previewTargetFilePath}</span>
              </div>
              {mode === 'edit' && (
                <div>
                  <span className="font-semibold text-slate-600">基準SHA: </span>
                  <span className="font-mono text-slate-900">{currentSha}</span>
                </div>
              )}
              <div>
                <span className="font-semibold text-slate-600">コミットメッセージ: </span>
                <span className="text-slate-900">{commitMessage}</span>
              </div>
              <div>
                <span className="font-semibold text-slate-600">文字数: </span>
                <span className="font-mono text-slate-900">{editorContent.length.toLocaleString()} 文字</span>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={saveArticleMutation.isPending}
                onClick={() => setShowSaveConfirmModal(false)}
                className="px-3.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50"
              >
                キャンセル
              </button>
              <button
                type="button"
                disabled={saveArticleMutation.isPending}
                onClick={() => saveArticleMutation.mutate()}
                className="px-4 py-1.5 text-xs font-semibold bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {saveArticleMutation.isPending ? 'コミット実行中...' : '確定してGitHubに保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* モーダル2: 削除確認ダイアログ */}
      {deleteTarget && currentRepo && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-md max-w-md w-full p-5 space-y-4 shadow-lg">
            <div className="flex items-center gap-2 text-base font-bold text-red-700">
              <AlertTriangle className="w-5 h-5" />
              <span>記事ファイルの削除確認</span>
            </div>
            <p className="text-xs text-slate-700">
              GitHubリポジトリから以下のMarkdownファイルを削除します。この操作はGitコミットとして記録されます。本当に削除しますか？
            </p>
            <div className="bg-red-50 border border-red-200 rounded p-3 text-xs space-y-1 font-mono text-red-900">
              <div>repo: {currentRepo.owner}/{currentRepo.repo} ({currentRepo.branch})</div>
              <div>path: {deleteTarget.path}</div>
              <div>sha: {deleteTarget.sha.slice(0, 12)}...</div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={deleteArticleMutation.isPending}
                onClick={() => setDeleteTarget(null)}
                className="px-3.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50"
              >
                キャンセル
              </button>
              <button
                type="button"
                disabled={deleteArticleMutation.isPending}
                onClick={() =>
                  deleteArticleMutation.mutate({
                    path: deleteTarget.path,
                    sha: deleteTarget.sha
                  })
                }
                className="px-4 py-1.5 text-xs font-semibold bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
              >
                {deleteArticleMutation.isPending ? '削除実行中...' : '削除を実行する'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* モーダル3: SHA競合（コンフリクト）差分比較・解決ダイアログ */}
      {shaConflict && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-300 rounded-md max-w-4xl w-full max-h-[90vh] flex flex-col p-5 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2 text-base font-bold text-amber-800">
                <AlertTriangle className="w-5 h-5 text-amber-600" />
                <span>SHA競合が発生しました（リモートでの変更を検知）</span>
              </div>
              <button
                type="button"
                onClick={() => setShaConflict(null)}
                className="text-xs text-slate-500 hover:text-slate-800"
              >
                閉じる
              </button>
            </div>

            <div className="text-xs text-slate-700 space-y-1">
              <p>
                編集を開始した時点のSHA (<code className="font-mono bg-slate-100 px-1">{shaConflict.expectedSha.slice(0, 10)}</code>) と、
                現在GitHub上にある最新ファイルのSHA (<code className="font-mono bg-slate-100 px-1">{shaConflict.remoteSha.slice(0, 10)}</code>) が一致しません。
              </p>
              <p className="font-medium">
                無条件の上書きを防止しました。以下の差分（赤＝リモート最新版、緑＝あなたの編集内容）を確認し、解決方法を選択してください。
              </p>
            </div>

            <div className="flex-1 overflow-auto border border-slate-300 rounded bg-slate-950 text-slate-100 font-mono text-xs p-3 space-y-0.5">
              {computeLineDiff(shaConflict.remoteContent, editorContent).map((line, idx) => (
                <div
                  key={idx}
                  className={
                    line.type === 'added'
                      ? 'bg-emerald-950/80 text-emerald-300 px-2 py-0.5'
                      : line.type === 'removed'
                      ? 'bg-red-950/80 text-red-300 px-2 py-0.5'
                      : 'text-slate-400 px-2 py-0.5'
                  }
                >
                  <span className="inline-block w-5 select-none">
                    {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
                  </span>
                  <span className="whitespace-pre-wrap break-all">{line.text}</span>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => {
                  // リモートの最新内容を採用してエディタを更新
                  setEditorContent(shaConflict.remoteContent);
                  setOriginalContent(shaConflict.remoteContent);
                  setCurrentSha(shaConflict.remoteSha);
                  setEditorDirty(false);
                  setShaConflict(null);
                  pushToast({
                    type: 'info',
                    title: 'GitHub上の最新内容をエディタに読み込みました'
                  });
                }}
                className="px-3.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50"
              >
                リモート最新版を採用（自分の変更を破棄）
              </button>
              <button
                type="button"
                onClick={() => {
                  // 基準SHAをリモート最新SHAに更新した上で、エディタ上で手動マージを続ける
                  setCurrentSha(shaConflict.remoteSha);
                  setShaConflict(null);
                  pushToast({
                    type: 'info',
                    title: '基準SHAを最新に更新しました',
                    message: '必要に応じて内容を調整し、再度保存を実行してください。'
                  });
                }}
                className="px-4 py-1.5 text-xs font-semibold bg-amber-700 text-white rounded hover:bg-amber-800"
              >
                最新SHAを引き継いで現在の編集内容を維持する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const base64 = result.includes(',') ? (result.split(',')[1] ?? '') : result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('画像ファイルの読み込みに失敗しました'));
    reader.readAsDataURL(file);
  });
}
