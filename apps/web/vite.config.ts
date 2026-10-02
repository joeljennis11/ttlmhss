import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API_TARGET = process.env.TTLMHSS_API_URL ?? 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [react()],
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
  build: { outDir: 'dist', sourcemap: true },
});
