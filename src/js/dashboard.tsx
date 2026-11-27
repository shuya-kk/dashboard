/**
 * src/js/dashboard.tsx
 * 品のあるマットな質感と端正な角丸（rounded-xl / rounded-2xl）で文字見切れを防ぎ、
 * Bentoレイアウトで情報をすっきり整理したホーム画面。
 * 下部に「アプリ組み込み用 公開API（お知らせ取得 GET / お問い合わせ送信 POST）実装ガイド」を搭載。
 */

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  RefreshCw,
  ArrowRight,
  AppWindow,
  FolderGit2,
  FileText,
  Bell,
  Inbox,
  Code2,
  Copy,
  Check,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { callAdminApi } from './api';
import { useAppStore } from './store';
import { formatDateTimeJst, getPublicConnectionConfig } from './utils';
import type { ApplicationItem, DashboardSummary } from '../types/domain';

export const DashboardSection: React.FC = () => {
  const { setActiveSection, setSelectedRepositoryId } = useAppStore();

  const [isApiGuideOpen, setIsApiGuideOpen] = useState<boolean>(true);
  const [selectedLang, setSelectedLang] = useState<'swift' | 'ts' | 'curl'>('swift');
  const [selectedAppBundleId, setSelectedAppBundleId] = useState<string>('');
  const [copiedKey, setCopiedKey] = useState<string>('');

  const dashboardQuery = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => callAdminApi<DashboardSummary>('dashboard.get', { forceRefresh: false })
  });

  // アプリ選択ドロップダウン用に登録済みアプリ一覧も取得
  const appsQuery = useQuery({
    queryKey: ['applications'],
    queryFn: () => callAdminApi<{ applications: ApplicationItem[] }>('applications.list')
  });

  const data = dashboardQuery.data;
  const pendingCount = data?.metrics.pendingInquiriesCount ?? 0;
  const applications = appsQuery.data?.applications ?? [];

  const conn = getPublicConnectionConfig();
  const webAppUrl =
    conn.gasWebAppUrl ||
    'https://script.google.com/macros/s/<YOUR_WEBAPP_DEPLOYMENT_ID>/exec';

  const targetAppKey =
    selectedAppBundleId ||
    applications[0]?.bundleId ||
    applications[0]?.id ||
    'com.example.myapp';

  const handleCopy = (key: string, text: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey(''), 2000);
  };

  // 1. お知らせ取得 GET API のコードスニペット生成
  const getNoticeSnippet = (): string => {
    const endpoint = `${webAppUrl}?action=notices&appId=${encodeURIComponent(targetAppKey)}`;
    if (selectedLang === 'swift') {
      return `import Foundation

struct NoticeItem: Decodable, Identifiable {
    let id: String
    let appId: String
    let title: String
    let body: String
    let publishedAt: String
    let updatedAt: String
}

struct NoticesResponse: Decodable {
    let ok: Bool
    let notices: [NoticeItem]?
}

func fetchPublishedNotices() async throws -> [NoticeItem] {
    let urlString = "${endpoint}"
    guard let url = URL(string: urlString) else { return [] }
    let (data, _) = try await URLSession.shared.data(from: url)
    let decoded = try JSONDecoder().decode(NoticesResponse.self, from: data)
    return decoded.notices ?? []
}`;
    }
    if (selectedLang === 'ts') {
      return `// 公開済み (status === "published") のお知らせのみを取得します
const response = await fetch(
  "${endpoint}",
  { method: "GET" }
);
const data = await response.json();

if (data.ok) {
  console.log("公開中のお知らせ一覧:", data.notices);
}`;
    }
    return `curl -L "${endpoint}"`;
  };

  // 2. お問い合わせ登録 POST API のコードスニペット生成
  const getInquiryPostSnippet = (): string => {
    if (selectedLang === 'swift') {
      return `import Foundation

struct InquiryPayload: Encodable {
    let appId: String
    let name: String
    let email: String
    let subject: String
    let message: String
}

struct InquiryResponse: Decodable {
    let ok: Bool
}

func sendInquiry(name: String, email: String, subject: String, message: String) async throws -> Bool {
    guard let url = URL(string: "${webAppUrl}") else { return false }
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")

    let payload = InquiryPayload(
        appId: "${targetAppKey}",
        name: name,
        email: email,
        subject: subject,
        message: message
    )
    request.httpBody = try JSONEncoder().encode(payload)

    let (data, _) = try await URLSession.shared.data(for: request)
    let result = try JSONDecoder().decode(InquiryResponse.self, from: data)
    return result.ok
}`;
    }
    if (selectedLang === 'ts') {
      return `// WebサイトやReact Native等から送信する場合
// ※Content-Typeを text/plain にするとGASのCORSプリフライト(OPTIONS)を回避してそのままJSON送信できます
const response = await fetch("${webAppUrl}", {
  method: "POST",
  headers: {
    "Content-Type": "text/plain;charset=utf-8"
  },
  body: JSON.stringify({
    appId: "${targetAppKey}",
    name: "山田 太郎",
    email: "user@example.com",
    subject: "アプリに関するお問い合わせ",
    message: "お問い合わせ本文をここに入力します。"
  })
});
const result = await response.json();
if (result.ok) {
  console.log("送信完了 ID:", result.data.inquiryId);
}`;
    }
    return `curl -L -X POST "${webAppUrl}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "appId": "${targetAppKey}",
    "name": "山田 太郎",
    "email": "user@example.com",
    "subject": "お問い合わせ件名",
    "message": "お問い合わせ本文です"
  }'`;
  };

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

          {/* 中段：最近のおたより & アクティビティ */}
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

          {/* 下段：アプリ組み込み用 公開API（お知らせGET / お問い合わせPOST）使い方ガイド */}
          <div className="bg-white rounded-2xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setIsApiGuideOpen((prev) => !prev)}
                className="flex items-center gap-2 text-left"
              >
                <span className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                  <Code2 className="w-4 h-4" />
                </span>
                <div>
                  <div className="text-xs sm:text-sm font-bold text-slate-900">
                    アプリ組み込み用 公開API の使い方（お知らせ取得 GET / お問い合わせ送信 POST）
                  </div>
                  <div className="text-[11px] text-slate-500">
                    iOS (Swift) / Web (TypeScript) / cURL のコードをそのままコピーしてアプリに組み込めます
                  </div>
                </div>
                {isApiGuideOpen ? (
                  <ChevronUp className="w-4 h-4 text-slate-400 ml-1" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-slate-400 ml-1" />
                )}
              </button>

              {isApiGuideOpen && (
                <div className="flex flex-wrap items-center gap-2">
                  {/* 対象アプリ切り替え（Bundle IDがコードに自動反映される） */}
                  {applications.length > 0 && (
                    <select
                      value={selectedAppBundleId}
                      onChange={(e) => setSelectedAppBundleId(e.target.value)}
                      className="px-2.5 py-1 text-xs rounded-lg"
                      title="コード例に埋め込むアプリを選択"
                    >
                      {applications.map((app) => (
                        <option key={app.id} value={app.bundleId || app.id}>
                          {app.name} ({app.bundleId})
                        </option>
                      ))}
                    </select>
                  )}

                  {/* 言語切り替えタブ */}
                  <div className="inline-flex items-center bg-slate-100 p-1 rounded-lg text-xs">
                    {(
                      [
                        { id: 'swift', label: 'Swift (iOS)' },
                        { id: 'ts', label: 'TypeScript / Web' },
                        { id: 'curl', label: 'cURL' }
                      ] as const
                    ).map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setSelectedLang(tab.id)}
                        className={`px-2.5 py-1 rounded-md font-medium ${
                          selectedLang === tab.id
                            ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {isApiGuideOpen && (
              <div className="space-y-4 pt-1">
                {/* 公開Webアプリエンドポイント表示 */}
                <div className="p-3 rounded-xl bg-slate-50 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="min-w-0 flex-1">
                    <span className="text-slate-500 font-medium mr-2">公開APIエンドポイント:</span>
                    <code className="font-mono text-slate-800 break-all">{webAppUrl}</code>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCopy('endpoint', webAppUrl)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 rounded-lg shadow-2xs shrink-0"
                  >
                    {copiedKey === 'endpoint' ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        <span>コピー済</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>URLをコピー</span>
                      </>
                    )}
                  </button>
                </div>

                {/* 2カラム：左＝お知らせGET API、右＝お問い合わせPOST API */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* 1. お知らせ取得 GET API */}
                  <div className="p-4 rounded-xl bg-slate-50 space-y-2.5 flex flex-col">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 text-[11px] font-mono font-bold bg-emerald-100 text-emerald-800 rounded-md">
                          GET
                        </span>
                        <span className="text-xs font-bold text-slate-900">
                          1. 公開済みお知らせ一覧の取得
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCopy('get-code', getNoticeSnippet())}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs bg-white hover:bg-slate-100 text-slate-700 rounded-lg shadow-2xs"
                      >
                        {copiedKey === 'get-code' ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-600" />
                            <span>コピー済</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>コードをコピー</span>
                          </>
                        )}
                      </button>
                    </div>
                    <p className="text-[11px] text-slate-600 leading-relaxed">
                      クエリパラメータ <code>?action=notices&amp;appId={targetAppKey}</code> を付けてGETリクエストすると、そのアプリの <strong>公開中（<code>published</code>）のお知らせのみ</strong> が新しい順で返ります（下書きや予約中は返りません）。
                    </p>
                    <pre className="p-3 rounded-xl bg-slate-900 text-slate-100 font-mono text-[11.5px] overflow-x-auto leading-relaxed flex-1">
                      <code>{getNoticeSnippet()}</code>
                    </pre>
                  </div>

                  {/* 2. お問い合わせ送信 POST API */}
                  <div className="p-4 rounded-xl bg-slate-50 space-y-2.5 flex flex-col">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 text-[11px] font-mono font-bold bg-blue-100 text-blue-800 rounded-md">
                          POST
                        </span>
                        <span className="text-xs font-bold text-slate-900">
                          2. お問い合わせの新規送信
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCopy('post-code', getInquiryPostSnippet())}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs bg-white hover:bg-slate-100 text-slate-700 rounded-lg shadow-2xs"
                      >
                        {copiedKey === 'post-code' ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-600" />
                            <span>コピー済</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>コードをコピー</span>
                          </>
                        )}
                      </button>
                    </div>
                    <p className="text-[11px] text-slate-600 leading-relaxed">
                      JSONで <code>appId</code>（Bundle IDまたはApp ID）, <code>name</code>, <code>email</code>, <code>subject</code>, <code>message</code> をPOSTすると、サーバー側で検証・スパム防止チェック後に「おたより（Inquiries）」へ保存されます。
                    </p>
                    <pre className="p-3 rounded-xl bg-slate-900 text-slate-100 font-mono text-[11.5px] overflow-x-auto leading-relaxed flex-1">
                      <code>{getInquiryPostSnippet()}</code>
                    </pre>
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
