/**
 * Database schema CLI.
 *
 *   pnpm db:migrate    apply all pending migrations
 *   pnpm db:rollback   revert the most recent migration
 *   pnpm db:status     list migrations and whether they are applied
 *
 * Uses the same configuration as the API (DATABASE_URL), so it targets whichever database the
 * current environment points at.
 */
import { ConfigError, loadConfig } from '../config/config.js';
import { describeDatabase } from '../config/database-url.js';
import { openDataStore } from '../data/index.js';

const COMMANDS = ['migrate', 'rollback', 'status'] as const;
type Command = (typeof COMMANDS)[number];

async function main(): Promise<number> {
  const command = process.argv[2] as Command | undefined;
  if (!command || !COMMANDS.includes(command)) {
    console.error(`Usage: db <${COMMANDS.join('|')}>`);
    return 2;
  }

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

  console.log(`[db] ${config.env} → ${describeDatabase(config.database)}`);
  const store = await openDataStore(config.database);
  try {
    if (command === 'migrate') {
      const applied = await store.schema.migrateToLatest();
      console.log(
        applied.length ? `[db] applied: ${applied.join(', ')}` : '[db] already up to date',
      );
    } else if (command === 'rollback') {
      const reverted = await store.schema.rollbackLast();
      console.log(reverted ? `[db] reverted: ${reverted}` : '[db] nothing to roll back');
    } else {
      for (const m of await store.schema.status()) {
        console.log(
          `  ${m.executedAt ? '✔' : '·'} ${m.name}${m.executedAt ? `  (${m.executedAt})` : '  (pending)'}`,
        );
      }
    }
    return 0;
  } catch (error) {
    console.error('[db] failed:', error instanceof Error ? error.message : error);
    return 1;
  } finally {
    await store.close();
  }
}

process.exitCode = await main();
