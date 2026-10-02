import { fileURLToPath } from 'node:url';
import { defineProject } from 'vitest/config';

export default defineProject({
  // Tests use the shared package's TypeScript source directly (no pre-build needed).
  // A narrow alias is used instead of global resolve conditions so third-party packages
  // resolve exactly as they do at runtime.
  resolve: {
    alias: {
      '@ttlmhss/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    name: 'api',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    env: { NODE_ENV: 'test' },
  },
});
