/**
 * src/js/articles.tsx
 * GitHub記事管理セクション（Articles）。
 *
 * - リポジトリ切り替え
 * - 記事一覧取得（Git Trees API経由）、タイトル・パス検索、更新日時・パスでの並べ替え（TanStack Table）
 * - 新規記事作成・既存記事編集のどちらでも「ファイル名を自由に設定・変更（リネーム）」可能
 * - 複数ファイル同時タブ編集・ローカルの複数 .md ファイル一括取り込み・「全ファイルを一括でGitHubに保存」対応
 * - SHA競合（409 / SHA mismatch）発生時の無条件上書き防止と、リモート最新版との行単位差分（Diff）比較・解決モーダル
 */

import React, { useState, useMemo, useEffect, useRef } from 'react';
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
  ArrowUpDown,
  Layers,
  FolderUp,
  X
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

/**
 * 複数ファイルを同時に開いて編集・一括保存するためのワークスペースタブ構造
 */
export interface ArticleEditorTab {
  tabId: string;
  isNew: boolean;
  originalPath: string; // 既存記事の元パス（新規の場合は空文字）
  filenameInput: string; // 自由に設定・変更可能なファイル名またはパス
  sha: string; // 既存記事のSHA
  originalContent: string;
  content: string;
  isDirty: boolean;
}

export const ArticlesSection: React.FC = () => {
  const queryClient = useQueryClient();
  const {
    selectedRepositoryId,
    setSelectedRepositoryId,
    isEditorDirty,
    setEditorDirty,
    pushToast
  } = useAppStore();

  // モード管理: list (一覧) | editor (単一または複数ファイルタブ編集)
  const [mode, setMode] = useState<'list' | 'editor'>('list');
  const [searchKeyword, setSearchKeyword] = useState<string>('');
  const [sorting, setSorting] = useState<SortingState>([{ id: 'updatedAt', desc: true }]);

  // 複数ファイル編集タブ管理
  const [tabs, setTabs] = useState<ArticleEditorTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>('');
  const [commitMessage, setCommitMessage] = useState<string>('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const localMdInputRef = useRef<HTMLInputElement | null>(null);

  // モーダル状態
  const [saveConfirmMode, setSaveConfirmMode] = useState<'single' | 'batch' | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ path: string; sha: string; title: string } | null>(null);
  const [shaConflict, setShaConflict] = useState<ShaConflictDetails | null>(null);

  const activeTab = useMemo(() => {
    return tabs.find((t) => t.tabId === activeTabId) ?? tabs[0] ?? null;
  }, [tabs, activeTabId]);

  // いずれかのタブが未保存ならグローバルの isEditorDirty を true にする
  useEffect(() => {
    const anyDirty = tabs.some((t) => t.isDirty);
    if (anyDirty !== isEditorDirty) {
      setEditorDirty(anyDirty);
    }
  }, [tabs, isEditorDirty, setEditorDirty]);

  // ブラウザを閉じる・リロードする際の未保存警告
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isEditorDirty) {
        e.preventDefault();
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

  // パスから記事ディレクトリを除いた自由編集用ファイル名を抽出するヘルパー
  const extractEditableFilename = (fullPath: string, repoConfig: RepositoryConfig | null): string => {
    if (!repoConfig) return fullPath;
    const dir = repoConfig.articlesDir.replace(/^\/+|\/+$/g, '');
    if (dir && fullPath.startsWith(`${dir}/`)) {
      return fullPath.slice(dir.length + 1);
    }
    return fullPath;
  };

  // 自由入力されたファイル名から保存先の完全パスを算出するヘルパー
  const resolveTargetFullPath = (rawFilename: string, repoConfig: RepositoryConfig | null): string => {
    if (!repoConfig) return rawFilename;
    const raw = rawFilename.trim().replace(/^\/+|\/+$/g, '');
    if (!raw) return '';
    const dir = repoConfig.articlesDir.replace(/^\/+|\/+$/g, '');
    const withDir = dir && !raw.startsWith(`${dir}/`) ? `${dir}/${raw}` : raw;
    return /\.(md|mdx|markdown)$/i.test(withDir) ? withDir : `${withDir}${repoConfig.markdownExt}`;
  };

  // 3. 既存記事の詳細を取得してタブに追加（既に開いていればそのタブをアクティブに）
  const loadArticleDetailMutation = useMutation({
    mutationFn: (path: string) =>
      callAdminApi<ArticleDetail>('articles.get', {
        repositoryId: selectedRepositoryId,
        path
      }),
    onSuccess: (detail) => {
      const existingTab = tabs.find((t) => t.originalPath === detail.path);
      if (existingTab) {
        setActiveTabId(existingTab.tabId);
        setMode('editor');
        return;
      }

      let initialContent = detail.content;
      let dirtyFlag = false;
      const savedDraft = loadArticleDraftFromSession(selectedRepositoryId, detail.path);
      if (savedDraft && savedDraft.content !== detail.content) {
        const restore = window.confirm(
          `「${detail.path}」には一時保存された未保存の編集データ（${formatDateTimeJst(savedDraft.savedAt)}）があります。復元しますか？`
        );
        if (restore) {
          initialContent = savedDraft.content;
          dirtyFlag = true;
        } else {
          clearArticleDraftFromSession(selectedRepositoryId, detail.path);
        }
      }

      const editableName = extractEditableFilename(detail.path, currentRepo);
      const newTab: ArticleEditorTab = {
        tabId: `tab_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        isNew: false,
        originalPath: detail.path,
        filenameInput: editableName,
        sha: detail.sha,
        originalContent: detail.content,
        content: initialContent,
        isDirty: dirtyFlag
      };

      setTabs((prev) => [...prev, newTab]);
      setActiveTabId(newTab.tabId);
      setCommitMessage(`docs: update ${editableName}`);
      setValidationError(null);
      setShaConflict(null);
      setMode('editor');
    },
    onError: (err) => {
      pushToast({
        type: 'error',
        title: '記事の読み込みに失敗しました',
        message: err instanceof Error ? err.message : 'GitHubからの取得エラー'
      });
    }
  });

  // 4. 新規記事タブを追加（複数ファイルを連続で追加作成可能）
  const handleAddNewArticleTab = () => {
    if (!currentRepo) return;
    const countSuffix = tabs.filter((t) => t.isNew).length + 1;
    const defaultSlug = countSuffix === 1 ? 'new-article' : `new-article-${countSuffix}`;
    const defaultFilename = `${defaultSlug}${currentRepo.markdownExt}`;
    const initialMd = buildInitialArticleMarkdown({
      title: 'Cyano – サポート',
      slug: defaultSlug,
      format: currentRepo.frontmatterFormat,
      defaultTemplate: currentRepo.defaultTemplate
    });

    const newTab: ArticleEditorTab = {
      tabId: `tab_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      isNew: true,
      originalPath: '',
      filenameInput: defaultFilename,
      sha: '',
      originalContent: '',
      content: initialMd,
      isDirty: true
    };

    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTab.tabId);
    setCommitMessage(
      tabs.length > 0
        ? `docs: batch update ${tabs.length + 1} articles`
        : `docs: create ${defaultFilename}`
    );
    setValidationError(null);
    setShaConflict(null);
    setMode('editor');
  };

  // 5. ローカルPC/スマホから複数のMarkdownファイル（.md / .mdx）を一気に読み込んでタブに展開
  const handleImportLocalMarkdownFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0 || !currentRepo) return;

    const importedTabs: ArticleEditorTab[] = [];
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      if (!file) continue;
      const text = await file.text();
      // 既存記事一覧に同名ファイルがあるかチェック（あればそのパスとSHAを引き継いで上書き更新対象にする）
      const targetFullPath = resolveTargetFullPath(file.name, currentRepo);
      const matchedExisting = (articlesQuery.data?.articles ?? []).find(
        (a) => a.path === targetFullPath || a.filename === file.name.replace(/\.(md|mdx|markdown)$/i, '')
      );

      importedTabs.push({
        tabId: `tab_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
        isNew: !matchedExisting,
        originalPath: matchedExisting ? matchedExisting.path : '',
        filenameInput: file.name,
        sha: matchedExisting ? matchedExisting.sha : '',
        originalContent: '',
        content: text,
        isDirty: true
      });
    }

    if (importedTabs.length > 0) {
      setTabs((prev) => [...prev, ...importedTabs]);
      if (importedTabs[0]) {
        setActiveTabId(importedTabs[0].tabId);
      }
      setCommitMessage(`docs: batch save ${tabs.length + importedTabs.length} articles`);
      setMode('editor');
      pushToast({
        type: 'info',
        title: `${importedTabs.length} 件のMarkdownファイルを読み込みました`,
        message: 'ファイル名や内容を確認後、「全ファイルを一括保存」で一度にコミットできます。'
      });
    }

    if (localMdInputRef.current) {
      localMdInputRef.current.value = '';
    }
  };

  // アクティブタブの本文変更
  const handleActiveTabContentChange = (nextVal: string) => {
    if (!activeTab || !currentRepo) return;
    setTabs((prev) =>
      prev.map((t) => {
        if (t.tabId !== activeTab.tabId) return t;
        const dirty = t.isNew ? nextVal.trim().length > 0 : nextVal !== t.originalContent || resolveTargetFullPath(t.filenameInput, currentRepo) !== t.originalPath;
        return {
          ...t,
          content: nextVal,
          isDirty: dirty
        };
      })
    );
    saveArticleDraftToSession(
      currentRepo.id,
      activeTab.isNew ? `__new_${activeTab.tabId}` : activeTab.originalPath,
      nextVal
    );
  };

  // アクティブタブのファイル名変更（新規も既存も自由に変更可能）
  const handleActiveTabFilenameChange = (nextFilename: string) => {
    if (!activeTab || !currentRepo) return;
    setTabs((prev) =>
      prev.map((t) => {
        if (t.tabId !== activeTab.tabId) return t;
        const nextFullPath = resolveTargetFullPath(nextFilename, currentRepo);
        const dirty = t.isNew || t.content !== t.originalContent || nextFullPath !== t.originalPath;
        return {
          ...t,
          filenameInput: nextFilename,
          isDirty: dirty
        };
      })
    );
  };

  // 個別タブを閉じる
  const handleCloseTab = (tabId: string) => {
    const target = tabs.find((t) => t.tabId === tabId);
    if (!target) return;
    if (target.isDirty) {
      const ok = window.confirm(`「${target.filenameInput}」には未保存の変更があります。このタブを閉じますか？`);
      if (!ok) return;
    }
    const remaining = tabs.filter((t) => t.tabId !== tabId);
    setTabs(remaining);
    if (remaining.length === 0) {
      setMode('list');
    } else if (activeTabId === tabId && remaining[0]) {
      setActiveTabId(remaining[0].tabId);
    }
  };

  // 6. 現在開いているタブ1件のみを保存する Mutation
  const saveSingleArticleMutation = useMutation({
    mutationFn: async () => {
      if (!currentRepo || !activeTab) throw new Error('対象が選択されていません');
      const targetFullPath = resolveTargetFullPath(activeTab.filenameInput, currentRepo);

      if (activeTab.isNew) {
        return callAdminApi<ArticleSaveResult>('articles.create', {
          repositoryId: currentRepo.id,
          filename: activeTab.filenameInput,
          content: activeTab.content,
          commitMessage: commitMessage || `docs: create ${targetFullPath}`
        });
      }
      return callAdminApi<ArticleSaveResult>('articles.update', {
        repositoryId: currentRepo.id,
        path: activeTab.originalPath,
        newFilename: activeTab.filenameInput,
        sha: activeTab.sha,
        content: activeTab.content,
        commitMessage: commitMessage || `docs: update ${targetFullPath}`
      });
    },
    onSuccess: (res) => {
      setSaveConfirmMode(null);
      setShaConflict(null);
      if (currentRepo && activeTab) {
        clearArticleDraftFromSession(
          currentRepo.id,
          activeTab.isNew ? `__new_${activeTab.tabId}` : activeTab.originalPath
        );
        const editableName = extractEditableFilename(res.path, currentRepo);
        setTabs((prev) =>
          prev.map((t) =>
            t.tabId === activeTab.tabId
              ? {
                  ...t,
                  isNew: false,
                  originalPath: res.path,
                  filenameInput: editableName,
                  sha: res.sha,
                  originalContent: t.content,
                  isDirty: false
                }
              : t
          )
        );
      }

      queryClient.invalidateQueries({ queryKey: ['articles', selectedRepositoryId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });

      pushToast({
        type: 'success',
        title: 'GitHubへ記事を保存しました',
        message: `パス: ${res.path}`
      });
    },
    onError: (err) => {
      setSaveConfirmMode(null);
      if (err instanceof AdminApiError && err.code === 'GITHUB_SHA_CONFLICT' && err.details) {
        const details = err.details as unknown as ShaConflictDetails;
        if (details && details.conflict) {
          setShaConflict(details);
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

  // 7. 開いている全タブ（複数ファイル）を1コミットで一気に保存する Mutation
  const batchSaveArticlesMutation = useMutation({
    mutationFn: async () => {
      if (!currentRepo || tabs.length === 0) throw new Error('保存対象のファイルがありません');
      const payloadFiles = tabs.map((t) => ({
        filename: t.filenameInput,
        originalPath: t.isNew ? '' : t.originalPath,
        sha: t.isNew ? '' : t.sha,
        content: t.content
      }));

      return callAdminApi<{
        repositoryId: string;
        savedCount: number;
        savedPaths: string[];
        commitSha: string;
      }>('articles.batchSave', {
        repositoryId: currentRepo.id,
        files: payloadFiles,
        commitMessage: commitMessage || `docs: batch save ${tabs.length} articles`
      });
    },
    onSuccess: (res) => {
      setSaveConfirmMode(null);
      setShaConflict(null);
      if (currentRepo) {
        for (const t of tabs) {
          clearArticleDraftFromSession(
            currentRepo.id,
            t.isNew ? `__new_${t.tabId}` : t.originalPath
          );
        }
      }
      setTabs([]);
      setEditorDirty(false);
      setMode('list');

      queryClient.invalidateQueries({ queryKey: ['articles', selectedRepositoryId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });

      pushToast({
        type: 'success',
        title: `${res.savedCount} 件のファイルを一括でGitHubに保存しました`,
        message: `Commit: ${res.commitSha.slice(0, 7)} (${res.savedPaths.join(', ')})`
      });
    },
    onError: (err) => {
      setSaveConfirmMode(null);
      if (err instanceof AdminApiError && err.code === 'GITHUB_SHA_CONFLICT' && err.details) {
        const details = err.details as unknown as ShaConflictDetails;
        if (details && details.conflict) {
          setShaConflict(details);
          return;
        }
      }
      pushToast({
        type: 'error',
        title: '複数ファイルの一括保存に失敗しました',
        message: err instanceof Error ? err.message : 'GitHub一括コミットエラー'
      });
    }
  });

  // 8. 記事削除 Mutation
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
      setTabs((prev) => prev.filter((t) => t.originalPath !== res.deletedPath));
      if (tabs.length <= 1) {
        setMode('list');
      }
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

  // 9. 画像アップロード
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

  // 保存前検証
  const handleRequestSave = (targetMode: 'single' | 'batch') => {
    if (!currentRepo) return;
    const targets = targetMode === 'single' ? (activeTab ? [activeTab] : []) : tabs;
    if (targets.length === 0) return;

    const pathSet = new Set<string>();
    for (const t of targets) {
      const parsed = articleSaveSchema.safeParse({
        repositoryId: currentRepo.id,
        filename: t.filenameInput,
        content: t.content,
        commitMessage: commitMessage || 'docs: save articles'
      });
      if (!parsed.success) {
        const msg = parsed.error.issues[0]?.message || '入力内容を確認してください';
        setValidationError(`ファイル「${t.filenameInput || '(未入力)'}」: ${msg}`);
        return;
      }
      const fullPath = resolveTargetFullPath(t.filenameInput, currentRepo);
      if (pathSet.has(fullPath)) {
        setValidationError(`同じ保存先ファイル名（${fullPath}）が複数のタブで重複しています。別々のファイル名を設定してください。`);
        return;
      }
      pathSet.add(fullPath);
    }

    setValidationError(null);
    setSaveConfirmMode(targetMode);
  };

  // 一覧に戻る
  const handleBackToList = () => {
    if (tabs.some((t) => t.isDirty)) {
      const ok = window.confirm('未保存のタブがあります。編集画面を閉じて記事一覧に戻りますか？');
      if (!ok) return;
    }
    setTabs([]);
    setEditorDirty(false);
    setShaConflict(null);
    setMode('list');
  };

  // TanStack Table カラム定義
  const columns = useMemo(
    () => [
      columnHelper.accessor('title', {
        header: 'ファイル名 / パス',
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
                <span className="break-all">{row.filename}</span>
              </button>
              <span className="text-xs text-slate-500 font-mono mt-0.5 break-all">{row.path}</span>
            </div>
          );
        }
      }),
      columnHelper.accessor('updatedAt', {
        header: ({ column }) => (
          <button
            type="button"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
            className="flex items-center gap-1 font-semibold text-slate-700 hover:text-slate-900 whitespace-nowrap"
          >
            <span>最終更新 (JST)</span>
            <ArrowUpDown className="w-3.5 h-3.5" />
          </button>
        ),
        cell: (info) => (
          <span className="text-xs text-slate-600 whitespace-nowrap">
            {formatDateTimeJst(info.getValue())}
          </span>
        )
      }),
      columnHelper.accessor('size', {
        header: 'サイズ',
        cell: (info) => (
          <span className="text-xs font-mono text-slate-600 whitespace-nowrap">
            {(info.getValue() / 1024).toFixed(1)} KB
          </span>
        )
      }),
      columnHelper.display({
        id: 'links',
        header: 'リンク',
        cell: (info) => {
          const row = info.row.original;
          return (
            <div className="flex items-center gap-2 text-xs whitespace-nowrap">
              {row.publicUrl && (
                <a
                  href={row.publicUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                >
                  <span>公開</span>
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
            <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
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
    [selectedRepositoryId, tabs]
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

  if (!reposQuery.isLoading && activeRepositories.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-md p-6">
        <h2 className="text-base font-bold text-slate-900 mb-2">有効なGitHubリポジトリが登録されていません</h2>
        <p className="text-sm text-slate-600 mb-4">
          記事管理を行うには、まず「Settings（設定）」セクションから管理対象のGitHub Pagesリポジトリを登録してください。
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

  return (
    <div className="space-y-4">
      {/* ローカルの複数 .md ファイル読み込み用 hidden input */}
      <input
        ref={localMdInputRef}
        type="file"
        multiple
        accept=".md,.mdx,.markdown,text/markdown,text/plain"
        onChange={handleImportLocalMarkdownFiles}
        className="hidden"
      />

      {/* 上部バー：対象GitHubリポジトリ切り替えと操作ボタン */}
      <div className="bg-white border border-slate-200 rounded-md p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1.5">
            <FolderGit2 className="w-4 h-4 text-slate-700 shrink-0" />
            <label htmlFor="repo-select" className="text-xs font-semibold text-slate-700 whitespace-nowrap">
              リポジトリ:
            </label>
          </div>
          <select
            id="repo-select"
            value={selectedRepositoryId}
            onChange={(e) => {
              setSelectedRepositoryId(e.target.value);
              setTabs([]);
              setMode('list');
            }}
            className="px-2.5 py-1.5 text-xs sm:text-sm font-medium border border-slate-300 rounded bg-white text-slate-900 max-w-full"
          >
            {activeRepositories.map((repo) => (
              <option key={repo.id} value={repo.id}>
                {repo.displayName} ({repo.owner}/{repo.repo})
              </option>
            ))}
          </select>

          {currentRepo && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono">
                <GitBranch className="w-3 h-3" />
                {currentRepo.branch}
              </span>
              <span className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono">
                /{currentRepo.articlesDir || '(root)'}
              </span>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {mode === 'list' ? (
            <>
              <button
                type="button"
                disabled={refreshMutation.isPending || articlesQuery.isFetching}
                onClick={() => refreshMutation.mutate()}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${refreshMutation.isPending ? 'animate-spin' : ''}`} />
                <span>再取得</span>
              </button>
              <button
                type="button"
                onClick={() => localMdInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-800 bg-slate-100 border border-slate-300 rounded hover:bg-slate-200"
                title="複数の .md ファイルをまとめて読み込んで一括保存できます"
              >
                <FolderUp className="w-3.5 h-3.5" />
                <span>複数MDファイル読込</span>
              </button>
              <button
                type="button"
                onClick={handleAddNewArticleTab}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-slate-900 text-white rounded hover:bg-slate-800"
              >
                <Plus className="w-4 h-4" />
                <span>新規記事作成</span>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={handleAddNewArticleTab}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-800 bg-slate-100 border border-slate-300 rounded hover:bg-slate-200"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>＋新規ファイル追加</span>
              </button>
              <button
                type="button"
                onClick={() => localMdInputRef.current?.click()}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-800 bg-slate-100 border border-slate-300 rounded hover:bg-slate-200"
              >
                <FolderUp className="w-3.5 h-3.5" />
                <span>＋MD読込</span>
              </button>
              <button
                type="button"
                onClick={handleBackToList}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>一覧に戻る</span>
              </button>
            </>
          )}
        </div>
      </div>

      {loadArticleDetailMutation.isPending && (
        <div className="bg-white border border-slate-200 rounded-md p-6 text-center text-sm text-slate-600">
          GitHubから最新の記事データとSHAを取得しています...
        </div>
      )}

      {/* モード1: 記事一覧表示 */}
      {mode === 'list' && !loadArticleDetailMutation.isPending && (
        <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
          <div className="p-3.5 sm:p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                placeholder="ファイル名・パスで検索..."
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
                          <th key={header.id} className="py-2.5 px-3 sm:px-4 font-semibold">
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
                          <td key={cell.id} className="py-2.5 px-3 sm:px-4 align-middle">
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

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

      {/* モード2: エディタ（単一・複数ファイルタブ切り替え＆一括保存対応） */}
      {mode === 'editor' && currentRepo && activeTab && !loadArticleDetailMutation.isPending && (
        <div className="space-y-3">
          {/* 複数ファイルタブバー */}
          <div className="bg-white border border-slate-200 rounded-md p-2 flex items-center gap-1.5 overflow-x-auto">
            {tabs.map((tab) => {
              const isCurrent = tab.tabId === activeTab.tabId;
              return (
                <div
                  key={tab.tabId}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono border shrink-0 cursor-pointer ${
                    isCurrent
                      ? 'bg-slate-900 text-white border-slate-900 font-semibold'
                      : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                  onClick={() => setActiveTabId(tab.tabId)}
                >
                  <FileText className="w-3.5 h-3.5 shrink-0" />
                  <span className="max-w-[180px] truncate">
                    {tab.filenameInput || '(名称未設定)'}
                  </span>
                  {tab.isDirty && (
                    <span
                      className={`w-2 h-2 rounded-full ${isCurrent ? 'bg-amber-400' : 'bg-amber-500'}`}
                      title="未保存の変更あり"
                    />
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCloseTab(tab.tabId);
                    }}
                    className={`p-0.5 rounded hover:bg-slate-700/30 ${
                      isCurrent ? 'text-slate-300 hover:text-white' : 'text-slate-400 hover:text-slate-800'
                    }`}
                    title="このファイルタブを閉じる"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
            <button
              type="button"
              onClick={handleAddNewArticleTab}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded shrink-0"
              title="もう1つ新しい記事ファイルタブを追加します"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>ファイルを追加</span>
            </button>
          </div>

          {/* ファイル名自由設定・コミットメッセージ・保存操作バー */}
          <div className="bg-white border border-slate-200 rounded-md p-3.5 sm:p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`px-2 py-0.5 text-xs font-semibold rounded ${
                    activeTab.isNew
                      ? 'bg-blue-100 text-blue-800'
                      : 'bg-slate-200 text-slate-800'
                  }`}
                >
                  {activeTab.isNew ? '新規ファイル' : '既存ファイル編集'}
                </span>
                <span className="text-xs text-slate-600">
                  開いているファイル: <strong>{tabs.length}</strong> 件
                </span>
                {!activeTab.isNew && activeTab.sha && (
                  <span className="text-xs font-mono text-slate-500">
                    SHA: {activeTab.sha.slice(0, 8)}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {!activeTab.isNew && activeTab.originalPath && (
                  <button
                    type="button"
                    onClick={() =>
                      setDeleteTarget({
                        path: activeTab.originalPath,
                        sha: activeTab.sha,
                        title: activeTab.originalPath
                      })
                    }
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded hover:bg-red-100"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>削除</span>
                  </button>
                )}

                <button
                  type="button"
                  disabled={saveSingleArticleMutation.isPending || batchSaveArticlesMutation.isPending}
                  onClick={() => handleRequestSave('single')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-slate-900 text-white rounded hover:bg-slate-800 disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>現在のファイルのみ保存</span>
                </button>

                {tabs.length > 1 && (
                  <button
                    type="button"
                    disabled={saveSingleArticleMutation.isPending || batchSaveArticlesMutation.isPending}
                    onClick={() => handleRequestSave('batch')}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                  >
                    <Layers className="w-3.5 h-3.5" />
                    <span>全 {tabs.length} ファイルを一括でGitHubに保存</span>
                  </button>
                )}
              </div>
            </div>

            {validationError && (
              <div className="p-2.5 bg-red-50 border border-red-200 rounded text-xs text-red-800 font-medium">
                入力エラー: {validationError}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* ファイル名をいつでも自由に設定・変更（リネーム）できる入力欄 */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  ファイル名（自由に設定・変更可能 / 保存先ディレクトリ: /{currentRepo.articlesDir || ''}）
                </label>
                <input
                  type="text"
                  value={activeTab.filenameInput}
                  onChange={(e) => handleActiveTabFilenameChange(e.target.value)}
                  placeholder={`cyano-support${currentRepo.markdownExt}`}
                  className="w-full px-3 py-1.5 text-sm font-mono border border-slate-300 rounded bg-white focus:outline-none focus:border-blue-600"
                />
                <div className="text-xs text-slate-500 font-mono mt-1 break-all">
                  保存先フルパス:{' '}
                  <strong className="text-slate-800">
                    {resolveTargetFullPath(activeTab.filenameInput, currentRepo) || '—'}
                  </strong>
                  {!activeTab.isNew &&
                    resolveTargetFullPath(activeTab.filenameInput, currentRepo) !== activeTab.originalPath && (
                      <span className="ml-2 text-amber-700 font-semibold">
                        （旧ファイル {activeTab.originalPath} からリネームされます）
                      </span>
                    )}
                </div>
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
            value={activeTab.content}
            onChange={handleActiveTabContentChange}
            repository={currentRepo}
            onUploadImage={(file) => uploadImageMutation.mutateAsync(file)}
            isUploadingImage={uploadImageMutation.isPending}
          />
        </div>
      )}

      {/* モーダル1: 保存前の確認ダイアログ（単一保存 / 複数ファイル一括保存） */}
      {saveConfirmMode && currentRepo && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-md max-w-lg w-full p-5 space-y-4 shadow-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center gap-2 text-base font-bold text-slate-900">
              <CheckCircle2 className="w-5 h-5 text-blue-600 shrink-0" />
              <span>
                {saveConfirmMode === 'batch'
                  ? `全 ${tabs.length} ファイルの一括保存確認`
                  : 'GitHubへの記事保存確認'}
              </span>
            </div>
            <p className="text-xs text-slate-600">
              以下のファイルを GitHub リポジトリ（{currentRepo.owner}/{currentRepo.repo} : {currentRepo.branch}）へコミットします。よろしいですか？
            </p>
            <div className="bg-slate-50 border border-slate-200 rounded p-3 text-xs space-y-2">
              <div>
                <span className="font-semibold text-slate-600">コミットメッセージ: </span>
                <span className="text-slate-900">{commitMessage}</span>
              </div>
              <div className="border-t border-slate-200 pt-2 space-y-1.5">
                <div className="font-semibold text-slate-700">保存対象ファイル一覧:</div>
                {(saveConfirmMode === 'batch' ? tabs : activeTab ? [activeTab] : []).map((t) => {
                  const full = resolveTargetFullPath(t.filenameInput, currentRepo);
                  const renamed = !t.isNew && t.originalPath !== full;
                  return (
                    <div key={t.tabId} className="font-mono text-slate-900 bg-white p-1.5 border border-slate-200 rounded">
                      <div>
                        <span className="px-1.5 py-0.5 text-[10px] rounded bg-slate-100 text-slate-700 mr-1.5">
                          {t.isNew ? '新規' : renamed ? 'リネーム更新' : '更新'}
                        </span>
                        {full}
                      </div>
                      {renamed && (
                        <div className="text-[11px] text-amber-700 mt-0.5">
                          旧パス削除: {t.originalPath}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={saveSingleArticleMutation.isPending || batchSaveArticlesMutation.isPending}
                onClick={() => setSaveConfirmMode(null)}
                className="px-3.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50"
              >
                キャンセル
              </button>
              <button
                type="button"
                disabled={saveSingleArticleMutation.isPending || batchSaveArticlesMutation.isPending}
                onClick={() => {
                  if (saveConfirmMode === 'batch') {
                    batchSaveArticlesMutation.mutate();
                  } else {
                    saveSingleArticleMutation.mutate();
                  }
                }}
                className="px-4 py-1.5 text-xs font-semibold bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {saveSingleArticleMutation.isPending || batchSaveArticlesMutation.isPending
                  ? 'GitHubへコミット実行中...'
                  : '確定してGitHubに保存'}
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
              GitHubリポジトリから以下のMarkdownファイルを削除します。本当に削除しますか？
            </p>
            <div className="bg-red-50 border border-red-200 rounded p-3 text-xs space-y-1 font-mono text-red-900 break-all">
              <div>repo: {currentRepo.owner}/{currentRepo.repo} ({currentRepo.branch})</div>
              <div>path: {deleteTarget.path}</div>
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
      {shaConflict && activeTab && (
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
                対象ファイル (<code className="font-mono bg-slate-100 px-1">{shaConflict.path}</code>) のSHAがGitHub上の最新版と一致しません。
              </p>
            </div>

            <div className="flex-1 overflow-auto border border-slate-300 rounded bg-slate-950 text-slate-100 font-mono text-xs p-3 space-y-0.5">
              {computeLineDiff(shaConflict.remoteContent, activeTab.content).map((line, idx) => (
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
                  setTabs((prev) =>
                    prev.map((t) =>
                      t.originalPath === shaConflict.path
                        ? {
                            ...t,
                            content: shaConflict.remoteContent,
                            originalContent: shaConflict.remoteContent,
                            sha: shaConflict.remoteSha,
                            isDirty: false
                          }
                        : t
                    )
                  );
                  setShaConflict(null);
                }}
                className="px-3.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50"
              >
                リモート最新版を採用（自分の変更を破棄）
              </button>
              <button
                type="button"
                onClick={() => {
                  setTabs((prev) =>
                    prev.map((t) =>
                      t.originalPath === shaConflict.path
                        ? { ...t, sha: shaConflict.remoteSha }
                        : t
                    )
                  );
                  setShaConflict(null);
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
