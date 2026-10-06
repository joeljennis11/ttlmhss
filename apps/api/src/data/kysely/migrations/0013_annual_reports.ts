import { sql, type ForeignKeyConstraintBuilder, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';
import { inList, withId, withReference, withTimestamps } from './ddl-helpers.js';

/**
 * 0013 — Annual reports (Phase 11).
 *
 * annual_reports — ONE per student and academic year: the official annual report's lifecycle
 *   DRAFT → FINALIZED → PUBLISHED. The placement it belongs to (enrolment + section in that year)
 *   fixes who may prepare it. While DRAFT the content is computed live from the source services;
 *   at finalization the complete display-ready content (`snapshot_json`, incl. the configuration
 *   that applied: weightages, labels, grades, names) and the final remark are frozen, so later
 *   changes to marks, attendance, configuration or placement never alter an official report.
 *   `revision` detects concurrent changes. Other reports (report cards, mark sheets, attendance,
 *   performance) are not stored: they are generated on request from the source data.
 *
 * References are ON DELETE RESTRICT. No rows are inserted.
 */
const STATUSES = ['DRAFT', 'FINALIZED', 'PUBLISHED'] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = Kysely<any>;

const restrict = (fk: ForeignKeyConstraintBuilder) => fk.onDelete('restrict').onUpdate('restrict');

async function up(db: Db): Promise<void> {
  let t = withId(db.schema.createTable('annual_reports'));
  t = withReference(t, 'annual_reports', 'academic_year_id', 'academic_years');
  t = withReference(t, 'annual_reports', 'student_id', 'students');
  t = withReference(t, 'annual_reports', 'enrolment_id', 'enrolments');
  t = withReference(t, 'annual_reports', 'section_id', 'sections');
  t = t
    .addForeignKeyConstraint(
      'fk_annual_reports_placement',
      ['enrolment_id', 'academic_year_id', 'section_id', 'student_id'],
      'enrolments',
      ['id', 'academic_year_id', 'section_id', 'student_id'],
      restrict,
    )
    .addColumn('status', 'text', (col) => col.notNull())
    .addCheckConstraint('ck_annual_reports_status', inList('status', STATUSES))
    .addColumn('final_remark', 'text')
    .addCheckConstraint(
      'ck_annual_reports_remark',
      sql`final_remark is null or length(final_remark) <= 1000`,
    )
    .addColumn('snapshot_json', 'text')
    .addColumn('finalized_at', 'text');
  t = withReference(t, 'annual_reports', 'finalized_by', 'users', { nullable: true });
  t = t.addColumn('published_at', 'text');
  t = withReference(t, 'annual_reports', 'published_by', 'users', { nullable: true });
  t = t
    .addCheckConstraint(
      'ck_annual_reports_frozen',
      sql`(status = 'DRAFT' and snapshot_json is null and finalized_at is null)
        or (status <> 'DRAFT' and snapshot_json is not null and finalized_at is not null and final_remark is not null)`,
    )
    .addCheckConstraint(
      'ck_annual_reports_published',
      sql`(status = 'PUBLISHED') = (published_at is not null)`,
    )
    .addColumn('revision', 'integer', (col) => col.notNull())
    .addCheckConstraint('ck_annual_reports_revision', sql`revision >= 1`);
  t = withReference(t, 'annual_reports', 'created_by', 'users');
  t = withReference(t, 'annual_reports', 'updated_by', 'users', { nullable: true });
  await withTimestamps(t).execute();
  await db.schema
    .createIndex('ux_annual_reports_year_student')
    .on('annual_reports')
    .columns(['academic_year_id', 'student_id'])
    .unique()
    .execute();
  await db.schema
    .createIndex('ix_annual_reports_section')
    .on('annual_reports')
    .columns(['academic_year_id', 'section_id'])
    .execute();
}

async function down(db: Db): Promise<void> {
  await db.schema.dropTable('annual_reports').execute();
}

export const migration0013AnnualReports: Migration = { up, down };
