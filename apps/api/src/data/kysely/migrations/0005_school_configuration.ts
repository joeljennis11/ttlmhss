import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';
import {
  RECORD_STATUS_V1,
  inList,
  withId,
  withReference,
  withStatus,
  withTimestamps,
} from './ddl-helpers.js';

/**
 * 0005 — School configuration (Phase 4).
 *
 * Extends Phase 1 tables (school details, working days, subject order) and adds the typed
 * configuration tables later modules read: attendance locking policy, grade scales, exams and their
 * per-class subjects, behaviour categories and rating labels, achievement categories, and role
 * permission overrides. No school data is inserted — every value is entered by an administrator.
 *
 * Percentages are stored as integer hundredths ("basis points": 33.33 % → 3333) so they are exact
 * and identical on every database. Names are unique case-insensitively via lower(name) indexes.
 */
const ROLES_CONFIGURABLE = ['TEACHER', 'CLASS_TEACHER', 'STUDENT'] as const;
const LOCK_MODES = ['MONTHLY_CUTOFF', 'NO_LOCK'] as const;
const RANK_SCOPES = ['SECTION', 'CLASS'] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = Kysely<any>;

async function uniqueLower(db: Db, name: string, table: string, columns: string[]) {
  let builder = db.schema.createIndex(name).on(table).unique();
  for (const column of columns) {
    builder = column === 'name' ? builder.expression(sql`lower(name)`) : builder.column(column);
  }
  await builder.execute();
}

async function up(db: Db): Promise<void> {
  // ---- Extend Phase 1 tables ------------------------------------------------------------------
  for (const column of ['motto', 'website', 'principal_name']) {
    await db.schema.alterTable('school_settings').addColumn(column, 'text').execute();
  }
  // Comma-separated weekday codes (MON,TUE,…); NULL until configured.
  await db.schema.alterTable('academic_years').addColumn('working_days', 'text').execute();
  await db.schema
    .alterTable('subjects')
    .addColumn('display_order', 'integer', (col) => col.notNull().defaultTo(0))
    .execute();

  await uniqueLower(db, 'ux_classes_name_ci', 'classes', ['name']);
  await uniqueLower(db, 'ux_sections_class_name_ci', 'sections', ['class_id', 'name']);
  await uniqueLower(db, 'ux_subjects_name_ci', 'subjects', ['name']);
  await uniqueLower(db, 'ux_academic_years_label_ci', 'academic_years', ['label']);

  // ---- Attendance locking policy (single row; absent = not configured = never locks) ----------
  await withTimestamps(
    db.schema
      .createTable('attendance_policy')
      .addColumn('id', 'text', (col) => col.primaryKey().notNull())
      .addColumn('mode', 'text', (col) => col.notNull())
      .addColumn('cutoff_day', 'integer', (col) => col.notNull())
      .addCheckConstraint('ck_attendance_policy_singleton', sql`id = 'default'`)
      .addCheckConstraint('ck_attendance_policy_mode', inList('mode', LOCK_MODES))
      .addCheckConstraint('ck_attendance_policy_cutoff', sql`cutoff_day between 1 and 28`),
  ).execute();

  // ---- Grade scales ------------------------------------------------------------------------------
  await withTimestamps(
    withStatus(
      withId(db.schema.createTable('grade_schemes')).addColumn('name', 'text', (col) =>
        col.notNull(),
      ),
      'grade_schemes',
      RECORD_STATUS_V1,
    ),
  ).execute();
  await uniqueLower(db, 'ux_grade_schemes_name_ci', 'grade_schemes', ['name']);

  // Bands belong to their scale and are replaced together when the scale is edited.
  await withReference(
    withId(db.schema.createTable('grade_bands')),
    'grade_bands',
    'grade_scheme_id',
    'grade_schemes',
  )
    .addColumn('label', 'text', (col) => col.notNull())
    .addColumn('min_bp', 'integer', (col) => col.notNull())
    .addColumn('remark', 'text')
    .addCheckConstraint('ck_grade_bands_min', sql`min_bp between 0 and 10000`)
    .addUniqueConstraint('uq_grade_bands_scheme_min', ['grade_scheme_id', 'min_bp'])
    .addUniqueConstraint('uq_grade_bands_scheme_label', ['grade_scheme_id', 'label'])
    .execute();

  // ---- Exams ---------------------------------------------------------------------------------------
  await withTimestamps(
    withStatus(
      withReference(
        withReference(
          withId(db.schema.createTable('exams')),
          'exams',
          'academic_year_id',
          'academic_years',
        ),
        'exams',
        'grade_scheme_id',
        'grade_schemes',
        { nullable: true },
      )
        .addColumn('name', 'text', (col) => col.notNull())
        .addColumn('start_date', 'text')
        .addColumn('end_date', 'text')
        .addColumn('weightage_bp', 'integer', (col) => col.notNull())
        .addColumn('rank_scope', 'text', (col) => col.notNull())
        .addColumn('display_order', 'integer', (col) => col.notNull())
        .addCheckConstraint('ck_exams_weightage', sql`weightage_bp between 0 and 10000`)
        .addCheckConstraint('ck_exams_rank_scope', inList('rank_scope', RANK_SCOPES))
        .addCheckConstraint(
          'ck_exams_dates',
          sql`start_date is null or end_date is null or start_date <= end_date`,
        ),
      'exams',
      RECORD_STATUS_V1,
    ),
  ).execute();
  await uniqueLower(db, 'ux_exams_year_name_ci', 'exams', ['academic_year_id', 'name']);

  // Which subjects an exam has for each class, with mark structure (BR-EX-02).
  await withTimestamps(
    withReference(
      withReference(
        withReference(
          withReference(
            withId(db.schema.createTable('exam_subjects')),
            'exam_subjects',
            'exam_id',
            'exams',
          ),
          'exam_subjects',
          'class_id',
          'classes',
        ),
        'exam_subjects',
        'subject_id',
        'subjects',
      ),
      'exam_subjects',
      'grade_scheme_id',
      'grade_schemes',
      { nullable: true },
    )
      .addColumn('theory_max', 'integer', (col) => col.notNull())
      .addColumn('internal_max', 'integer')
      .addColumn('practical_max', 'integer')
      .addColumn('pass_marks', 'integer', (col) => col.notNull())
      .addColumn('normalized_max', 'integer')
      .addColumn('include_in_result', 'integer', (col) => col.notNull())
      .addUniqueConstraint('uq_exam_subjects', ['exam_id', 'class_id', 'subject_id'])
      .addCheckConstraint(
        'ck_exam_subjects_marks',
        sql`theory_max >= 0 and coalesce(internal_max, 0) >= 0 and coalesce(practical_max, 0) >= 0
            and theory_max + coalesce(internal_max, 0) + coalesce(practical_max, 0) > 0
            and pass_marks >= 0
            and pass_marks <= theory_max + coalesce(internal_max, 0) + coalesce(practical_max, 0)
            and (normalized_max is null or normalized_max > 0)`,
      )
      .addCheckConstraint('ck_exam_subjects_include', sql`include_in_result in (0, 1)`),
  ).execute();
  await db.schema
    .createIndex('ix_exam_subjects_exam_class')
    .on('exam_subjects')
    .columns(['exam_id', 'class_id'])
    .execute();

  // ---- Behaviour & achievements --------------------------------------------------------------------
  for (const table of ['behaviour_categories', 'achievement_categories']) {
    await withTimestamps(
      withStatus(
        withId(db.schema.createTable(table))
          .addColumn('name', 'text', (col) => col.notNull())
          .addColumn('description', 'text')
          .addColumn('display_order', 'integer', (col) => col.notNull()),
        table,
        RECORD_STATUS_V1,
      ),
    ).execute();
    await uniqueLower(db, `ux_${table}_name_ci`, table, ['name']);
  }

  await db.schema
    .createTable('behaviour_rating_labels')
    .addColumn('rating', 'integer', (col) => col.primaryKey().notNull())
    .addColumn('label', 'text', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('updated_at', 'text', (col) => col.notNull())
    .addCheckConstraint('ck_behaviour_rating_labels_rating', sql`rating between 1 and 5`)
    .execute();

  // ---- Role permission overrides (differences from the code-defined defaults) ----------------------
  await withReference(
    db.schema
      .createTable('role_permission_overrides')
      .addColumn('role', 'text', (col) => col.notNull())
      .addColumn('permission', 'text', (col) => col.notNull())
      .addColumn('effect', 'text', (col) => col.notNull()),
    'role_permission_overrides',
    'updated_by',
    'users',
    { nullable: true },
  )
    .addColumn('updated_at', 'text', (col) => col.notNull())
    .addPrimaryKeyConstraint('pk_role_permission_overrides', ['role', 'permission'])
    .addCheckConstraint('ck_role_permission_overrides_role', inList('role', ROLES_CONFIGURABLE))
    .addCheckConstraint(
      'ck_role_permission_overrides_effect',
      inList('effect', ['GRANT', 'REVOKE']),
    )
    .execute();
}

async function down(db: Db): Promise<void> {
  for (const table of [
    'role_permission_overrides',
    'behaviour_rating_labels',
    'achievement_categories',
    'behaviour_categories',
    'exam_subjects',
    'exams',
    'grade_bands',
    'grade_schemes',
    'attendance_policy',
  ]) {
    await db.schema.dropTable(table).execute();
  }
  for (const index of [
    'ux_academic_years_label_ci',
    'ux_subjects_name_ci',
    'ux_sections_class_name_ci',
    'ux_classes_name_ci',
  ]) {
    await db.schema.dropIndex(index).execute();
  }
  await db.schema.alterTable('subjects').dropColumn('display_order').execute();
  await db.schema.alterTable('academic_years').dropColumn('working_days').execute();
  for (const column of ['principal_name', 'website', 'motto']) {
    await db.schema.alterTable('school_settings').dropColumn(column).execute();
  }
}

export const migration0005SchoolConfiguration: Migration = { up, down };
