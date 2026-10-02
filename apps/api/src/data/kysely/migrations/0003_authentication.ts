import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';
import { inList, withReference } from './ddl-helpers.js';

/**
 * 0003 — Authentication (Phase 2).
 *
 * user_credentials: password hash and its state, kept OUT of `users` so ordinary user queries
 *   can never select a hash by accident. A user without a row has no password and cannot sign in.
 * sessions: server-side sessions. Only an HMAC of the session token is stored, so a database
 *   leak does not yield usable sessions.
 *
 * Permissions are code-defined per role (docs/permissions.md, D-15); no permission tables.
 */
const PASSWORD_STATUS = ['TEMPORARY', 'SET'] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function up(db: Kysely<any>): Promise<void> {
  await withReference(
    db.schema.createTable('user_credentials'),
    'user_credentials',
    'user_id',
    'users',
  )
    .addColumn('password_hash', 'text', (col) => col.notNull())
    .addColumn('password_status', 'text', (col) => col.notNull())
    .addColumn('password_changed_at', 'text', (col) => col.notNull())
    .addColumn('last_login_at', 'text')
    .addColumn('created_at', 'text', (col) => col.notNull())
    .addColumn('updated_at', 'text', (col) => col.notNull())
    .addPrimaryKeyConstraint('pk_user_credentials', ['user_id'])
    .addCheckConstraint('ck_user_credentials_status', inList('password_status', PASSWORD_STATUS))
    .addCheckConstraint('ck_user_credentials_hash', sql`length(password_hash) > 20`)
    .execute();

  await withReference(
    db.schema
      .createTable('sessions')
      .addColumn('id', 'text', (col) => col.primaryKey().notNull())
      .addColumn('token_hash', 'text', (col) => col.notNull().unique()),
    'sessions',
    'user_id',
    'users',
  )
    .addColumn('created_at', 'text', (col) => col.notNull())
    .addColumn('last_seen_at', 'text', (col) => col.notNull())
    .addColumn('expires_at', 'text', (col) => col.notNull())
    .addColumn('revoked_at', 'text')
    .addColumn('revoked_reason', 'text')
    .addColumn('ip_address', 'text')
    .addColumn('user_agent', 'text')
    .addCheckConstraint('ck_sessions_expiry', sql`created_at < expires_at`)
    .execute();
  await db.schema
    .createIndex('ix_sessions_user')
    .on('sessions')
    .columns(['user_id', 'expires_at'])
    .execute();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('sessions').execute();
  await db.schema.dropTable('user_credentials').execute();
}

export const migration0003Authentication: Migration = { up, down };
