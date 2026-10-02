import { defineConfig } from 'vitest/config';

// Each workspace package owns its own vitest config; this file only lists them.
export default defineConfig({
  test: {
    projects: ['packages/shared', 'apps/api', 'apps/web'],
  },
});
