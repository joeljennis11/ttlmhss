/**
 * Production readiness check (Phase 12C).
 *
 *   pnpm readiness                              configuration + database + migrations
 *   pnpm readiness https://school.example       … plus checks against the running site
 *   (built: pnpm readiness:prod [url])
 *
 * Read-only: it never changes the database. Prints no secret values. Exit code 1 when any check fails.
 */
import { ConfigError, loadConfig } from '../config/config.js';
import { describeDatabase } from '../config/database-url.js';
import { configChecks, liveChecks, type Check } from '../core/ops/readiness.js';
import { openDataStore } from '../data/index.js';

function print(checks: Check[]): boolean {
  for (const c of checks) console.log(`  ${c.ok ? '✔' : '✘'} ${c.name} — ${c.detail}`);
  return checks.every((c) => c.ok);
}

async function main(): Promise<number> {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      return 1;
    }
    throw error;
  }
  console.log(`[readiness] ${config.env} → ${describeDatabase(config.database)}`);
  let ok = print(configChecks(config));

  const store = await openDataStore(config.database);
  try {
    const db: Check[] = [];
    let up = false;
    try {
      up = await store.ping();
    } catch {
      /* reported below */
    }
    db.push({ name: 'database connection', ok: up, detail: up ? 'reachable' : 'cannot connect' });
    if (up) {
      const pending = (await store.schema.status()).filter((m) => !m.executedAt).map((m) => m.name);
      db.push({
        name: 'migrations',
        ok: pending.length === 0,
        detail: pending.length
          ? `pending: ${pending.join(', ')} (run db:migrate:prod)`
          : 'up to date',
      });
    }
    ok = print(db) && ok;
  } finally {
    await store.close();
  }

  const url = process.argv[2];
  if (url) {
    console.log(`[readiness] live checks against ${url}`);
    ok = print(await liveChecks(url, (u) => fetch(u, { redirect: 'manual' }))) && ok;
  }
  console.log(ok ? '[readiness] all checks passed' : '[readiness] some checks FAILED');
  return ok ? 0 : 1;
}

process.exitCode = await main();
