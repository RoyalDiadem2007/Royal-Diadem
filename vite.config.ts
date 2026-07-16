import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { brand } from './src/config/branding.config.ts';

// The PWA manifest is generated from branding.config.ts (Spec §9) so the
// white-label rule holds: rebranding never requires touching a static JSON file.
const manifestJson = JSON.stringify(
  {
    name: brand.name,
    short_name: brand.name,
    description: brand.appDescription,
    start_url: '/',
    display: 'standalone',
    background_color: brand.colors.background,
    theme_color: brand.colors.primary,
    orientation: 'any',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  },
  null,
  2,
);

/** Injects brand values into index.html and emits /manifest.json at build time. */
function brandPlugin(): Plugin {
  return {
    name: 'royal-diadem-brand',
    transformIndexHtml(html) {
      return html
        .replaceAll('%BRAND_NAME%', brand.name)
        .replaceAll('%BRAND_DESCRIPTION%', brand.appDescription)
        .replaceAll('%BRAND_THEME_COLOR%', brand.colors.primary);
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'manifest.json', source: manifestJson });
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/manifest.json') {
          res.setHeader('Content-Type', 'application/manifest+json');
          res.end(manifestJson);
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), brandPlugin()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // The E2E suite needs the local Supabase stack; it runs via `npm run
    // test:e2e` (vitest.e2e.config.ts), not in the unit gate.
    exclude: ['**/node_modules/**', 'tests/e2e/**'],
  },
});
