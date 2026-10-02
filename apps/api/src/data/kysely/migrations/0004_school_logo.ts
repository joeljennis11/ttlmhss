import type { Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

/**
 * 0004 — Official school logo (Phase 3).
 *
 * The official logo was supplied by the school (assets/brand/ttlmhss-logo-official.jpg). Its web
 * copy is served by the web app at /brand/ttlmhss-logo.webp. Point the school identity at it so
 * GET /school/branding is the single source the UI reads. Only fills an unset value, so a logo
 * path already changed by an administrator is never overwritten.
 */
const OFFICIAL_WEB_LOGO = '/brand/ttlmhss-logo.webp';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function up(db: Kysely<any>): Promise<void> {
  await db
    .updateTable('school_settings')
    .set({ logo_path: OFFICIAL_WEB_LOGO, updated_at: new Date().toISOString() })
    .where('id', '=', 'default')
    .where('logo_path', 'is', null)
    .execute();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function down(db: Kysely<any>): Promise<void> {
  await db
    .updateTable('school_settings')
    .set({ logo_path: null })
    .where('id', '=', 'default')
    .where('logo_path', '=', OFFICIAL_WEB_LOGO)
    .execute();
}

export const migration0004SchoolLogo: Migration = { up, down };
