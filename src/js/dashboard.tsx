/**
 * src/js/dashboard.tsx
 * 情報量を整理し、ひと目で全体の状況がわかるスッキリしたホーム画面。
 */

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  RefreshCw,
  ArrowRight,
  AlertCircle,
  AppWindow,
  FolderGit2,
  FileText,
  Bell,
  CheckCircle2,
  Inbox
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
    targetSection: SectionId;
    icon: React.ComponentType<{ className?: string }>;
    iconBg: string;
    highlightWarn?: boolean;
  }> = [
    {
      label: '未対応のおたより',
      value: data?.metrics.pendingInquiriesCount ?? 0,
      targetSection: 'inquiries',
      icon: Inbox,
      iconBg: (data?.metrics.pendingInquiriesCount ?? 0) > 0 ? 'bg-red-100 text-red-600' : 'bg-sky-100 text-sky-600',
      highlightWarn: (data?.metrics.pendingInquiriesCount ?? 0) > 0
    },
    {
      label: '公開中のお知らせ',
      value: data?.metrics.publishedNoticesCount ?? 0,
      targetSection: 'notices',
      icon: CheckCircle2,
      iconBg: 'bg-emerald-100 text-emerald-700'
    },
    {
      label: '記事ノート総数',
      value: data?.metrics.articlesCount ?? 0,
      targetSection: 'articles',
      icon: FileText,
      iconBg: 'bg-indigo-100 text-indigo-600'
    },
    {
      label: 'マイアプリ数',
      value: data?.metrics.applicationsCount ?? 0,
      targetSection: 'applications',
      icon: AppWindow,
      iconBg: 'bg-amber-100 text-amber-700'
    },
    {
      label: 'お知らせ総数',
      value: data?.metrics.noticesCount ?? 0,
      targetSection: 'notices',
      icon: Bell,
      iconBg: 'bg-amber-50 text-amber-600'
    },
    {
      label: '登録リポジトリ',
      value: data?.metrics.repositoriesCount ?? 0,
      targetSection: 'settings',
      icon: FolderGit2,
      iconBg: 'bg-blue-100 text-blue-600'
    }
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-end">
        <button
          type="button"
          disabled={dashboardQuery.isFetching}
          onClick={() => dashboardQuery.refetch()}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-slate-600 bg-white rounded-full shadow-2xs hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${dashboardQuery.isFetching ? 'animate-spin' : ''}`} />
          <span>再集計</span>
        </button>
      </div>

      {dashboardQuery.isLoading ? (
        <div className="bg-white rounded-3xl p-10 text-center text-sm text-slate-500 shadow-xs">
          データを読み込んでいます...
        </div>
      ) : dashboardQuery.isError ? (
        <div className="bg-red-50 rounded-3xl p-5 text-sm text-red-800 space-y-2">
          <div className="font-bold">データの取得に失敗しました</div>
          <div>
            {dashboardQuery.error instanceof Error
              ? dashboardQuery.error.message
              : '通信エラーが発生しました'}
          </div>
          <button
            type="button"
            onClick={() => dashboardQuery.refetch()}
            className="px-4 py-1.5 text-xs font-semibold bg-red-600 text-white rounded-full"
          >
            再試行
          </button>
        </div>
      ) : (
        <>
          {/* すっきりした6つの指標カード */}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3.5">
            {metricItems.map((m) => {
              const Icon = m.icon;
              return (
                <button
                  key={m.label}
                  type="button"
                  onClick={() => setActiveSection(m.targetSection)}
                  className="text-left bg-white rounded-3xl p-4 sm:p-5 transition-transform hover:-translate-y-0.5 shadow-xs flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-slate-500 truncate">{m.label}</div>
                    <div
                      className={`text-2xl sm:text-3xl font-bold font-mono mt-1 ${
                        m.highlightWarn ? 'text-red-600' : 'text-slate-900'
                      }`}
                    >
                      {m.value.toLocaleString()}
                    </div>
                  </div>
                  <div className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${m.iconBg}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                </button>
              );
            })}
          </div>

          {/* リポジトリ別記事数（すっきり表示） */}
          {data && data.repoArticleCounts.length > 0 && (
            <div className="bg-white rounded-3xl p-4 sm:p-5 shadow-xs">
              <div className="text-xs font-bold text-slate-700 mb-3">
                リポジトリ別の記事数
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                {data.repoArticleCounts.map((rc) => (
                  <button
                    key={rc.repositoryId}
                    type="button"
                    onClick={() => {
                      setSelectedRepositoryId(rc.repositoryId);
                      setActiveSection('articles');
                    }}
                    className="p-3 bg-slate-50 hover:bg-blue-50/60 rounded-2xl flex items-center justify-between text-left transition-colors"
                  >
                    <div className="min-w-0 pr-2">
                      <div className="text-xs font-semibold text-slate-800 truncate">
                        {rc.displayName}
                      </div>
                      {rc.error && (
                        <span className="text-[11px] text-red-600 flex items-center gap-1 mt-0.5">
                          <AlertCircle className="w-3 h-3 shrink-0" />
                          <span className="truncate">{rc.error}</span>
                        </span>
                      )}
                    </div>
                    <span className="text-sm font-bold font-mono text-slate-900 shrink-0">
                      {rc.count}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 下段2カラム：最近のおたより & 最近のアクティビティ */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white rounded-3xl overflow-hidden shadow-xs flex flex-col">
              <div className="px-5 py-3.5 flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-800">最近のおたより</h3>
                <button
                  type="button"
                  onClick={() => setActiveSection('inquiries')}
                  className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline font-medium"
                >
                  <span>すべて</span>
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>
              {!data || data.recentInquiries.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-400">
                  まだおたよりはありません
                </div>
              ) : (
                <div className="divide-y divide-slate-100 text-xs px-2 pb-2">
                  {data.recentInquiries.map((inq) => (
                    <div key={inq.id} className="p-3 rounded-2xl hover:bg-slate-50 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
                            inq.status === '未対応'
                              ? 'bg-red-50 text-red-700'
                              : inq.status === '対応中'
                              ? 'bg-amber-50 text-amber-700'
                              : 'bg-emerald-50 text-emerald-700'
                          }`}
                        >
                          {inq.status}
                        </span>
                        <span className="text-slate-400">
                          {formatDateTimeJst(inq.createdAt)}
                        </span>
                      </div>
                      <div className="font-semibold text-slate-900 truncate">{inq.subject}</div>
                      <div className="text-slate-500 truncate">{inq.name}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white rounded-3xl overflow-hidden shadow-xs flex flex-col">
              <div className="px-5 py-3.5">
                <h3 className="text-xs font-bold text-slate-800">最近の操作</h3>
              </div>
              {!data || data.recentOperationLogs.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-400">
                  操作履歴はまだありません
                </div>
              ) : (
                <div className="divide-y divide-slate-100 text-xs max-h-80 overflow-y-auto px-2 pb-2">
                  {data.recentOperationLogs.slice(0, 6).map((log) => (
                    <div key={log.id} className="p-3 space-y-0.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-800 font-medium">{log.summary}</span>
                        <span className="text-[11px] text-slate-400 shrink-0">
                          {formatDateTimeJst(log.timestamp)}
                        </span>
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
