import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';
import { inList, withId, withReference, withStatus, withTimestamps } from './ddl-helpers.js';

/**
 * 0007 — Timetable (Phase 6).
 *
 * timetable_versions: one academic year's timetable at a point in its life. At most one DRAFT (being
 *   edited) and one PUBLISHED (live) version per year — database-enforced. Publishing turns the draft
 *   into the published version and the old published version into SUPERSEDED history; versions are
 *   never rewritten afterwards. Records who created, last changed and published each version.
 *
 * timetable_entries: Teacher + Subject + Class/Section + Day + Period inside one version. The two
 *   unique indexes ARE the conflict rules (BR-TT-04/05): within a version a section and a teacher can
 *   each be in only one place per day + period. All references are ON DELETE RESTRICT, so a period,
 *   section, subject or teacher used by any timetable — including history — cannot be deleted.
 *
 * Teacher → Subject (teacher_subjects) is NOT changed: the timetable is the association layer.
 * No rows are inserted.
 */
const TIMETABLE_STATUS = ['DRAFT', 'PUBLISHED', 'SUPERSEDED'] as const;
const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = Kysely<any>;

async function up(db: Db): Promise<void> {
  // ---- versions --------------------------------------------------------------------------------
  let versions = withReference(
    withId(db.schema.createTable('timetable_versions')),
    'timetable_versions',
    'academic_year_id',
    'academic_years',
  ).addColumn('version_number', 'integer', (col) => col.notNull());
  versions = withStatus(versions, 'timetable_versions', TIMETABLE_STATUS);
  versions = withReference(versions, 'timetable_versions', 'created_by', 'users', {
    nullable: true,
  });
  versions = withReference(versions, 'timetable_versions', 'updated_by', 'users', {
    nullable: true,
  });
  versions = withReference(versions, 'timetable_versions', 'published_by', 'users', {
    nullable: true,
  })
    .addColumn('published_at', 'text')
    .addColumn('superseded_at', 'text')
    .addCheckConstraint(
      'ck_timetable_versions_published',
      sql`(status = 'DRAFT' and published_at is null) or (status <> 'DRAFT' and published_at is not null)`,
    );
  await withTimestamps(versions).execute();

  await db.schema
    .createIndex('ux_timetable_versions_number')
    .on('timetable_versions')
    .columns(['academic_year_id', 'version_number'])
    .unique()
    .execute();
  // BR-TT-07/08: one draft and one live version per academic year.
  await db.schema
    .createIndex('ux_timetable_versions_one_draft')
    .on('timetable_versions')
    .column('academic_year_id')
    .unique()
    .where(sql.ref('status'), '=', sql.lit('DRAFT'))
    .execute();
  await db.schema
    .createIndex('ux_timetable_versions_one_published')
    .on('timetable_versions')
    .column('academic_year_id')
    .unique()
    .where(sql.ref('status'), '=', sql.lit('PUBLISHED'))
    .execute();

  // ---- entries ---------------------------------------------------------------------------------
  let entries = withId(db.schema.createTable('timetable_entries'));
  entries = withReference(entries, 'timetable_entries', 'version_id', 'timetable_versions');
  entries = withReference(entries, 'timetable_entries', 'academic_year_id', 'academic_years');
  entries = entries
    .addColumn('day', 'text', (col) => col.notNull())
    .addCheckConstraint('ck_timetable_entries_day', inList('day', WEEKDAYS));
  entries = withReference(entries, 'timetable_entries', 'period_id', 'periods');
  entries = withReference(entries, 'timetable_entries', 'section_id', 'sections');
  entries = withReference(entries, 'timetable_entries', 'subject_id', 'subjects');
  entries = withReference(entries, 'timetable_entries', 'teacher_id', 'teachers');
  entries = withReference(entries, 'timetable_entries', 'created_by', 'users', { nullable: true });
  entries = withReference(entries, 'timetable_entries', 'updated_by', 'users', { nullable: true });
  await withTimestamps(entries).execute();

  // BR-TT-05: a class/section holds one lesson per day + period (within a version).
  await db.schema
    .createIndex('ux_timetable_entries_section_slot')
    .on('timetable_entries')
    .columns(['version_id', 'section_id', 'day', 'period_id'])
    .unique()
    .execute();
  // BR-TT-04: a teacher teaches one lesson per day + period (within a version).
  await db.schema
    .createIndex('ux_timetable_entries_teacher_slot')
    .on('timetable_entries')
    .columns(['version_id', 'teacher_id', 'day', 'period_id'])
    .unique()
    .execute();
  // Lookups by teacher / subject (teacher timetables, Teacher → Subject removal guard) and period.
  await db.schema
    .createIndex('ix_timetable_entries_teacher_subject')
    .on('timetable_entries')
    .columns(['teacher_id', 'subject_id'])
    .execute();
  await db.schema
    .createIndex('ix_timetable_entries_period')
    .on('timetable_entries')
    .column('period_id')
    .execute();
}

async function down(db: Db): Promise<void> {
  await db.schema.dropTable('timetable_entries').execute();
  await db.schema.dropTable('timetable_versions').execute();
}

export const migration0007Timetable: Migration = { up, down };
