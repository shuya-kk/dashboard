import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

/**
 * GitHub Pages 上の公開URL（ルートドメインまたは /dashboard 等のサブパス）に
 * 環境変数 PUBLIC_BASE_PATH / PUBLIC_SITE_URL で柔軟に対応し、
 * 完全な静的ビルド（output: 'static'）を生成します。
 */
export default defineConfig({
  output: 'static',
  site: process.env.PUBLIC_SITE_URL || 'https://example.github.io',
  base: process.env.PUBLIC_BASE_PATH || '/',
  trailingSlash: 'ignore',
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()]
  }
});
