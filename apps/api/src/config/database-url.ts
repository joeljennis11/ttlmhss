import path from 'node:path';

/**
 * Database connection settings, parsed from DATABASE_URL.
 *
 * The provider is intentionally NOT finalised (docs/decisions.md D-04). Adding a provider means
 * adding a variant here and a dialect in src/data/kysely/connection.ts — business logic is unaffected.
 */
export type DatabaseConfig =
  { driver: 'sqlite'; filename: string } | { driver: 'postgres'; connectionString: string };

export const SQLITE_MEMORY = ':memory:';

export class DatabaseUrlError extends Error {}

export function parseDatabaseUrl(url: string, baseDirectory: string): DatabaseConfig {
  const value = url.trim();

  if (value.startsWith('sqlite:')) {
    const target = value.slice('sqlite:'.length);
    if (!target) throw new DatabaseUrlError('sqlite: URL needs a file path or :memory:');
    if (target === SQLITE_MEMORY) return { driver: 'sqlite', filename: SQLITE_MEMORY };
    return { driver: 'sqlite', filename: path.resolve(baseDirectory, target) };
  }

  if (value.startsWith('postgres://') || value.startsWith('postgresql://')) {
    return { driver: 'postgres', connectionString: value };
  }

  // Deliberately do not echo the URL: it may contain credentials.
  throw new DatabaseUrlError('Unsupported DATABASE_URL scheme (expected sqlite: or postgres://)');
}

/** Human-readable description without credentials, safe for logs. */
export function describeDatabase(config: DatabaseConfig): string {
  if (config.driver === 'sqlite') return `sqlite (${config.filename})`;
  try {
    const url = new URL(config.connectionString);
    return `postgres (${url.hostname}:${url.port || '5432'}${url.pathname})`;
  } catch {
    return 'postgres';
  }
}
