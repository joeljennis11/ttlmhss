import { Kysely } from 'kysely';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp, type BuildAppOptions } from '../../src/app.js';
import type { AppDependencies } from '../../src/app-dependencies.js';
import { createAppDependencies } from '../../src/composition.js';
import { loadConfig, type AppConfig } from '../../src/config/config.js';
import type { FeatureModule } from '../../src/core/http/module.js';
import type { Clock } from '../../src/core/utils/clock.js';
import { createKysely } from '../../src/data/kysely/connection.js';
import type { Database } from '../../src/data/kysely/database-schema.js';
import { KyselyDataStore } from '../../src/data/kysely/kysely-data-store.js';
import { PgliteTestDialect } from './pglite-dialect.js';

/** Fixed clock for deterministic tests. */
export const fixedClock = (iso = '2026-06-01T09:00:00.000Z'): Clock => ({
  now: () => new Date(iso),
});

/** A clock tests can move forward (session timeouts, lockouts). */
export class MutableClock implements Clock {
  private current: number;
  constructor(iso = '2026-06-01T09:00:00.000Z') {
    this.current = Date.parse(iso);
  }
  now(): Date {
    return new Date(this.current);
  }
  advance(ms: number): void {
    this.current += ms;
  }
}

/** Test-only secret (not a real credential). */
export const TEST_SESSION_SECRET = 'test-only-session-secret-0123456789abcdef';

export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  return loadConfig({
    readEnvFiles: false,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'sqlite::memory:',
      LOG_LEVEL: 'silent',
      SESSION_SECRET: TEST_SESSION_SECRET,
      ...overrides,
    },
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

export interface TestAppOptions extends Omit<BuildAppOptions, 'extraModules'> {
  /** Environment overrides for the test configuration. */
  env?: Record<string, string>;
  /** Test-only modules, built with the app's real dependencies. */
  modules?: (deps: AppDependencies) => FeatureModule[];
}

export interface TestApp {
  app: FastifyInstance;
  deps: AppDependencies;
  db: Kysely<Database>;
  close: () => Promise<void>;
}

export async function buildTestApp(
  overrides: Partial<Omit<AppDependencies, 'config'>> = {},
  options: TestAppOptions = {},
): Promise<TestApp> {
  const opened = await openTestDatabase('sqlite');
  const { dataStore: overrideStore, ...rest } = overrides;
  const dataStore = overrideStore ?? opened.store;
  const deps = createAppDependencies(testConfig(options.env), dataStore, {
    clock: fixedClock(),
    ...rest,
  });
  const { env: _env, modules, ...appOptions } = options;
  const app = await buildApp(deps, {
    logger: false,
    ...appOptions,
    extraModules: modules ? modules(deps) : [],
  });
  return {
    app,
    deps,
    db: opened.db,
    close: async () => {
      await app.close();
      await dataStore.close();
      if (overrideStore) await opened.store.close();
    },
  };
}

/** The `name=value` Cookie header for the session cookie set by a response. */
export function sessionCookieFrom(response: LightMyRequestResponse): string {
  const cookie = response.cookies.find((c) => c.name.endsWith('ttlmhss_session'));
  if (!cookie) throw new Error(`No session cookie in response (status ${response.statusCode})`);
  return `${cookie.name}=${cookie.value}`;
}

export async function signIn(app: FastifyInstance, username: string, password: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username, password },
  });
  return { response, cookie: response.statusCode === 200 ? sessionCookieFrom(response) : null };
}
