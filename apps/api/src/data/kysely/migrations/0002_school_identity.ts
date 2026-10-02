import type { Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

/**
 * 0002 — School identity (Phase 1).
 *
 * Reference data supplied by the school, not sample data:
 *   TTLMHSS / Thiruthangal Lions Matriculation Higher Secondary School / #003300.
 * The logo path stays NULL until the official logo is provided (never a placeholder).
 * Admin edits these values from Phase 4 onwards.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function up(db: Kysely<any>): Promise<void> {
  const now = new Date().toISOString();
  await db
    .insertInto('school_settings')
    .values({
      id: 'default',
      short_name: 'TTLMHSS',
      full_name: 'Thiruthangal Lions Matriculation Higher Secondary School',
      primary_color: '#003300',
      logo_path: null,
      address: null,
      phone: null,
      email: null,
      created_at: now,
      updated_at: now,
    })
    .execute();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function down(db: Kysely<any>): Promise<void> {
  await db.deleteFrom('school_settings').where('id', '=', 'default').execute();
}

export const migration0002SchoolIdentity: Migration = { up, down };
