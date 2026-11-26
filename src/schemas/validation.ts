/**
 * src/schemas/validation.ts
 * Zod によるフロントエンド側の入力値・データ検証スキーマ。
 * GASバックエンド側でも同等の検証を行いますが、送信前に厳密なバリデーションを実施します。
 */

import { z } from 'zod';

export const repositoryInputSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, '表示名は必須です')
    .max(100, '表示名は100文字以内で入力してください'),
  owner: z
    .string()
    .trim()
    .min(1, 'GitHubオーナー名は必須です')
    .max(100, 'GitHubオーナー名は100文字以内で入力してください')
    .regex(
      /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/,
      '有効なGitHubオーナー名（英数字・ハイフン）を入力してください'
    ),
  repo: z
    .string()
    .trim()
    .min(1, 'リポジトリ名は必須です')
    .max(100, 'リポジトリ名は100文字以内で入力してください')
    .regex(/^[a-zA-Z0-9._-]+$/, 'リポジトリ名は英数字・ドット・ハイフン・アンダースコアで入力してください'),
  branch: z
    .string()
    .trim()
    .min(1, 'ブランチ名は必須です')
    .max(100, 'ブランチ名は100文字以内で入力してください'),
  articlesDir: z
    .string()
    .trim()
    .max(200, '記事保存ディレクトリは200文字以内で入力してください')
    .refine((v) => !v.includes('..') && !v.includes('\\'), '不正なパス文字列が含まれています'),
  imagesDir: z
    .string()
    .trim()
    .max(200, '画像保存ディレクトリは200文字以内で入力してください')
    .refine((v) => !v.includes('..') && !v.includes('\\'), '不正なパス文字列が含まれています'),
  markdownExt: z.enum(['.md', '.mdx', '.markdown'], {
    errorMap: () => ({ message: '拡張子は .md / .mdx / .markdown から選択してください' })
  }),
  frontmatterFormat: z.enum(['yaml', 'toml', 'json', 'none'], {
    errorMap: () => ({ message: 'Frontmatter形式を選択してください' })
  }),
  defaultTemplate: z.string().max(10000, 'テンプレートは10,000文字以内で入力してください'),
  siteUrl: z
    .string()
    .trim()
    .max(300, '公開サイトURLは300文字以内で入力してください')
    .refine((v) => v === '' || /^https?:\/\/.+/i.test(v), '公開サイトURLは http:// または https:// から始まる形式で入力してください'),
  articleUrlPattern: z
    .string()
    .trim()
    .max(300, '記事URL生成規則は300文字以内で入力してください'),
  tokenPropertyKey: z
    .string()
    .trim()
    .min(1, 'GitHubトークン参照キーは必須です')
    .regex(
      /^GITHUB_TOKEN_[A-Z0-9_]+$/,
      '参照キーは GITHUB_TOKEN_ で始まる大文字英数字・アンダースコア（例: GITHUB_TOKEN_PORTFOLIO）で指定してください'
    ),
  isActive: z.boolean()
});

export type RepositoryInput = z.infer<typeof repositoryInputSchema>;

export const articleSaveSchema = z.object({
  repositoryId: z.string().trim().min(1, '対象リポジトリが選択されていません'),
  filename: z
    .string()
    .trim()
    .min(1, 'ファイル名は必須です')
    .max(200, 'ファイル名は200文字以内で入力してください')
    .refine(
      (v) => !v.includes('..') && !v.includes('\\') && !/[\x00-\x1f]/.test(v),
      'ファイル名に使用できない文字（.. や \\ など）が含まれています'
    ),
  content: z
    .string()
    .min(1, '記事本文が空です')
    .max(500000, '記事本文が最大サイズ（500,000文字）を超えています'),
  commitMessage: z
    .string()
    .trim()
    .min(1, 'コミットメッセージを入力してください')
    .max(200, 'コミットメッセージは200文字以内で入力してください')
});

export type ArticleSaveInput = z.infer<typeof articleSaveSchema>;

export const noticeInputSchema = z
  .object({
    appId: z.string().trim().min(1, '対象アプリを選択してください'),
    title: z
      .string()
      .trim()
      .min(1, 'タイトルは必須です')
      .max(200, 'タイトルは200文字以内で入力してください'),
    body: z
      .string()
      .trim()
      .min(1, 'お知らせ本文は必須です')
      .max(20000, 'お知らせ本文は20,000文字以内で入力してください'),
    status: z.enum(['draft', 'scheduled', 'published', 'archived']),
    publishedAt: z.string().trim()
  })
  .superRefine((val, ctx) => {
    if (val.status === 'scheduled') {
      if (!val.publishedAt) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['publishedAt'],
          message: '公開予約（scheduled）にする場合は公開予定日時を指定してください'
        });
      } else {
        const dt = new Date(val.publishedAt);
        if (Number.isNaN(dt.getTime())) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['publishedAt'],
            message: '有効な公開予定日時を指定してください'
          });
        }
      }
    }
  });

export type NoticeInput = z.infer<typeof noticeInputSchema>;

export const inquiryAdminUpdateSchema = z.object({
  id: z.string().trim().min(1, 'お問い合わせIDが不正です'),
  status: z.enum(['未対応', '対応中', '完了']),
  adminMemo: z.string().max(5000, '管理者メモは5,000文字以内で入力してください')
});

export type InquiryAdminUpdateInput = z.infer<typeof inquiryAdminUpdateSchema>;

export const applicationInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'アプリ名は必須です')
    .max(100, 'アプリ名は100文字以内で入力してください'),
  bundleId: z
    .string()
    .trim()
    .min(1, 'Bundle ID / 識別子は必須です')
    .max(150, 'Bundle ID / 識別子は150文字以内で入力してください')
    .regex(/^[a-zA-Z0-9._-]+$/, 'Bundle IDは英数字・ドット・ハイフン・アンダースコア（例: com.example.app）で入力してください'),
  appStoreUrl: z
    .string()
    .trim()
    .max(300, 'URLは300文字以内で入力してください')
    .refine((v) => v === '' || /^https?:\/\/.+/i.test(v), 'URLは http:// または https:// から始まる形式で入力してください'),
  isActive: z.boolean()
});

export type ApplicationInput = z.infer<typeof applicationInputSchema>;

export const articleTemplateInputSchema = z.object({
  repositoryId: z.string().trim().max(100),
  name: z
    .string()
    .trim()
    .min(1, 'テンプレート名は必須です')
    .max(100, 'テンプレート名は100文字以内で入力してください'),
  description: z
    .string()
    .trim()
    .max(300, '説明は300文字以内で入力してください'),
  filenamePattern: z
    .string()
    .trim()
    .max(150, 'ファイル名初期パターンは150文字以内で入力してください')
    .refine((v) => !v.includes('..') && !v.includes('\\'), '不正なパス文字列が含まれています'),
  content: z
    .string()
    .min(1, 'テンプレート本文は必須です')
    .max(50000, 'テンプレート本文は50,000文字以内で入力してください'),
  isDefault: z.boolean()
});

export type ArticleTemplateInput = z.infer<typeof articleTemplateInputSchema>;

export const publicConnectionConfigSchema = z.object({
  googleClientId: z
    .string()
    .trim()
    .min(1, 'Google OAuth クライアントIDは必須です')
    .refine((v) => v.endsWith('.apps.googleusercontent.com'), 'Google OAuth クライアントIDは .apps.googleusercontent.com で終わる形式である必要があります'),
  gasDeploymentId: z
    .string()
    .trim()
    .min(10, 'GAS API Executable のデプロイID（またはスクリプトID）を入力してください'),
  gasWebAppUrl: z
    .string()
    .trim()
    .refine((v) => v === '' || /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/i.test(v), '公開WebアプリURLは https://script.google.com/macros/s/.../exec 形式で入力してください')
});
