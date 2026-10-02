import { Kysely } from 'kysely';
import { buildApp, type BuildAppOptions } from '../../src/app.js';
import type { AppDependencies } from '../../src/app-dependencies.js';
import { loadConfig, type AppConfig } from '../../src/config/config.js';
import { denyAllPolicy, noAuthentication } from '../../src/core/auth/access.js';
import type { Clock } from '../../src/core/utils/clock.js';
import { createKysely } from '../../src/data/kysely/connection.js';
import type { Database } from '../../src/data/kysely/database-schema.js';
import { KyselyDataStore } from '../../src/data/kysely/kysely-data-store.js';
import { PgliteTestDialect } from './pglite-dialect.js';

/** Fixed clock for deterministic tests. */
export const fixedClock = (iso = '2026-06-01T09:00:00.000Z'): Clock => ({
  now: () => new Date(iso),
});

export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  return loadConfig({
    readEnvFiles: false,
    env: { NODE_ENV: 'test', DATABASE_URL: 'sqlite::memory:', LOG_LEVEL: 'silent', ...overrides },
  });
}

export type TestDriver = 'sqlite' | 'postgres';

/** A fresh, fully migrated, empty database (plus the school identity row). Test-only. */
export async function openTestDatabase(driver: TestDriver = 'sqlite') {
  const db: Kysely<Database> =
    driver === 'sqlite'
      ? await createKysely({ driver: 'sqlite', filename: ':memory:' })
      : new Kysely<Database>({ dialect: new PgliteTestDialect() });
  const store = new KyselyDataStore(db);
  await store.schema.migrateToLatest();
  return { db, store };
}

export async function buildTestApp(
  overrides: Partial<AppDependencies> = {},
  options: BuildAppOptions = {},
) {
  const dataStore = overrides.dataStore ?? (await openTestDatabase('sqlite')).store;
  const deps: AppDependencies = {
    config: testConfig(),
    clock: fixedClock(),
    authenticator: noAuthentication,
    accessPolicy: denyAllPolicy,
    ...overrides,
    dataStore,
  };
  const app = await buildApp(deps, { logger: false, ...options });
  return {
    app,
    deps,
    close: async () => {
      await app.close();
      await deps.dataStore.close();
    },
  };
}
