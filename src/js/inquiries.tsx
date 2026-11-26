/**
 * src/js/inquiries.tsx
 * お問い合わせ管理セクション（Inquiries）。
 *
 * - 未対応件数のバッジ表示
 * - アプリ別フィルター・ステータス別フィルター（未対応 / 対応中 / 完了）
 * - キーワード検索・日付順ソート（TanStack Table）
 * - 長い問い合わせ本文も見やすい詳細ペイン表示（XSS防止のためHTMLとして描画せずReactテキストノード + pre-wrap で安全に表示）
 * - 対応状況変更および管理者メモ（問い合わせ本文とは独立して保存）の編集
 * - 返信用のメールアプリを開く mailto: リンク生成
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
  Inbox,
  Search,
  Mail,
  Save,
  ArrowUpDown,
  AlertCircle
} from 'lucide-react';
import { callAdminApi } from './api';
import { useAppStore } from './store';
import { formatDateTimeJst } from './utils';
import { inquiryAdminUpdateSchema } from '../schemas/validation';
import type { ApplicationItem, InquiryItem, InquiryStatus } from '../types/domain';

const columnHelper = createColumnHelper<InquiryItem>();

const INQUIRY_STATUS_BADGE: Record<InquiryStatus, string> = {
  未対応: 'bg-red-50 text-red-800 border-red-300 font-semibold',
  対応中: 'bg-amber-50 text-amber-800 border-amber-300 font-medium',
  完了: 'bg-emerald-50 text-emerald-800 border-emerald-300 font-medium'
};

export const InquiriesSection: React.FC = () => {
  const queryClient = useQueryClient();
  const { pushToast } = useAppStore();

  const [filterAppId, setFilterAppId] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<'' | InquiryStatus>('');
  const [keyword, setKeyword] = useState<string>('');
  const [sorting, setSorting] = useState<SortingState>([{ id: 'createdAt', desc: true }]);

  // 選択中の詳細表示・編集状態
  const [selectedInquiryId, setSelectedInquiryId] = useState<string>('');
  const [editStatus, setEditStatus] = useState<InquiryStatus>('未対応');
  const [editAdminMemo, setEditAdminMemo] = useState<string>('');

  // アプリ一覧取得
  const appsQuery = useQuery({
    queryKey: ['applications'],
    queryFn: () => callAdminApi<{ applications: ApplicationItem[] }>('applications.list')
  });
  const applications = appsQuery.data?.applications ?? [];
  const appMap = useMemo(() => {
    const m = new Map<string, ApplicationItem>();
    for (const a of applications) m.set(a.id, a);
    return m;
  }, [applications]);

  // お問い合わせ一覧取得
  const inquiriesQuery = useQuery({
    queryKey: ['inquiries'],
    queryFn: () => callAdminApi<{ inquiries: InquiryItem[] }>('inquiries.list', {})
  });

  const allInquiries = inquiriesQuery.data?.inquiries ?? [];

  // 未対応件数の集計
  const pendingCount = useMemo(() => {
    return allInquiries.filter((i) => i.status === '未対応').length;
  }, [allInquiries]);

  // フィルタリング
  const filteredInquiries = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return allInquiries.filter((item) => {
      if (filterAppId && item.appId !== filterAppId) return false;
      if (filterStatus && item.status !== filterStatus) return false;
      if (kw) {
        const target = `${item.name} ${item.email} ${item.subject} ${item.message} ${item.adminMemo}`.toLowerCase();
        if (!target.includes(kw)) return false;
      }
      return true;
    });
  }, [allInquiries, filterAppId, filterStatus, keyword]);

  const selectedInquiry = useMemo(() => {
    return allInquiries.find((i) => i.id === selectedInquiryId) ?? null;
  }, [allInquiries, selectedInquiryId]);

  const handleSelectInquiry = (item: InquiryItem) => {
    setSelectedInquiryId(item.id);
    setEditStatus(item.status);
    setEditAdminMemo(item.adminMemo || '');
  };

  // 対応状況・管理者メモ保存 Mutation
  const updateInquiryMutation = useMutation({
    mutationFn: async () => {
      if (!selectedInquiry) throw new Error('お問い合わせが選択されていません');
      const parsed = inquiryAdminUpdateSchema.safeParse({
        id: selectedInquiry.id,
        status: editStatus,
        adminMemo: editAdminMemo
      });
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message || '入力内容を確認してください');
      }
      return callAdminApi<InquiryItem>('inquiries.update', parsed.data);
    },
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['inquiries'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      pushToast({
        type: 'success',
        title: '対応状況・管理者メモを保存しました',
        message: `件名「${updated.subject}」 (状態: ${updated.status})`
      });
    },
    onError: (err) => {
      pushToast({
        type: 'error',
        title: '保存に失敗しました',
        message: err instanceof Error ? err.message : '更新エラー'
      });
    }
  });

  const columns = useMemo(
    () => [
      columnHelper.accessor('status', {
        header: '状態',
        cell: (info) => {
          const st = info.getValue();
          return (
            <span className={`inline-block px-2 py-0.5 text-xs rounded border ${INQUIRY_STATUS_BADGE[st]}`}>
              {st}
            </span>
          );
        }
      }),
      columnHelper.accessor('appId', {
        header: 'アプリ',
        cell: (info) => {
          const app = appMap.get(info.getValue());
          return (
            <span className="text-xs font-medium text-slate-700">
              {app ? app.name : info.getValue()}
            </span>
          );
        }
      }),
      columnHelper.accessor('subject', {
        header: '件名 / 送信者',
        cell: (info) => {
          const row = info.row.original;
          return (
            <div>
              <div className="font-semibold text-slate-900 line-clamp-1">{row.subject}</div>
              <div className="text-xs text-slate-500">
                {row.name} &lt;{row.email}&gt;
              </div>
            </div>
          );
        }
      }),
      columnHelper.accessor('createdAt', {
        header: ({ column }) => (
          <button
            type="button"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
            className="flex items-center gap-1 font-semibold text-slate-700 hover:text-slate-900"
          >
            <span>受信日時 (JST)</span>
            <ArrowUpDown className="w-3.5 h-3.5" />
          </button>
        ),
        cell: (info) => (
          <span className="text-xs font-mono text-slate-600">
            {formatDateTimeJst(info.getValue())}
          </span>
        )
      })
    ],
    [appMap]
  );

  const table = useReactTable({
    data: filteredInquiries,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: {
      pagination: {
        pageSize: 15
      }
    }
  });

  // メールアプリ起動用 mailto: URL生成
  const buildMailtoHref = (inquiry: InquiryItem): string => {
    const appName = appMap.get(inquiry.appId)?.name || inquiry.appId;
    const subject = `Re: [${appName}] ${inquiry.subject}`;
    const quotedBody = [
      `${inquiry.name} 様`,
      '',
      'お問い合わせいただきありがとうございます。',
      '',
      '----------------------------------------',
      `受信日時: ${formatDateTimeJst(inquiry.createdAt)}`,
      `件名: ${inquiry.subject}`,
      '',
      inquiry.message
    ].join('\n');
    return `mailto:${encodeURIComponent(inquiry.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(quotedBody)}`;
  };

  return (
    <div className="space-y-4">
      {/* 上部バー：未対応件数・フィルター・検索 */}
      <div className="bg-white border border-slate-200 rounded-md p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <Inbox className="w-4 h-4 text-slate-700" />
            <span>お問い合わせ管理</span>
          </div>

          <span
            className={`inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-semibold rounded border ${
              pendingCount > 0
                ? 'bg-red-50 text-red-800 border-red-300'
                : 'bg-emerald-50 text-emerald-800 border-emerald-300'
            }`}
          >
            <AlertCircle className="w-3.5 h-3.5" />
            <span>未対応: {pendingCount} 件</span>
          </span>

          <select
            value={filterAppId}
            onChange={(e) => setFilterAppId(e.target.value)}
            className="px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white text-slate-900"
          >
            <option value="">すべてのアプリ</option>
            {applications.map((app) => (
              <option key={app.id} value={app.id}>
                {app.name}
              </option>
            ))}
          </select>

          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as '' | InquiryStatus)}
            className="px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white text-slate-900"
          >
            <option value="">すべてのステータス</option>
            <option value="未対応">未対応のみ</option>
            <option value="対応中">対応中のみ</option>
            <option value="完了">完了のみ</option>
          </select>
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="名前・メール・件名・本文・メモで検索..."
            className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-300 rounded bg-white"
          />
        </div>
      </div>

      {/* 左右2ペイン構成（左：一覧テーブル、右：詳細表示＆管理者メモ独立編集） */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* 左ペイン：お問い合わせ一覧 */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-md overflow-hidden flex flex-col">
          {inquiriesQuery.isLoading ? (
            <div className="p-8 text-center text-sm text-slate-600">お問い合わせデータを取得中...</div>
          ) : filteredInquiries.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">該当するお問い合わせはありません。</div>
          ) : (
            <>
              <div className="overflow-x-auto flex-1">
                <table className="w-full border-collapse text-left">
                  <thead>
                    {table.getHeaderGroups().map((hg) => (
                      <tr key={hg.id} className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                        {hg.headers.map((header) => (
                          <th key={header.id} className="py-2.5 px-3 font-semibold">
                            {header.isPlaceholder
                              ? null
                              : flexRender(header.column.columnDef.header, header.getContext())}
                          </th>
                        ))}
                      </tr>
                    ))}
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-sm">
                    {table.getRowModel().rows.map((row) => {
                      const item = row.original;
                      const isSelected = item.id === selectedInquiryId;
                      return (
                        <tr
                          key={row.id}
                          onClick={() => handleSelectInquiry(item)}
                          className={`cursor-pointer transition-colors ${
                            isSelected ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                          }`}
                        >
                          {row.getVisibleCells().map((cell) => (
                            <td key={cell.id} className="py-2.5 px-3 align-middle">
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {table.getPageCount() > 1 && (
                <div className="px-3 py-2 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
                  <span>
                    {table.getState().pagination.pageIndex + 1} / {table.getPageCount()} ページ
                  </span>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => table.previousPage()}
                      disabled={!table.getCanPreviousPage()}
                      className="px-2 py-1 border border-slate-300 rounded bg-white disabled:opacity-40"
                    >
                      前へ
                    </button>
                    <button
                      type="button"
                      onClick={() => table.nextPage()}
                      disabled={!table.getCanNextPage()}
                      className="px-2 py-1 border border-slate-300 rounded bg-white disabled:opacity-40"
                    >
                      次へ
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* 右ペイン：お問い合わせ詳細と対応状況・管理者メモ編集 */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-md p-4">
          {!selectedInquiry ? (
            <div className="h-full min-h-[320px] flex items-center justify-center text-xs text-slate-500">
              左の一覧からお問い合わせを選択すると、ここに全文と管理者メモが表示されます。
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-2 border-b border-slate-200 pb-3">
                <div>
                  <span className="text-xs font-mono text-slate-500">ID: {selectedInquiry.id}</span>
                  <h3 className="text-base font-bold text-slate-900 mt-0.5">{selectedInquiry.subject}</h3>
                </div>
                <a
                  href={buildMailtoHref(selectedInquiry)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-blue-600 text-white rounded hover:bg-blue-700 shrink-0"
                >
                  <Mail className="w-3.5 h-3.5" />
                  <span>メールアプリで返信</span>
                </a>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 bg-slate-50 border border-slate-200 rounded p-3 text-xs">
                <div>
                  <span className="text-slate-500 block">対象アプリ</span>
                  <span className="font-semibold text-slate-900">
                    {appMap.get(selectedInquiry.appId)?.name || selectedInquiry.appId}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">受信日時 (JST)</span>
                  <span className="font-mono text-slate-900">
                    {formatDateTimeJst(selectedInquiry.createdAt)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">送信者氏名</span>
                  <span className="font-semibold text-slate-900">{selectedInquiry.name}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">メールアドレス</span>
                  <span className="font-mono text-slate-900 break-all">{selectedInquiry.email}</span>
                </div>
              </div>

              {/* 問い合わせ本文（HTMLとして無条件描画せず、プレーンテキストとして安全かつ読みやすく表示） */}
              <div>
                <div className="text-xs font-semibold text-slate-700 mb-1">
                  お問い合わせ本文（読み取り専用・プレーンテキスト安全表示）
                </div>
                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded text-sm text-slate-900 whitespace-pre-wrap break-words max-h-72 overflow-y-auto leading-relaxed">
                  {selectedInquiry.message}
                </div>
              </div>

              {/* 対応状況と管理者メモ（本文とは独立して保存） */}
              <div className="pt-3 border-t border-slate-200 space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">対応状況</label>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value as InquiryStatus)}
                    className="w-full sm:w-48 px-3 py-1.5 text-sm font-medium border border-slate-300 rounded bg-white"
                  >
                    <option value="未対応">未対応</option>
                    <option value="対応中">対応中</option>
                    <option value="完了">完了</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    管理者メモ（問い合わせ本文とは独立してInquiriesシートのadminMemo列に保存されます）
                  </label>
                  <textarea
                    rows={4}
                    value={editAdminMemo}
                    onChange={(e) => setEditAdminMemo(e.target.value)}
                    placeholder="調査状況、返信日、再現手順などのメモを記録..."
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded bg-white"
                  />
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={updateInquiryMutation.isPending}
                    onClick={() => updateInquiryMutation.mutate()}
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold bg-slate-900 text-white rounded hover:bg-slate-800 disabled:opacity-50"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>{updateInquiryMutation.isPending ? '保存中...' : '対応状況とメモを保存'}</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
