import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { Kysely, PostgresDialect, SqliteDialect } from 'kysely';
import { SQLITE_MEMORY, type DatabaseConfig } from '../../config/database-url.js';
import type { Database } from './database-schema.js';

export type DatabaseDriver = 'sqlite' | 'postgres';

/**
 * Build a Kysely instance for the configured provider. Drivers are imported lazily so a deployment
 * only loads the one it uses.
 */
export async function createKysely(config: DatabaseConfig): Promise<Kysely<Database>> {
  if (config.driver === 'sqlite') {
    const { default: BetterSqlite3 } = await import('better-sqlite3');
    if (config.filename !== SQLITE_MEMORY) {
      mkdirSync(path.dirname(config.filename), { recursive: true });
    }
    const sqlite = new BetterSqlite3(config.filename);
    // SQLite does not enforce foreign keys unless asked to, per connection.
    sqlite.pragma('foreign_keys = ON');
    sqlite.pragma('busy_timeout = 5000');
    if (config.filename !== SQLITE_MEMORY) sqlite.pragma('journal_mode = WAL');
    return new Kysely<Database>({ dialect: new SqliteDialect({ database: sqlite }) });
  }

  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: config.connectionString, max: 10 });
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}
