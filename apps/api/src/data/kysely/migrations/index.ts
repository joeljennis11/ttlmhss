import type { Migration } from 'kysely/migration';
import { migration0001Foundation } from './0001_foundation.js';
import { migration0002SchoolIdentity } from './0002_school_identity.js';
import { migration0003Authentication } from './0003_authentication.js';
import { migration0004SchoolLogo } from './0004_school_logo.js';

/**
 * Ordered migration registry. Names sort lexically and are applied in that order.
 *
 * Rules:
 * - Never edit or delete a migration that has been applied anywhere; add a new one.
 * - Every migration has a working `down`.
 * - Use only portable DDL (see ddl-helpers.ts). Provider-specific steps need an explicit,
 *   documented reason.
 */
export const migrations: Record<string, Migration> = {
  '0001_foundation': migration0001Foundation,
  '0002_school_identity': migration0002SchoolIdentity,
  '0003_authentication': migration0003Authentication,
  '0004_school_logo': migration0004SchoolLogo,
};
