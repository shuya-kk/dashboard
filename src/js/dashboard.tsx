/**
 * src/js/dashboard.tsx
 * 革新的な非対称 Bento（ベントー）レイアウトのホーム画面。
 * 均等な四角いカードが並ぶだけの退屈な管理画面から脱却し、
 * 主役ウィジェット＋パステルグラスタイル＋ドットタイムラインで視覚的に整理しています。
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
        <div className="bg-white/75 backdrop-blur-xl rounded-3xl p-12 text-center text-sm text-slate-500">
          データを読み込んでいます...
        </div>
      ) : dashboardQuery.isError ? (
        <div className="bg-red-50 rounded-3xl p-6 text-sm text-red-800 space-y-2">
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
          {/* Bento Grid 上段：非対称ヒーローウィジェット＋3連コンパクトタイル */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* 左ヒーロータイル（おたより＋公開中お知らせ） */}
            <div className="lg:col-span-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <button
                type="button"
                onClick={() => setActiveSection('inquiries')}
                className="text-left rounded-3xl p-5 transition-transform hover:-translate-y-1 flex flex-col justify-between min-h-[144px] shadow-sm"
                style={{
                  background:
                    pendingCount > 0
                      ? 'linear-gradient(135deg, rgba(255, 224, 238, 0.92), rgba(255, 240, 246, 0.85))'
                      : 'linear-gradient(135deg, rgba(224, 242, 254, 0.9), rgba(240, 249, 255, 0.85))'
                }}
              >
                <div className="flex items-center justify-between">
                  <span className="w-10 h-10 rounded-2xl bg-white/85 flex items-center justify-center shadow-2xs text-slate-800">
                    <Inbox className="w-5 h-5 text-blue-600" />
                  </span>
                  <ArrowRight className="w-4 h-4 text-slate-500" />
                </div>
                <div className="mt-4">
                  <div className="text-xs font-semibold text-slate-600">未対応のおたより</div>
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
                className="text-left rounded-3xl p-5 transition-transform hover:-translate-y-1 flex flex-col justify-between min-h-[144px] shadow-sm"
                style={{
                  background: 'linear-gradient(135deg, rgba(254, 243, 199, 0.88), rgba(255, 251, 235, 0.85))'
                }}
              >
                <div className="flex items-center justify-between">
                  <span className="w-10 h-10 rounded-2xl bg-white/85 flex items-center justify-center shadow-2xs">
                    <Bell className="w-5 h-5 text-amber-600" />
                  </span>
                  <span className="text-[11px] font-medium px-2.5 py-0.5 rounded-full bg-white/80 text-slate-600">
                    全 {data?.metrics.noticesCount ?? 0} 件
                  </span>
                </div>
                <div className="mt-4">
                  <div className="text-xs font-semibold text-slate-600">公開中のお知らせ</div>
                  <div className="text-3xl font-bold font-mono text-slate-900 mt-0.5">
                    {data?.metrics.publishedNoticesCount ?? 0}
                    <span className="text-xs font-normal text-slate-500 ml-1">件</span>
                  </div>
                </div>
              </button>
            </div>

            {/* 右コンパクトBento：記事数・マイアプリ・リポジトリ＋更新 */}
            <div className="lg:col-span-6 bg-white/75 backdrop-blur-xl rounded-3xl p-5 flex flex-col justify-between shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold text-slate-700">アトリエの資産</span>
                <button
                  type="button"
                  disabled={dashboardQuery.isFetching}
                  onClick={() => dashboardQuery.refetch()}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-slate-600 bg-white/80 hover:bg-white rounded-full shadow-2xs disabled:opacity-50"
                >
                  <RefreshCw className={`w-3 h-3 ${dashboardQuery.isFetching ? 'animate-spin' : ''}`} />
                  <span>更新</span>
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2.5">
                <button
                  type="button"
                  onClick={() => setActiveSection('articles')}
                  className="p-3 rounded-2xl bg-slate-50 hover:bg-white text-left transition-all"
                >
                  <FileText className="w-4 h-4 text-purple-600 mb-1.5" />
                  <div className="text-xl font-bold font-mono text-slate-900">
                    {data?.metrics.articlesCount ?? 0}
                  </div>
                  <div className="text-[11px] text-slate-500 truncate">記事ノート</div>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveSection('applications')}
                  className="p-3 rounded-2xl bg-slate-50 hover:bg-white text-left transition-all"
                >
                  <AppWindow className="w-4 h-4 text-emerald-600 mb-1.5" />
                  <div className="text-xl font-bold font-mono text-slate-900">
                    {data?.metrics.applicationsCount ?? 0}
                  </div>
                  <div className="text-[11px] text-slate-500 truncate">マイアプリ</div>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveSection('settings')}
                  className="p-3 rounded-2xl bg-slate-50 hover:bg-white text-left transition-all"
                >
                  <FolderGit2 className="w-4 h-4 text-blue-600 mb-1.5" />
                  <div className="text-xl font-bold font-mono text-slate-900">
                    {data?.metrics.repositoriesCount ?? 0}
                  </div>
                  <div className="text-[11px] text-slate-500 truncate">リポジトリ</div>
                </button>
              </div>
            </div>
          </div>

          {/* リポジトリ別ショートカットピル */}
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
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/75 hover:bg-white text-xs shadow-2xs transition-all"
                >
                  <FolderGit2 className="w-3.5 h-3.5 text-blue-600" />
                  <span className="font-semibold text-slate-800">{rc.displayName}</span>
                  <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-mono font-bold text-[11px]">
                    {rc.count}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* 下段：おたより & 操作タイムライン */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white/75 backdrop-blur-xl rounded-3xl p-5 shadow-sm flex flex-col">
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
                <div className="space-y-2 text-xs">
                  {data.recentInquiries.map((inq) => (
                    <div
                      key={inq.id}
                      onClick={() => setActiveSection('inquiries')}
                      className="p-3 rounded-2xl bg-white/60 hover:bg-white cursor-pointer transition-colors flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-900 truncate">{inq.subject}</div>
                        <div className="text-[11px] text-slate-500 truncate mt-0.5">
                          {inq.name} ・ {formatDateTimeJst(inq.createdAt)}
                        </div>
                      </div>
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium shrink-0 ${
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

            <div className="bg-white/75 backdrop-blur-xl rounded-3xl p-5 shadow-sm flex flex-col">
              <h3 className="text-xs font-bold text-slate-800 mb-3">最近のアクティビティ</h3>
              {!data || data.recentOperationLogs.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-400">
                  履歴はまだありません
                </div>
              ) : (
                <div className="space-y-3 text-xs pl-2">
                  {data.recentOperationLogs.slice(0, 5).map((log) => (
                    <div key={log.id} className="flex items-start gap-3">
                      <span className="w-2 h-2 rounded-full bg-blue-400 mt-1.5 shrink-0" />
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
