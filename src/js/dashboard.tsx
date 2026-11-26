/**
 * src/js/dashboard.tsx
 * 全体状況を表示するダッシュボード（Dashboard）。
 *
 * 以下の全数値をGAS・Google Sheets・GitHub APIの実データから取得して表示します：
 * - 管理対象アプリ数
 * - 登録リポジトリ数
 * - 記事数（リポジトリ別の内訳付き）
 * - お知らせ数
 * - 公開中のお知らせ数
 * - 未対応お問い合わせ数
 * - 最近のお問い合わせ
 * - 最近の操作履歴 (OperationLogs)
 */

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  RefreshCw,
  ArrowRight,
  AlertCircle
} from 'lucide-react';
import { callAdminApi } from './api';
import { useAppStore } from './store';
import { formatDateTimeJst } from './utils';
import type { DashboardSummary, SectionId } from '../types/domain';

export const DashboardSection: React.FC = () => {
  const { setActiveSection, setSelectedRepositoryId } = useAppStore();

  const dashboardQuery = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => callAdminApi<DashboardSummary>('dashboard.get', { forceRefresh: false })
  });

  const data = dashboardQuery.data;

  const metricItems: Array<{
    label: string;
    value: number;
    subtext: string;
    targetSection: SectionId;
    highlightWarn?: boolean;
  }> = [
    {
      label: '管理対象アプリ数',
      value: data?.metrics.applicationsCount ?? 0,
      subtext: 'Applications シート登録数',
      targetSection: 'applications'
    },
    {
      label: '登録リポジトリ数',
      value: data?.metrics.repositoriesCount ?? 0,
      subtext: 'Repositories シート登録数',
      targetSection: 'settings'
    },
    {
      label: 'GitHub 記事総数',
      value: data?.metrics.articlesCount ?? 0,
      subtext: '有効リポジトリのMarkdown合計',
      targetSection: 'articles'
    },
    {
      label: 'お知らせ総数',
      value: data?.metrics.noticesCount ?? 0,
      subtext: 'Notices シート全ステータス合計',
      targetSection: 'notices'
    },
    {
      label: '公開中のお知らせ数',
      value: data?.metrics.publishedNoticesCount ?? 0,
      subtext: 'status = published（公開API配信中）',
      targetSection: 'notices'
    },
    {
      label: '未対応お問い合わせ数',
      value: data?.metrics.pendingInquiriesCount ?? 0,
      subtext: 'status = 未対応',
      targetSection: 'inquiries',
      highlightWarn: (data?.metrics.pendingInquiriesCount ?? 0) > 0
    }
  ];

  return (
    <div className="space-y-5">
      {/* ヘッダー */}
      <div className="bg-white border border-slate-200 rounded-md p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-slate-900">システム全体状況 (Dashboard)</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Google Sheets（Applications / Repositories / Notices / Inquiries / OperationLogs）および GitHub REST API から取得した実データを表示しています。
          </p>
        </div>
        <button
          type="button"
          disabled={dashboardQuery.isFetching}
          onClick={() => dashboardQuery.refetch()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${dashboardQuery.isFetching ? 'animate-spin' : ''}`} />
          <span>最新データを再集計</span>
        </button>
      </div>

      {dashboardQuery.isLoading ? (
        <div className="bg-white border border-slate-200 rounded-md p-8 text-center text-sm text-slate-600">
          Google Sheets と GitHub API から最新の集計データを読み込んでいます...
        </div>
      ) : dashboardQuery.isError ? (
        <div className="bg-red-50 border border-red-200 rounded-md p-5 text-sm text-red-800 space-y-2">
          <div className="font-bold">ダッシュボードデータの取得に失敗しました</div>
          <div>
            {dashboardQuery.error instanceof Error
              ? dashboardQuery.error.message
              : 'GAS APIとの通信エラーが発生しました'}
          </div>
          <button
            type="button"
            onClick={() => dashboardQuery.refetch()}
            className="px-3 py-1.5 text-xs font-semibold bg-red-800 text-white rounded"
          >
            再試行する
          </button>
        </div>
      ) : (
        <>
          {/* 6つの主要指標グリッド */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {metricItems.map((m) => (
              <button
                key={m.label}
                type="button"
                onClick={() => setActiveSection(m.targetSection)}
                className={`text-left bg-white border rounded-md p-4 transition-colors hover:bg-slate-50 flex flex-col justify-between ${
                  m.highlightWarn ? 'border-red-300' : 'border-slate-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-600">{m.label}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                </div>
                <div
                  className={`text-2xl font-bold font-mono my-2 ${
                    m.highlightWarn ? 'text-red-700' : 'text-slate-900'
                  }`}
                >
                  {m.value.toLocaleString()}
                </div>
                <div className="text-xs text-slate-500">{m.subtext}</div>
              </button>
            ))}
          </div>

          {/* リポジトリ別記事数内訳 */}
          {data && data.repoArticleCounts.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-md p-4">
              <div className="text-xs font-bold text-slate-800 mb-2.5">
                GitHubリポジトリ別の記事数内訳
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                {data.repoArticleCounts.map((rc) => (
                  <div
                    key={rc.repositoryId}
                    className="p-3 bg-slate-50 border border-slate-200 rounded flex items-center justify-between"
                  >
                    <div className="min-w-0 pr-2">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedRepositoryId(rc.repositoryId);
                          setActiveSection('articles');
                        }}
                        className="text-xs font-semibold text-slate-900 hover:text-blue-600 truncate block"
                      >
                        {rc.displayName}
                      </button>
                      {rc.error && (
                        <span className="text-[11px] text-red-600 flex items-center gap-1 mt-0.5">
                          <AlertCircle className="w-3 h-3 shrink-0" />
                          <span className="truncate">{rc.error}</span>
                        </span>
                      )}
                    </div>
                    <span className="text-sm font-bold font-mono text-slate-900 shrink-0">
                      {rc.count} 件
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 下段2カラム：最近のお問い合わせ & 最近の操作履歴 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* 最近のお問い合わせ */}
            <div className="bg-white border border-slate-200 rounded-md overflow-hidden flex flex-col">
              <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-800">最近のお問い合わせ（最新5件）</h3>
                <button
                  type="button"
                  onClick={() => setActiveSection('inquiries')}
                  className="text-xs text-blue-600 hover:underline font-medium"
                >
                  すべて見る
                </button>
              </div>
              {!data || data.recentInquiries.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500">
                  お問い合わせはまだありません。
                </div>
              ) : (
                <div className="divide-y divide-slate-200 text-xs">
                  {data.recentInquiries.map((inq) => (
                    <div key={inq.id} className="p-3.5 hover:bg-slate-50 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`px-2 py-0.5 rounded border text-[11px] font-medium ${
                            inq.status === '未対応'
                              ? 'bg-red-50 text-red-800 border-red-300'
                              : inq.status === '対応中'
                              ? 'bg-amber-50 text-amber-800 border-amber-300'
                              : 'bg-emerald-50 text-emerald-800 border-emerald-300'
                          }`}
                        >
                          {inq.status}
                        </span>
                        <span className="font-mono text-slate-500">
                          {formatDateTimeJst(inq.createdAt)}
                        </span>
                      </div>
                      <div className="font-semibold text-slate-900">{inq.subject}</div>
                      <div className="text-slate-600">
                        送信者: {inq.name} ({inq.email})
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 最近の操作履歴 (OperationLogs) */}
            <div className="bg-white border border-slate-200 rounded-md overflow-hidden flex flex-col">
              <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-800">
                  最近の操作履歴 (OperationLogs・最新10件)
                </h3>
              </div>
              {!data || data.recentOperationLogs.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500">
                  記録された操作履歴はまだありません。
                </div>
              ) : (
                <div className="divide-y divide-slate-200 text-xs max-h-96 overflow-y-auto">
                  {data.recentOperationLogs.map((log) => (
                    <div key={log.id} className="p-3 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono font-semibold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">
                          {log.action}
                        </span>
                        <span className="font-mono text-slate-500">
                          {formatDateTimeJst(log.timestamp)}
                        </span>
                      </div>
                      <div className="text-slate-900">{log.summary}</div>
                      <div className="text-[11px] text-slate-500 font-mono">
                        target: {log.targetType} ({log.targetId}) / actor: {log.actorEmail}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
