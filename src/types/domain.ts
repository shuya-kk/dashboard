/**
 * src/types/domain.ts
 * 管理画面全体で利用する厳格なドメイン型定義（TypeScript strict mode）
 */

export type SectionId =
  | 'dashboard'
  | 'articles'
  | 'notices'
  | 'inquiries'
  | 'applications'
  | 'settings';

export type NoticeStatus = 'draft' | 'scheduled' | 'published' | 'archived';

export type InquiryStatus = '未対応' | '対応中' | '完了';

export type FrontmatterFormat = 'yaml' | 'toml' | 'json' | 'none';

export interface ApplicationItem {
  id: string;
  name: string;
  bundleId: string;
  appStoreUrl: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RepositoryConfig {
  id: string;
  displayName: string;
  owner: string;
  repo: string;
  branch: string;
  articlesDir: string;
  imagesDir: string;
  markdownExt: '.md' | '.mdx' | '.markdown';
  frontmatterFormat: FrontmatterFormat;
  defaultTemplate: string;
  siteUrl: string;
  articleUrlPattern: string;
  tokenPropertyKey: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ArticleSummary {
  path: string;
  sha: string;
  size: number;
  slug: string;
  filename: string;
  title: string;
  updatedAt: string;
  githubUrl: string;
  publicUrl: string;
}

export interface ArticleListResponse {
  repositoryId: string;
  repositoryName: string;
  branch: string;
  articlesDir: string;
  truncated: boolean;
  totalCount: number;
  articles: ArticleSummary[];
}

export interface ArticleDetail {
  repositoryId: string;
  path: string;
  name: string;
  sha: string;
  size: number;
  content: string;
  title: string;
  date: string;
  draft: boolean;
  updatedAt: string;
  lastCommitMessage: string;
  githubUrl: string;
  publicUrl: string;
}

export interface ArticleSaveResult {
  repositoryId: string;
  path: string;
  sha: string;
  githubUrl: string;
  publicUrl: string;
  commitSha: string;
}

export interface ShaConflictDetails {
  conflict: true;
  path: string;
  expectedSha: string;
  remoteSha: string;
  remoteContent: string;
}

export interface NoticeItem {
  id: string;
  appId: string;
  title: string;
  body: string;
  createdAt: string;
  publishedAt: string;
  status: NoticeStatus;
  updatedAt: string;
}

export interface InquiryItem {
  id: string;
  appId: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  createdAt: string;
  status: InquiryStatus;
  adminMemo: string;
  updatedAt: string;
}

export interface OperationLogItem {
  id: string;
  timestamp: string;
  actorEmail: string;
  action: string;
  targetType: string;
  targetId: string;
  summary: string;
  status: string;
}

export interface DashboardSummary {
  metrics: {
    applicationsCount: number;
    repositoriesCount: number;
    articlesCount: number;
    noticesCount: number;
    publishedNoticesCount: number;
    pendingInquiriesCount: number;
  };
  repoArticleCounts: Array<{
    repositoryId: string;
    displayName: string;
    count: number;
    error: string | null;
  }>;
  recentInquiries: InquiryItem[];
  recentOperationLogs: OperationLogItem[];
}

export interface SystemSettingsInfo {
  adminEmail: string;
  spreadsheetId: string;
  spreadsheetName: string;
  spreadsheetUrl: string;
  availableTokenKeys: string[];
  oauthClientIdConfigured: boolean;
  scheduledNoticeTriggerActive: boolean;
  timeZone: string;
}

export interface AuthenticatedAdminUser {
  email: string;
  name: string;
  picture: string;
  idToken: string;
  idTokenExp: number;
  accessToken: string;
  accessTokenExpiresAt: number;
}

export interface PublicConnectionConfig {
  googleClientId: string;
  gasDeploymentId: string;
  gasWebAppUrl: string;
}
