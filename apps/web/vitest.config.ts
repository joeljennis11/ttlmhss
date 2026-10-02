import { fileURLToPath } from 'node:url';
import { defineProject } from 'vitest/config';

export default defineProject({
  resolve: {
    alias: {
      '@ttlmhss/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    name: 'web',
    // Component tests opt into a DOM with `// @vitest-environment jsdom`.
    environment: 'node',
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['./test/setup.ts'],
    css: { modules: { classNameStrategy: 'non-scoped' } },
  },
});
