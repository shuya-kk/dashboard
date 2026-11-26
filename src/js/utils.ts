/**
 * src/js/utils.ts
 * 日時フォーマット（ISO 8601 → 日本時間 Asia/Tokyo 表示）、Frontmatter解析・生成、
 * HTMLサニタイズ、差分計算、接続設定管理などの共通ユーティリティ。
 */

import DOMPurify from 'dompurify';
import { marked } from 'marked';
import type { FrontmatterFormat, PublicConnectionConfig } from '../types/domain';

const CONNECTION_CONFIG_STORAGE_KEY = 'pda_public_connection_config_v1';
const ARTICLE_DRAFT_PREFIX = 'pda_article_draft_v1_';

/**
 * ISO 8601 文字列を日本時間（JST: Asia/Tokyo）の読みやすい形式に変換
 */
export function formatDateTimeJst(isoString: string | undefined | null): string {
  if (!isoString) return '—';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return String(isoString);

  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

/**
 * ISO 8601 文字列を <input type="datetime-local"> 用の日本時間文字列 (YYYY-MM-DDTHH:mm) に変換
 */
export function isoToJstDatetimeLocal(isoString: string | undefined | null): string {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';

  // JST (+09:00) にオフセットしてフォーマット
  const jstMs = date.getTime() + 9 * 60 * 60 * 1000;
  const jstDate = new Date(jstMs);
  return jstDate.toISOString().slice(0, 16);
}

/**
 * <input type="datetime-local"> の日本時間入力値を UTC の ISO 8601 文字列に変換
 */
export function jstDatetimeLocalToIso(localValue: string): string {
  const trimmed = localValue.trim();
  if (!trimmed) return '';
  // 明示的に +09:00 として解釈
  const withOffset = trimmed.length === 16 ? `${trimmed}:00+09:00` : `${trimmed}+09:00`;
  const date = new Date(withOffset);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString();
}

/**
 * Markdown 文字列を Frontmatter ブロックと本文に分離する
 * 特定のAstro構成だけに依存せず、YAML (---)、TOML (+++)、JSON ({...})、Frontmatterなしすべてに対応。
 */
export interface ParsedMarkdownDocument {
  format: FrontmatterFormat;
  frontmatterRaw: string;
  fields: Record<string, string>;
  body: string;
}

export function splitFrontmatterAndBody(markdown: string): ParsedMarkdownDocument {
  const text = String(markdown ?? '');

  // 1. YAML Frontmatter (--- ... ---)
  const yamlMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (yamlMatch) {
    const raw = yamlMatch[1] ?? '';
    const body = yamlMatch[2] ?? '';
    return {
      format: 'yaml',
      frontmatterRaw: raw,
      fields: parseKeyValueLines(raw, ':'),
      body
    };
  }

  // 2. TOML Frontmatter (+++ ... +++)
  const tomlMatch = text.match(/^\+\+\+\r?\n([\s\S]*?)\r?\n\+\+\+\r?\n?([\s\S]*)$/);
  if (tomlMatch) {
    const raw = tomlMatch[1] ?? '';
    const body = tomlMatch[2] ?? '';
    return {
      format: 'toml',
      frontmatterRaw: raw,
      fields: parseKeyValueLines(raw, '='),
      body
    };
  }

  return {
    format: 'none',
    frontmatterRaw: '',
    fields: {},
    body: text
  };
}

function parseKeyValueLines(raw: string, separator: ':' | '='): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = line.indexOf(separator);
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key) {
      result[key] = val;
    }
  }
  return result;
}

/**
 * Frontmatter内の特定キーを更新または追加して完全なMarkdown文字列を再構築する
 * 既存の未知キーやカスタム構造も破壊せずに維持します。
 */
export function updateFrontmatterField(
  fullMarkdown: string,
  key: string,
  newValue: string,
  preferredFormat: FrontmatterFormat = 'yaml'
): string {
  const parsed = splitFrontmatterAndBody(fullMarkdown);
  const format = parsed.format === 'none' ? (preferredFormat === 'none' ? 'yaml' : preferredFormat) : parsed.format;
  const sep = format === 'toml' ? '=' : ':';
  const fence = format === 'toml' ? '+++' : '---';

  const lines = parsed.frontmatterRaw ? parsed.frontmatterRaw.split(/\r?\n/) : [];
  const escapedValue = formatFrontmatterScalar(newValue, format);
  let replaced = false;

  const updatedLines = lines.map((line) => {
    const regex = new RegExp(`^(\\s*${escapeRegExp(key)}\\s*${sep}\\s*)(.*)$`);
    if (regex.test(line)) {
      replaced = true;
      return `${key}${sep === '=' ? ' = ' : ': '}${escapedValue}`;
    }
    return line;
  });

  if (!replaced) {
    updatedLines.push(`${key}${sep === '=' ? ' = ' : ': '}${escapedValue}`);
  }

  const cleanFrontmatter = updatedLines.filter((l, idx) => !(idx === 0 && l.trim() === '')).join('\n');
  return `${fence}\n${cleanFrontmatter}\n${fence}\n\n${parsed.body.replace(/^\r?\n/, '')}`;
}

function formatFrontmatterScalar(val: string, format: FrontmatterFormat): string {
  const trimmed = val.trim();
  if (trimmed === 'true' || trimmed === 'false') return trimmed;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed;
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) return trimmed;
  if (format === 'toml') {
    return `"${trimmed.replace(/"/g, '\\"')}"`;
  }
  if (/[:#{}[\],&*?|<>=!%@`]/.test(trimmed) || trimmed === '') {
    return `"${trimmed.replace(/"/g, '\\"')}"`;
  }
  return trimmed;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 新規記事の初期Markdownを生成
 */
export function buildInitialArticleMarkdown(options: {
  title: string;
  slug: string;
  format: FrontmatterFormat;
  defaultTemplate?: string;
}): string {
  const today = new Date().toISOString().slice(0, 10);
  if (options.defaultTemplate && options.defaultTemplate.trim().length > 0) {
    return options.defaultTemplate
      .replace(/\{title\}/g, options.title || '新規記事タイトル')
      .replace(/\{date\}/g, today)
      .replace(/\{slug\}/g, options.slug || 'new-post');
  }

  if (options.format === 'toml') {
    return [
      '+++',
      `title = "${(options.title || '新規記事タイトル').replace(/"/g, '\\"')}"`,
      `date = "${today}"`,
      'description = ""',
      'draft = false',
      'tags = []',
      '+++',
      '',
      'ここに記事本文を入力してください。',
      ''
    ].join('\n');
  }

  if (options.format === 'none') {
    return `# ${options.title || '新規記事タイトル'}\n\nここに記事本文を入力してください。\n`;
  }

  return [
    '---',
    `title: "${(options.title || '新規記事タイトル').replace(/"/g, '\\"')}"`,
    `date: "${today}"`,
    'description: ""',
    'draft: false',
    'tags: []',
    '---',
    '',
    'ここに記事本文を入力してください。',
    ''
  ].join('\n');
}

/**
 * MarkdownをHTMLへ変換し、DOMPurifyで厳格にHTMLサニタイズを行う（XSS防止必須要件）
 * <script>, <iframe>, <object>, <embed>, <form>, on* イベント属性, javascript: URL を完全に除去します。
 */
export function renderSanitizedMarkdown(markdown: string): {
  frontmatter: Record<string, string>;
  sanitizedHtml: string;
} {
  const parsed = splitFrontmatterAndBody(markdown);
  const rawHtml = marked.parse(parsed.body, {
    async: false,
    gfm: true,
    breaks: true
  }) as string;

  const sanitizedHtml = DOMPurify.sanitize(rawHtml, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'meta', 'link'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onmouseenter', 'onmouseleave', 'style'],
    ALLOW_DATA_ATTR: false
  });

  return {
    frontmatter: parsed.fields,
    sanitizedHtml
  };
}

/**
 * SHA競合時にローカル編集内容とリモート最新版を行単位で比較する簡易Diff計算
 */
export interface DiffLine {
  type: 'same' | 'added' | 'removed';
  lineNumberLocal?: number;
  lineNumberRemote?: number;
  text: string;
}

export function computeLineDiff(remoteText: string, localText: string): DiffLine[] {
  const remoteLines = remoteText.split(/\r?\n/);
  const localLines = localText.split(/\r?\n/);
  const maxLen = Math.max(remoteLines.length, localLines.length);
  const result: DiffLine[] = [];

  for (let i = 0; i < maxLen; i++) {
    const r = remoteLines[i];
    const l = localLines[i];
    if (r === l && r !== undefined) {
      result.push({
        type: 'same',
        lineNumberRemote: i + 1,
        lineNumberLocal: i + 1,
        text: r
      });
    } else {
      if (r !== undefined) {
        result.push({
          type: 'removed',
          lineNumberRemote: i + 1,
          text: r
        });
      }
      if (l !== undefined) {
        result.push({
          type: 'added',
          lineNumberLocal: i + 1,
          text: l
        });
      }
    }
  }
  return result;
}

/**
 * 公開接続設定（Google OAuth Client ID / GAS Deployment ID）の取得
 * ※これらは秘密情報ではなく公開識別子です。アクセストークンやGitHub PATは一切保存しません。
 */
export function getPublicConnectionConfig(): PublicConnectionConfig {
  const envClientId = (import.meta.env.PUBLIC_GOOGLE_CLIENT_ID as string | undefined) || '';
  const envDeploymentId = (import.meta.env.PUBLIC_GAS_DEPLOYMENT_ID as string | undefined) || '';
  const envWebAppUrl = (import.meta.env.PUBLIC_GAS_WEBAPP_URL as string | undefined) || '';

  if (typeof window === 'undefined') {
    return {
      googleClientId: envClientId.trim(),
      gasDeploymentId: envDeploymentId.trim(),
      gasWebAppUrl: envWebAppUrl.trim()
    };
  }

  try {
    const saved = window.localStorage.getItem(CONNECTION_CONFIG_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<PublicConnectionConfig>;
      return {
        googleClientId: (parsed.googleClientId || envClientId).trim(),
        gasDeploymentId: (parsed.gasDeploymentId || envDeploymentId).trim(),
        gasWebAppUrl: (parsed.gasWebAppUrl || envWebAppUrl).trim()
      };
    }
  } catch {
    // ignore storage read error
  }

  return {
    googleClientId: envClientId.trim(),
    gasDeploymentId: envDeploymentId.trim(),
    gasWebAppUrl: envWebAppUrl.trim()
  };
}

/**
 * 公開接続設定（Client ID / Deployment ID）の保存
 */
export function savePublicConnectionConfig(config: PublicConnectionConfig): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(
    CONNECTION_CONFIG_STORAGE_KEY,
    JSON.stringify({
      googleClientId: config.googleClientId.trim(),
      gasDeploymentId: config.gasDeploymentId.trim(),
      gasWebAppUrl: config.gasWebAppUrl.trim()
    })
  );
}

/**
 * 記事編集中のローカル一時保存（アクセストークン等の秘密情報は一切含めない）
 */
export interface ArticleDraftSnapshot {
  repositoryId: string;
  path: string;
  content: string;
  savedAt: string;
}

export function saveArticleDraftToSession(repositoryId: string, pathKey: string, content: string): void {
  if (typeof window === 'undefined') return;
  try {
    const key = `${ARTICLE_DRAFT_PREFIX}${repositoryId}_${pathKey || '__new__'}`;
    const payload: ArticleDraftSnapshot = {
      repositoryId,
      path: pathKey,
      content,
      savedAt: new Date().toISOString()
    };
    window.sessionStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // ignore quota error
  }
}

export function loadArticleDraftFromSession(repositoryId: string, pathKey: string): ArticleDraftSnapshot | null {
  if (typeof window === 'undefined') return null;
  try {
    const key = `${ARTICLE_DRAFT_PREFIX}${repositoryId}_${pathKey || '__new__'}`;
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as ArticleDraftSnapshot;
  } catch {
    return null;
  }
}

export function clearArticleDraftFromSession(repositoryId: string, pathKey: string): void {
  if (typeof window === 'undefined') return;
  try {
    const key = `${ARTICLE_DRAFT_PREFIX}${repositoryId}_${pathKey || '__new__'}`;
    window.sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}
