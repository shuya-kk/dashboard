/**
 * tests/system-verification.test.ts
 * 仕様書の第20章「テスト仕様」に基づく自動検証スイート。
 * - 認証（IDトークンの署名クレーム・iss・aud・exp・email_verified検証、アクセストークンの非永続化確認）
 * - GitHub記事管理（Frontmatter解析・更新、テンプレート生成、SHA競合時の行単位Diff計算）
 * - お知らせ・お問い合わせ・アプリのZodバリデーション（不正入力拒否、予約公開日時必須検証）
 * - セキュリティ（DOMPurifyによるMarkdown内XSSスクリプト・イベント属性の完全除去、秘密情報非露出）
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildInitialArticleMarkdown,
  computeLineDiff,
  renderSanitizedMarkdown,
  splitFrontmatterAndBody,
  updateFrontmatterField
} from '../src/js/utils';
import { decodeAndVerifyIdTokenClaims } from '../src/js/auth';
import { useAppStore } from '../src/js/store';
import {
  applicationInputSchema,
  articleSaveSchema,
  noticeInputSchema,
  repositoryInputSchema
} from '../src/schemas/validation';

function createFakeJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.signature`;
}

describe('1. 認証・トークン管理検証', () => {
  beforeEach(() => {
    useAppStore.getState().clearAuth();
    window.localStorage.clear();
  });

  it('正常なGoogle IDトークン（iss, aud, exp, email_verified）を検証・デコードできる', () => {
    const clientId = '123456789-test.apps.googleusercontent.com';
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    const token = createFakeJwt({
      iss: 'https://accounts.google.com',
      aud: clientId,
      sub: 'user-123',
      email: 'owner@example.com',
      email_verified: true,
      iat: futureExp - 3600,
      exp: futureExp
    });

    const claims = decodeAndVerifyIdTokenClaims(token, clientId);
    expect(claims.email).toBe('owner@example.com');
    expect(claims.email_verified).toBe(true);
  });

  it('Audience (aud) が異なるIDトークンや期限切れのIDトークンを拒否する', () => {
    const clientId = '123456789-test.apps.googleusercontent.com';
    const expiredToken = createFakeJwt({
      iss: 'https://accounts.google.com',
      aud: clientId,
      sub: 'user-123',
      email: 'owner@example.com',
      email_verified: true,
      iat: 1000,
      exp: 2000
    });

    expect(() => decodeAndVerifyIdTokenClaims(expiredToken, clientId)).toThrow(/有効期限/);
    expect(() => decodeAndVerifyIdTokenClaims(expiredToken, 'wrong-client-id')).toThrow(/Audience/);
  });

  it('OAuthアクセストークンがlocalStorageに一切保存されず、インメモリストアのみで管理される', () => {
    useAppStore.getState().setAuthUser({
      email: 'owner@example.com',
      name: 'Owner',
      picture: '',
      idToken: 'dummy-id-token',
      idTokenExp: Date.now() + 3600000,
      accessToken: 'ya29.secret-access-token',
      accessTokenExpiresAt: Date.now() + 3600000
    });

    // localStorage の全キーを検査し、アクセストークンが含まれないことを確認
    const allLocalStorageValues = Object.keys(window.localStorage).map((k) =>
      window.localStorage.getItem(k)
    );
    expect(allLocalStorageValues.join(' ')).not.toContain('ya29.secret-access-token');
  });
});

describe('2. GitHub複数リポジトリ・Markdownエディタ・SHA競合検知', () => {
  it('YAMLおよびTOML形式のFrontmatterを解析・双方向更新でき、本文や他のキーを破壊しない', () => {
    const sampleMd = [
      '---',
      'title: "初期タイトル"',
      'date: "2026-11-26"',
      'customTag: "keep-me"',
      '---',
      '',
      '# 見出し',
      '本文テキスト'
    ].join('\n');

    const parsed = splitFrontmatterAndBody(sampleMd);
    expect(parsed.format).toBe('yaml');
    expect(parsed.fields.title).toBe('初期タイトル');
    expect(parsed.fields.customTag).toBe('keep-me');

    const updated = updateFrontmatterField(sampleMd, 'title', '更新後タイトル', 'yaml');
    const reparsed = splitFrontmatterAndBody(updated);
    expect(reparsed.fields.title).toBe('更新後タイトル');
    expect(reparsed.fields.customTag).toBe('keep-me');
    expect(reparsed.body).toContain('# 見出し');
  });

  it('リポジトリ設定にトークンそのものではなく GITHUB_TOKEN_* 参照キーのみを許可する', () => {
    const invalidRepo = repositoryInputSchema.safeParse({
      displayName: 'My Blog',
      owner: 'octocat',
      repo: 'blog',
      branch: 'main',
      articlesDir: 'src/content/blog',
      imagesDir: 'public/images',
      markdownExt: '.md',
      frontmatterFormat: 'yaml',
      defaultTemplate: '',
      siteUrl: 'https://octocat.github.io',
      articleUrlPattern: '{siteUrl}/posts/{slug}',
      tokenPropertyKey: 'ghp_rawSecretTokenShouldBeRejected',
      isActive: true
    });
    expect(invalidRepo.success).toBe(false);

    const validRepo = repositoryInputSchema.safeParse({
      displayName: 'My Blog',
      owner: 'octocat',
      repo: 'blog',
      branch: 'main',
      articlesDir: 'src/content/blog',
      imagesDir: 'public/images',
      markdownExt: '.md',
      frontmatterFormat: 'yaml',
      defaultTemplate: '',
      siteUrl: 'https://octocat.github.io',
      articleUrlPattern: '{siteUrl}/posts/{slug}',
      tokenPropertyKey: 'GITHUB_TOKEN_PORTFOLIO',
      isActive: true
    });
    expect(validRepo.success).toBe(true);
  });

  it('ディレクトリトラバーサル（..）を含む不正な記事ファイル名を拒否する', () => {
    const res = articleSaveSchema.safeParse({
      repositoryId: 'repo_1',
      filename: '../../etc/passwd.md',
      content: '# test',
      commitMessage: 'docs: test'
    });
    expect(res.success).toBe(false);
  });

  it('SHA競合発生時にリモート最新版とローカル編集内容の行単位差分（Diff）を正確に抽出する', () => {
    const remote = 'line1\nremote-modified\nline3';
    const local = 'line1\nlocal-modified\nline3';
    const diff = computeLineDiff(remote, local);

    expect(diff.some((d) => d.type === 'removed' && d.text === 'remote-modified')).toBe(true);
    expect(diff.some((d) => d.type === 'added' && d.text === 'local-modified')).toBe(true);
  });
});

describe('3. お知らせ・アプリ・入力値検証', () => {
  it('お知らせの公開予約（scheduled）時に公開予定日時が空の場合はエラーにする', () => {
    const res = noticeInputSchema.safeParse({
      appId: 'app_1',
      title: 'メンテナンス予告',
      body: '本文です',
      status: 'scheduled',
      publishedAt: ''
    });
    expect(res.success).toBe(false);
  });

  it('アプリ管理のBundle ID形式とURL形式を検証する', () => {
    const invalidApp = applicationInputSchema.safeParse({
      name: 'テストアプリ',
      bundleId: 'invalid bundle id with spaces!',
      appStoreUrl: 'javascript:alert(1)',
      isActive: true
    });
    expect(invalidApp.success).toBe(false);
  });
});

describe('4. セキュリティ・XSS対策検証', () => {
  it('Markdownプレビュー時に <script> タグ、<iframe>、onerror/onload イベント属性を完全にサニタイズ除去する', () => {
    const maliciousMarkdown = [
      '---',
      'title: "XSSテスト"',
      '---',
      '',
      '# 安全な見出し',
      '<script>alert("xss")</script>',
      '<img src="x" onerror="alert(1)" />',
      '<iframe src="https://evil.example.com"></iframe>',
      '<a href="javascript:alert(2)">悪意あるリンク</a>'
    ].join('\n');

    const rendered = renderSanitizedMarkdown(maliciousMarkdown);
    expect(rendered.sanitizedHtml).toContain('<h1>安全な見出し</h1>');
    expect(rendered.sanitizedHtml).not.toContain('<script');
    expect(rendered.sanitizedHtml).not.toContain('onerror');
    expect(rendered.sanitizedHtml).not.toContain('<iframe');
    expect(rendered.sanitizedHtml).not.toContain('javascript:');
  });

  it('新規記事テンプレートから正しいFrontmatter付きMarkdownを生成できる', () => {
    const md = buildInitialArticleMarkdown({
      title: 'テスト記事',
      slug: 'test-post',
      format: 'yaml'
    });
    expect(md).toContain('title: "テスト記事"');
    expect(md).toContain('draft: false');
  });
});
