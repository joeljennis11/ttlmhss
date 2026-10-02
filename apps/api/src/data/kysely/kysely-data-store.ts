import { sql, type Kysely } from 'kysely';
import type { DatabaseConfig } from '../../config/database-url.js';
import type { DataStore, Repositories, SchemaManager } from '../data-store.js';
import { createKysely } from './connection.js';
import type { Database } from './database-schema.js';
import { translateDbError } from './db-errors.js';
import { KyselyAuditLogRepository } from './repositories/audit-log.repository.js';
import { KyselySchoolSettingsRepository } from './repositories/school-settings.repository.js';
import { KyselySchemaManager } from './schema-manager.js';

function createRepositories(db: Kysely<Database>): Repositories {
  return Object.freeze({
    schoolSettings: new KyselySchoolSettingsRepository(db),
    auditLogs: new KyselyAuditLogRepository(db),
  });
}

export class KyselyDataStore implements DataStore {
  readonly repositories: Repositories;
  readonly schema: SchemaManager;

  constructor(private readonly db: Kysely<Database>) {
    this.repositories = createRepositories(db);
    this.schema = new KyselySchemaManager(db);
  }

  async transaction<T>(work: (repos: Repositories) => Promise<T>): Promise<T> {
    try {
      return await this.db.transaction().execute((trx) => work(createRepositories(trx)));
    } catch (error) {
      throw translateDbError(error);
    }
  }

  async ping(): Promise<boolean> {
    try {
      await sql`select 1`.execute(this.db);
      return true;
    } catch {
      return false;
    }
  }

  close(): Promise<void> {
    return this.db.destroy();
  }
}

export async function openKyselyDataStore(config: DatabaseConfig): Promise<DataStore> {
  return new KyselyDataStore(await createKysely(config));
}
