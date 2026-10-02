import { defineConfig, devices } from '@playwright/test';

/**
 * Browser end-to-end tests against the REAL API and a throwaway test database.
 *
 *   pnpm --filter @ttlmhss/web test:e2e
 *
 * Uses Playwright's own Chromium (`pnpm exec playwright install chromium`). Where that download is
 * not possible, point CHROMIUM_PATH at any Chromium/Chrome binary.
 */
const API_PORT = 3101;
const WEB_PORT = 5174;
const chromiumPath = process.env.CHROMIUM_PATH;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: './e2e/.results',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    launchOptions: chromiumPath
      ? {
          executablePath: chromiumPath,
          args: ['--no-sandbox', '--no-zygote', '--disable-dev-shm-usage'],
        }
      : {},
  },
  webServer: [
    {
      command:
        'pnpm --filter @ttlmhss/api exec tsx --conditions=@ttlmhss/source test/e2e/seed.ts && pnpm --filter @ttlmhss/api exec tsx --conditions=@ttlmhss/source src/server.ts',
      url: `http://127.0.0.1:${API_PORT}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        NODE_ENV: 'test',
        PORT: String(API_PORT),
        LOG_LEVEL: 'warn',
        DATABASE_URL: 'sqlite:./data/ttlmhss.e2e.sqlite',
        CORS_ORIGINS: `http://localhost:${WEB_PORT}`,
        // Test-only value, not a real secret.
        SESSION_SECRET: 'e2e-only-session-secret-0123456789abcdef',
        LOGIN_RATE_LIMIT_PER_MINUTE: '1000',
      },
    },
    {
      command: `pnpm exec vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { TTLMHSS_API_URL: `http://127.0.0.1:${API_PORT}` },
    },
  ],
});
