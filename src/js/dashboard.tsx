/**
 * src/js/dashboard.tsx
 * 品のあるマットな質感と端正な角丸（rounded-xl / rounded-2xl）で文字見切れを防ぎ、
 * Bentoレイアウトで情報をすっきり整理したホーム画面。
 */

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  RefreshCw,
  ArrowRight,
  AppWindow,
  FolderGit2,
  FileText,
  Bell,
  Inbox
} from 'lucide-react';
import { callAdminApi } from './api';
import { useAppStore } from './store';
import { formatDateTimeJst } from './utils';
import type { DashboardSummary } from '../types/domain';

export const DashboardSection: React.FC = () => {
  const { setActiveSection, setSelectedRepositoryId } = useAppStore();

  const dashboardQuery = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => callAdminApi<DashboardSummary>('dashboard.get', { forceRefresh: false })
  });

  const data = dashboardQuery.data;
  const pendingCount = data?.metrics.pendingInquiriesCount ?? 0;

  return (
    <div className="space-y-4">
      {dashboardQuery.isLoading ? (
        <div className="bg-white rounded-2xl p-10 text-center text-sm text-slate-500">
          データを読み込んでいます...
        </div>
      ) : dashboardQuery.isError ? (
        <div className="bg-red-50 rounded-2xl p-5 text-sm text-red-800 space-y-2">
          <div className="font-bold">データの取得に失敗しました</div>
          <div>
            {dashboardQuery.error instanceof Error
              ? dashboardQuery.error.message
              : '通信エラーが発生しました'}
          </div>
          <button
            type="button"
            onClick={() => dashboardQuery.refetch()}
            className="px-4 py-1.5 text-xs font-semibold bg-red-600 text-white rounded-lg"
          >
            再試行
          </button>
        </div>
      ) : (
        <>
          {/* 上段：主役2カード + 資産サマリー */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <button
                type="button"
                onClick={() => setActiveSection('inquiries')}
                className={`text-left rounded-2xl p-5 transition-colors flex flex-col justify-between min-h-[136px] ${
                  pendingCount > 0
                    ? 'bg-blue-50 hover:bg-blue-100/70'
                    : 'bg-white hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="w-9 h-9 rounded-lg bg-white flex items-center justify-center shadow-2xs">
                    <Inbox className="w-4 h-4 text-blue-600" />
                  </span>
                  <ArrowRight className="w-4 h-4 text-slate-400" />
                </div>
                <div className="mt-4">
                  <div className="text-xs font-medium text-slate-600">未対応のおたより</div>
                  <div
                    className={`text-3xl font-bold font-mono mt-0.5 ${
                      pendingCount > 0 ? 'text-blue-700' : 'text-slate-900'
                    }`}
                  >
                    {pendingCount}
                    <span className="text-xs font-normal text-slate-500 ml-1">件</span>
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setActiveSection('notices')}
                className="text-left bg-white hover:bg-slate-50 rounded-2xl p-5 transition-colors flex flex-col justify-between min-h-[136px]"
              >
                <div className="flex items-center justify-between">
                  <span className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center">
                    <Bell className="w-4 h-4 text-amber-700" />
                  </span>
                  <span className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">
                    全 {data?.metrics.noticesCount ?? 0} 件
                  </span>
                </div>
                <div className="mt-4">
                  <div className="text-xs font-medium text-slate-600">公開中のお知らせ</div>
                  <div className="text-3xl font-bold font-mono text-slate-900 mt-0.5">
                    {data?.metrics.publishedNoticesCount ?? 0}
                    <span className="text-xs font-normal text-slate-500 ml-1">件</span>
                  </div>
                </div>
              </button>
            </div>

            <div className="lg:col-span-6 bg-white rounded-2xl p-5 flex flex-col justify-between">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold text-slate-700">ワークスペース</span>
                <button
                  type="button"
                  disabled={dashboardQuery.isFetching}
                  onClick={() => dashboardQuery.refetch()}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg disabled:opacity-50"
                >
                  <RefreshCw className={`w-3 h-3 ${dashboardQuery.isFetching ? 'animate-spin' : ''}`} />
                  <span>更新</span>
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2.5">
                <button
                  type="button"
                  onClick={() => setActiveSection('articles')}
                  className="p-3 rounded-xl bg-slate-50 hover:bg-slate-100 text-left transition-colors"
                >
                  <FileText className="w-4 h-4 text-blue-600 mb-1.5" />
                  <div className="text-xl font-bold font-mono text-slate-900">
                    {data?.metrics.articlesCount ?? 0}
                  </div>
                  <div className="text-[11px] text-slate-500 truncate">記事ノート</div>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveSection('applications')}
                  className="p-3 rounded-xl bg-slate-50 hover:bg-slate-100 text-left transition-colors"
                >
                  <AppWindow className="w-4 h-4 text-emerald-700 mb-1.5" />
                  <div className="text-xl font-bold font-mono text-slate-900">
                    {data?.metrics.applicationsCount ?? 0}
                  </div>
                  <div className="text-[11px] text-slate-500 truncate">マイアプリ</div>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveSection('settings')}
                  className="p-3 rounded-xl bg-slate-50 hover:bg-slate-100 text-left transition-colors"
                >
                  <FolderGit2 className="w-4 h-4 text-slate-600 mb-1.5" />
                  <div className="text-xl font-bold font-mono text-slate-900">
                    {data?.metrics.repositoriesCount ?? 0}
                  </div>
                  <div className="text-[11px] text-slate-500 truncate">リポジトリ</div>
                </button>
              </div>
            </div>
          </div>

          {/* リポジトリ別ショートカット */}
          {data && data.repoArticleCounts.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {data.repoArticleCounts.map((rc) => (
                <button
                  key={rc.repositoryId}
                  type="button"
                  onClick={() => {
                    setSelectedRepositoryId(rc.repositoryId);
                    setActiveSection('articles');
                  }}
                  className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white hover:bg-slate-50 text-xs shadow-2xs transition-colors"
                >
                  <FolderGit2 className="w-3.5 h-3.5 text-blue-600" />
                  <span className="font-semibold text-slate-800">{rc.displayName}</span>
                  <span className="px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-700 font-mono font-bold text-[11px]">
                    {rc.count}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* 下段：おたより & 操作履歴 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white rounded-2xl p-5 flex flex-col">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-bold text-slate-800">最近のおたより</h3>
                <button
                  type="button"
                  onClick={() => setActiveSection('inquiries')}
                  className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline font-medium"
                >
                  <span>すべて見る</span>
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>
              {!data || data.recentInquiries.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-400">
                  まだおたよりはありません
                </div>
              ) : (
                <div className="space-y-1.5 text-xs">
                  {data.recentInquiries.map((inq) => (
                    <div
                      key={inq.id}
                      onClick={() => setActiveSection('inquiries')}
                      className="p-2.5 rounded-xl hover:bg-slate-50 cursor-pointer transition-colors flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-900 truncate">{inq.subject}</div>
                        <div className="text-[11px] text-slate-500 truncate mt-0.5">
                          {inq.name} ・ {formatDateTimeJst(inq.createdAt)}
                        </div>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded-md text-[11px] font-medium shrink-0 ${
                          inq.status === '未対応'
                            ? 'bg-red-50 text-red-700'
                            : inq.status === '対応中'
                            ? 'bg-amber-50 text-amber-700'
                            : 'bg-emerald-50 text-emerald-700'
                        }`}
                      >
                        {inq.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white rounded-2xl p-5 flex flex-col">
              <h3 className="text-xs font-bold text-slate-800 mb-3">最近のアクティビティ</h3>
              {!data || data.recentOperationLogs.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-400">
                  履歴はまだありません
                </div>
              ) : (
                <div className="space-y-3 text-xs pl-1">
                  {data.recentOperationLogs.slice(0, 5).map((log) => (
                    <div key={log.id} className="flex items-start gap-2.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="text-slate-800 font-medium">{log.summary}</div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          {formatDateTimeJst(log.timestamp)}
                        </div>
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
