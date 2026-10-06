import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * Content-Security-Policy for the BUILT app (Phase 12A). Production bundles contain no inline
 * scripts, so scripts are 'self' only. Exceptions (docs/architecture.md §21): inline style
 * attributes ('unsafe-inline' for styles only), data:/blob: images (logo preview, downloads).
 * Not applied to the dev server, whose hot-reload preamble is an inline script. The hosting layer
 * should also send frame-ancestors 'none' as a header (a <meta> CSP cannot).
 */
export const WEB_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

function contentSecurityPolicy(): Plugin {
  return {
    name: 'ttlmhss-csp',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: WEB_CSP },
        injectTo: 'head-prepend',
      },
      {
        tag: 'meta',
        attrs: { name: 'referrer', content: 'no-referrer' },
        injectTo: 'head-prepend',
      },
    ],
  };
}

const API_TARGET = process.env.TTLMHSS_API_URL ?? 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [react(), contentSecurityPolicy()],
  resolve: {
    alias: {
      '@ttlmhss/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    // Same-origin API calls in development; the API keeps its own CORS rules.
    proxy: { '/api': { target: API_TARGET, changeOrigin: false } },
  },
  // Source maps are written for debugging but not referenced from the shipped bundle.
  build: { outDir: 'dist', sourcemap: 'hidden' },
});
