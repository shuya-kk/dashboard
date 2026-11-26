import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

/**
 * PUBLIC_BASE_PATH に誤ってフルURL (https://shuya-kk.github.io/dashboard 等) が設定された場合でも、
 * 安全にパス部分 (/dashboard) だけを抽出して正規化するヘルパー関数
 */
function normalizeBasePath(rawBase) {
  const val = String(rawBase || '/').trim();
  if (!val || val === '/') return '/';
  if (/^https?:\/\//i.test(val)) {
    try {
      const parsed = new URL(val);
      return parsed.pathname || '/';
    } catch {
      // ignore
    }
  }
  return val.startsWith('/') ? val : `/${val}`;
}

function normalizeSiteUrl(rawSite) {
  const val = String(rawSite || 'https://shuya-kk.github.io').trim();
  try {
    const parsed = new URL(val);
    return parsed.origin;
  } catch {
    return 'https://shuya-kk.github.io';
  }
}

export default defineConfig({
  output: 'static',
  site: normalizeSiteUrl(process.env.PUBLIC_SITE_URL),
  base: normalizeBasePath(process.env.PUBLIC_BASE_PATH || '/dashboard'),
  trailingSlash: 'ignore',
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()]
  }
});

