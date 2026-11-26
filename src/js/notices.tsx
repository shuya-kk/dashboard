/**
 * src/js/notices.tsx
 * お知らせ管理セクション（Notices）。
 *
 * - アプリ別フィルター
 * - ステータスタブ切り替え（すべて / 公開済み published / 公開予約 scheduled / 下書き draft / アーカイブ archived）
 * - 新規作成・編集・削除（削除前確認ダイアログ付き）
 * - 公開状態変更・公開予約・公開日時変更（日本時間JST入力 -> UTC ISO 8601保存）
 * - GAS時間主導型トリガーの即時チェック実行ボタン
 */

import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  flexRender,
  createColumnHelper,
  type SortingState
} from '@tanstack/react-table';
import {
  Bell,
  Plus,
  Trash2,
  Edit3,
  Clock,
  CheckCircle,
  FileEdit,
  Archive,
  Play
} from 'lucide-react';
import { callAdminApi } from './api';
import { useAppStore } from './store';
import {
  formatDateTimeJst,
  isoToJstDatetimeLocal,
  jstDatetimeLocalToIso
} from './utils';
import { noticeInputSchema } from '../schemas/validation';
import type { ApplicationItem, NoticeItem, NoticeStatus } from '../types/domain';

const columnHelper = createColumnHelper<NoticeItem>();

const STATUS_LABELS: Record<NoticeStatus, { label: string; badgeClass: string }> = {
  draft: { label: '下書き (draft)', badgeClass: 'bg-slate-100 text-slate-700 border-slate-300' },
  scheduled: { label: '公開予約 (scheduled)', badgeClass: 'bg-amber-50 text-amber-800 border-amber-300' },
  published: { label: '公開中 (published)', badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-300' },
  archived: { label: 'アーカイブ (archived)', badgeClass: 'bg-slate-200 text-slate-600 border-slate-300' }
};

export const NoticesSection: React.FC = () => {
  const queryClient = useQueryClient();
  const { pushToast } = useAppStore();

  const [selectedAppId, setSelectedAppId] = useState<string>('');
  const [selectedStatusTab, setSelectedStatusTab] = useState<'all' | NoticeStatus>('all');
  const [sorting, setSorting] = useState<SortingState>([{ id: 'publishedAt', desc: true }]);

  // フォームモーダル状態
  const [editingNotice, setEditingNotice] = useState<NoticeItem | null>(null);
  const [isFormOpen, setIsFormOpen] = useState<boolean>(false);
  const [formAppId, setFormAppId] = useState<string>('');
  const [formTitle, setFormTitle] = useState<string>('');
  const [formBody, setFormBody] = useState<string>('');
  const [formStatus, setFormStatus] = useState<NoticeStatus>('draft');
  const [formPublishedAtLocal, setFormPublishedAtLocal] = useState<string>('');
  const [formError, setFormError] = useState<string | null>(null);

  // 削除確認対象
  const [deleteTarget, setDeleteTarget] = useState<NoticeItem | null>(null);

  // アプリ一覧マスター取得
  const appsQuery = useQuery({
    queryKey: ['applications'],
    queryFn: () => callAdminApi<{ applications: ApplicationItem[] }>('applications.list')
  });

  const applications = appsQuery.data?.applications ?? [];
  const appMap = useMemo(() => {
    const map = new Map<string, ApplicationItem>();
    for (const app of applications) {
      map.set(app.id, app);
    }
    return map;
  }, [applications]);

  // お知らせ一覧取得
  const noticesQuery = useQuery({
    queryKey: ['notices'],
    queryFn: () => callAdminApi<{ notices: NoticeItem[] }>('notices.list', {})
  });

  const filteredNotices = useMemo(() => {
    const all = noticesQuery.data?.notices ?? [];
    return all.filter((item) => {
      if (selectedAppId && item.appId !== selectedAppId) return false;
      if (selectedStatusTab !== 'all' && item.status !== selectedStatusTab) return false;
      return true;
    });
  }, [noticesQuery.data, selectedAppId, selectedStatusTab]);

  // 新規・編集モーダルを開く
  const openCreateModal = () => {
    const defaultAppId = selectedAppId || applications[0]?.id || '';
    setEditingNotice(null);
    setFormAppId(defaultAppId);
    setFormTitle('');
    setFormBody('');
    setFormStatus('draft');
    setFormPublishedAtLocal(isoToJstDatetimeLocal(new Date().toISOString()));
    setFormError(null);
    setIsFormOpen(true);
  };

  const openEditModal = (item: NoticeItem) => {
    setEditingNotice(item);
    setFormAppId(item.appId);
    setFormTitle(item.title);
    setFormBody(item.body);
    setFormStatus(item.status);
    setFormPublishedAtLocal(
      isoToJstDatetimeLocal(item.publishedAt || item.createdAt || new Date().toISOString())
    );
    setFormError(null);
    setIsFormOpen(true);
  };

  // 保存 Mutation
  const saveNoticeMutation = useMutation({
    mutationFn: async () => {
      const isoPublishedAt = formPublishedAtLocal ? jstDatetimeLocalToIso(formPublishedAtLocal) : '';
      const parsed = noticeInputSchema.safeParse({
        appId: formAppId,
        title: formTitle,
        body: formBody,
        status: formStatus,
        publishedAt: isoPublishedAt
      });

      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message || '入力内容を確認してください');
      }

      if (editingNotice) {
        return callAdminApi<NoticeItem>('notices.update', {
          id: editingNotice.id,
          ...parsed.data
        });
      }
      return callAdminApi<NoticeItem>('notices.create', parsed.data);
    },
    onSuccess: (saved) => {
      setIsFormOpen(false);
      queryClient.invalidateQueries({ queryKey: ['notices'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      pushToast({
        type: 'success',
        title: editingNotice ? 'お知らせを更新しました' : 'お知らせを作成しました',
        message: `「${saved.title}」 (${STATUS_LABELS[saved.status].label})`
      });
    },
    onError: (err) => {
      setFormError(err instanceof Error ? err.message : '保存エラーが発生しました');
    }
  });

  // ステータス即時変更 Mutation
  const quickStatusMutation = useMutation({
    mutationFn: async (args: { item: NoticeItem; nextStatus: NoticeStatus }) => {
      const nextPubAt =
        args.nextStatus === 'published' && !args.item.publishedAt
          ? new Date().toISOString()
          : args.item.publishedAt;
      return callAdminApi<NoticeItem>('notices.update', {
        id: args.item.id,
        appId: args.item.appId,
        title: args.item.title,
        body: args.item.body,
        status: args.nextStatus,
        publishedAt: nextPubAt
      });
    },
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['notices'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      pushToast({
        type: 'success',
        title: '公開状態を変更しました',
        message: `「${updated.title}」 → ${STATUS_LABELS[updated.status].label}`
      });
    },
    onError: (err) => {
      pushToast({
        type: 'error',
        title: '公開状態の変更に失敗しました',
        message: err instanceof Error ? err.message : '更新エラー'
      });
    }
  });

  // 削除 Mutation
  const deleteNoticeMutation = useMutation({
    mutationFn: (id: string) => callAdminApi<{ deletedId: string }>('notices.delete', { id }),
    onSuccess: () => {
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ['notices'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      pushToast({
        type: 'success',
        title: 'お知らせを削除しました'
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

  // 公開予約チェック手動実行
  const runScheduledMutation = useMutation({
    mutationFn: () =>
      callAdminApi<{ publishedCount: number; publishedIds: string[] }>('notices.runScheduled', {}),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['notices'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      pushToast({
        type: 'info',
        title: '公開予約日時チェックを実行しました',
        message:
          res.publishedCount > 0
            ? `${res.publishedCount} 件の予約お知らせを公開状態に昇格しました。`
            : '現在公開時刻を過ぎている未公開の予約お知らせはありません。'
      });
    }
  });

  const columns = useMemo(
    () => [
      columnHelper.accessor('appId', {
        header: '対象アプリ',
        cell: (info) => {
          const app = appMap.get(info.getValue());
          return (
            <span className="inline-block px-2 py-0.5 text-xs font-medium bg-slate-100 text-slate-800 rounded border border-slate-200">
              {app ? app.name : info.getValue()}
            </span>
          );
        }
      }),
      columnHelper.accessor('title', {
        header: 'タイトル / 本文抜粋',
        cell: (info) => {
          const row = info.row.original;
          return (
            <div className="max-w-md">
              <div className="font-semibold text-slate-900">{row.title}</div>
              <div className="text-xs text-slate-500 line-clamp-1 mt-0.5">{row.body}</div>
            </div>
          );
        }
      }),
      columnHelper.accessor('status', {
        header: '公開状態',
        cell: (info) => {
          const st = info.getValue();
          const meta = STATUS_LABELS[st] || STATUS_LABELS.draft;
          return (
            <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded border ${meta.badgeClass}`}>
              {meta.label}
            </span>
          );
        }
      }),
      columnHelper.accessor('publishedAt', {
        header: '公開日時 / 予約日時 (JST)',
        cell: (info) => (
          <span className="text-xs text-slate-700 font-mono">
            {formatDateTimeJst(info.getValue())}
          </span>
        )
      }),
      columnHelper.accessor('updatedAt', {
        header: '最終更新 (JST)',
        cell: (info) => (
          <span className="text-xs text-slate-500 font-mono">
            {formatDateTimeJst(info.getValue())}
          </span>
        )
      }),
      columnHelper.display({
        id: 'actions',
        header: '操作',
        cell: (info) => {
          const row = info.row.original;
          return (
            <div className="flex items-center justify-end gap-1.5">
              {row.status !== 'published' ? (
                <button
                  type="button"
                  disabled={quickStatusMutation.isPending}
                  onClick={() => quickStatusMutation.mutate({ item: row, nextStatus: 'published' })}
                  className="px-2 py-1 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-300 rounded hover:bg-emerald-100"
                >
                  即時公開
                </button>
              ) : (
                <button
                  type="button"
                  disabled={quickStatusMutation.isPending}
                  onClick={() => quickStatusMutation.mutate({ item: row, nextStatus: 'draft' })}
                  className="px-2 py-1 text-xs font-medium text-slate-700 bg-slate-100 border border-slate-300 rounded hover:bg-slate-200"
                >
                  下書きへ戻す
                </button>
              )}
              <button
                type="button"
                onClick={() => openEditModal(row)}
                className="p-1.5 text-slate-700 hover:bg-slate-100 rounded border border-slate-200"
                title="編集・公開予約設定"
              >
                <Edit3 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setDeleteTarget(row)}
                className="p-1.5 text-red-600 hover:bg-red-50 rounded border border-transparent hover:border-red-200"
                title="削除"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        }
      })
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [appMap]
  );

  const table = useReactTable({
    data: filteredNotices,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel()
  });

  return (
    <div className="space-y-4">
      {/* ヘッダー・フィルターバー */}
      <div className="bg-white border border-slate-200 rounded-md p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
            <Bell className="w-4 h-4 text-slate-700" />
            <span>アプリ別お知らせ管理</span>
          </div>

          <select
            value={selectedAppId}
            onChange={(e) => setSelectedAppId(e.target.value)}
            className="px-3 py-1.5 text-xs font-medium border border-slate-300 rounded bg-white text-slate-900"
          >
            <option value="">すべてのアプリ</option>
            {applications.map((app) => (
              <option key={app.id} value={app.id}>
                {app.name} ({app.bundleId})
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={runScheduledMutation.isPending}
            onClick={() => runScheduledMutation.mutate()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50"
            title="公開予定日時を過ぎたscheduledのお知らせを今すぐ公開状態に反映します"
          >
            <Play className="w-3.5 h-3.5" />
            <span>予約公開判定を今すぐ実行</span>
          </button>
          <button
            type="button"
            disabled={applications.length === 0}
            onClick={openCreateModal}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-slate-900 text-white rounded hover:bg-slate-800 disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            <span>新規お知らせ作成</span>
          </button>
        </div>
      </div>

      {applications.length === 0 && !appsQuery.isLoading && (
        <div className="p-4 bg-amber-50 border border-amber-300 rounded-md text-xs text-amber-900">
          お知らせはアプリ別に管理されます。先に「Applications（アプリ管理）」からアプリを1件以上登録してください。
        </div>
      )}

      {/* ステータスタブ（すべて / 公開済み一覧 / 公開予約 / 下書き一覧 / アーカイブ） */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 pb-2">
        {(
          [
            { id: 'all', label: 'すべて', icon: Bell },
            { id: 'published', label: '公開済み一覧', icon: CheckCircle },
            { id: 'scheduled', label: '公開予約一覧', icon: Clock },
            { id: 'draft', label: '下書き一覧', icon: FileEdit },
            { id: 'archived', label: 'アーカイブ', icon: Archive }
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          const active = selectedStatusTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSelectedStatusTab(tab.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded border ${
                active
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* お知らせテーブル */}
      <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
        {noticesQuery.isLoading ? (
          <div className="p-8 text-center text-sm text-slate-600">Google Sheets からお知らせ一覧を取得中...</div>
        ) : filteredNotices.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">該当するお知らせがありません。</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                {table.getHeaderGroups().map((hg) => (
                  <tr key={hg.id} className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                    {hg.headers.map((header) => (
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
        )}
      </div>

      {/* お知らせ作成・編集モーダル */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-md max-w-2xl w-full p-5 space-y-4 shadow-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                {editingNotice ? 'お知らせの編集・公開設定' : '新規お知らせの作成'}
              </h3>
              <button
                type="button"
                onClick={() => setIsFormOpen(false)}
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">対象アプリ *</label>
                  <select
                    value={formAppId}
                    onChange={(e) => setFormAppId(e.target.value)}
                    className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded bg-white"
                  >
                    <option value="">選択してください</option>
                    {applications.map((app) => (
                      <option key={app.id} value={app.id}>
                        {app.name} ({app.bundleId})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">公開ステータス *</label>
                  <select
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value as NoticeStatus)}
                    className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded bg-white"
                  >
                    <option value="draft">下書き (draft)</option>
                    <option value="scheduled">公開予約 (scheduled)</option>
                    <option value="published">公開中 (published)</option>
                    <option value="archived">アーカイブ (archived)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  公開日時 / 公開予定日時（日本時間 JST）
                </label>
                <input
                  type="datetime-local"
                  value={formPublishedAtLocal}
                  onChange={(e) => setFormPublishedAtLocal(e.target.value)}
                  className="w-full sm:w-72 px-3 py-1.5 text-sm font-mono border border-slate-300 rounded bg-white"
                />
                <p className="text-xs text-slate-500 mt-1">
                  ※ステータスを「公開予約 (scheduled)」にした場合、この日時を過ぎるとGAS時間主導型トリガーにより自動的に「公開中 (published)」に切り替わります。
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">タイトル *</label>
                <input
                  type="text"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="メンテナンスのお知らせ / バージョン 1.2.0 リリース"
                  className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">お知らせ本文 *</label>
                <textarea
                  rows={8}
                  value={formBody}
                  onChange={(e) => setFormBody(e.target.value)}
                  placeholder="お知らせの詳細内容を入力してください..."
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded bg-white leading-relaxed"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setIsFormOpen(false)}
                className="px-3.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50"
              >
                キャンセル
              </button>
              <button
                type="button"
                disabled={saveNoticeMutation.isPending}
                onClick={() => saveNoticeMutation.mutate()}
                className="px-4 py-1.5 text-xs font-semibold bg-slate-900 text-white rounded hover:bg-slate-800 disabled:opacity-50"
              >
                {saveNoticeMutation.isPending ? '保存中...' : 'Google Sheetsに保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 削除確認モーダル */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-md max-w-md w-full p-5 space-y-4 shadow-lg">
            <h3 className="text-base font-bold text-red-700">お知らせの削除確認</h3>
            <p className="text-xs text-slate-700">
              お知らせ「<strong>{deleteTarget.title}</strong>」をNoticesシートから削除します。よろしいですか？
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
                disabled={deleteNoticeMutation.isPending}
                onClick={() => deleteNoticeMutation.mutate(deleteTarget.id)}
                className="px-4 py-1.5 text-xs font-semibold bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
              >
                {deleteNoticeMutation.isPending ? '削除中...' : '削除する'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
