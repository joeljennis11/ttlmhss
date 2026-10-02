import type { DatabaseConfig } from '../config/database-url.js';
import type { DataStore } from './data-store.js';
import { openKyselyDataStore } from './kysely/kysely-data-store.js';

export type { DataStore, MigrationState, Repositories, SchemaManager } from './data-store.js';

/**
 * Composition root for the data layer: the only place (besides the CLI) that knows which
 * implementation backs the DataStore interface.
 */
export function openDataStore(config: DatabaseConfig): Promise<DataStore> {
  return openKyselyDataStore(config);
}
