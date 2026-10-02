// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Architectural boundaries are enforced here, not just documented:
 * - Business logic (modules/, core/) must never import a database driver or the Kysely adapter.
 *   Only apps/api/src/data/kysely/** may talk to the database.
 * - The web app may never import backend code.
 */
const DB_LIBRARIES = ['kysely', 'better-sqlite3', 'pg'];

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**', 'apps/api/data/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'always'],
      'no-console': 'error',
    },
  },
  {
    files: ['apps/api/src/**/*.ts'],
    ignores: ['apps/api/src/data/kysely/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: DB_LIBRARIES.map((name) => ({
            name,
            message: 'Database access belongs in apps/api/src/data/kysely only.',
          })),
          patterns: [
            {
              group: ['**/data/kysely/**', '**/data/kysely'],
              message:
                'Depend on the DataStore/repository interfaces in src/data, not the Kysely adapter. Only src/data/index.ts wires it.',
            },
          ],
        },
      ],
    },
  },
  {
    // The composition root and CLI are allowed to wire the concrete adapter.
    files: ['apps/api/src/data/index.ts', 'apps/api/src/scripts/**/*.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    files: [
      'apps/api/src/scripts/**/*.ts',
      'apps/api/test/e2e/**/*.ts',
      'apps/*/scripts/**/*.{js,mjs,ts}',
      'apps/web/e2e/**/*.ts',
    ],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@ttlmhss/api', '**/apps/api/**'],
              message: 'The web app talks to the backend over HTTP only.',
            },
          ],
        },
      ],
    },
  },
  prettier,
);
