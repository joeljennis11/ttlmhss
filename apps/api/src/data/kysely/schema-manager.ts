import type { Kysely } from 'kysely';
import { Migrator } from 'kysely/migration';
import type { MigrationState, SchemaManager } from '../data-store.js';
import type { Database } from './database-schema.js';
import { migrations } from './migrations/index.js';

export class KyselySchemaManager implements SchemaManager {
  private readonly migrator: Migrator;

  constructor(db: Kysely<Database>) {
    this.migrator = new Migrator({
      db,
      provider: { getMigrations: async () => migrations },
    });
  }

  async status(): Promise<MigrationState[]> {
    const infos = await this.migrator.getMigrations();
    return infos.map((info) => ({
      name: info.name,
      executedAt: info.executedAt ? info.executedAt.toISOString() : null,
    }));
  }

  async pending(): Promise<string[]> {
    return (await this.status()).filter((m) => m.executedAt === null).map((m) => m.name);
  }

  async migrateToLatest(): Promise<string[]> {
    const { error, results } = await this.migrator.migrateToLatest();
    if (error) throw error;
    return (results ?? []).filter((r) => r.status === 'Success').map((r) => r.migrationName);
  }

  async rollbackLast(): Promise<string | null> {
    const { error, results } = await this.migrator.migrateDown();
    if (error) throw error;
    return results?.find((r) => r.status === 'Success')?.migrationName ?? null;
  }
}
