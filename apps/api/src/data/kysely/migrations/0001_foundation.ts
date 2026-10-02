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
 * 0001 — Foundation schema (Phase 1).
 *
 * School structure, people, the relationships that define scope, student academic history
 * (enrolments) and the audit log. Feature tables (timetable, attendance, exams/marks, behaviour,
 * achievements, announcements, requests, credentials/permissions) are added by migrations in
 * the phase that builds each feature — see docs/database-design.md §5.
 */

const ACADEMIC_YEAR_STATUS = ['UPCOMING', 'CURRENT', 'CLOSED'] as const;
const PERIOD_KIND = ['LESSON', 'BREAK'] as const;
const USER_ROLE = ['ADMIN', 'TEACHER', 'STUDENT'] as const;
const ENROLMENT_STATUS = ['ACTIVE', 'PROMOTED', 'TRANSFERRED', 'NOT_PROMOTED', 'LEFT'] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function up(db: Kysely<any>): Promise<void> {
  // ---- School configuration ------------------------------------------------------------------
  await withTimestamps(
    db.schema
      .createTable('school_settings')
      .addColumn('id', 'text', (col) => col.primaryKey().notNull())
      .addColumn('short_name', 'text', (col) => col.notNull())
      .addColumn('full_name', 'text', (col) => col.notNull())
      .addColumn('primary_color', 'text', (col) => col.notNull())
      .addColumn('logo_path', 'text')
      .addColumn('address', 'text')
      .addColumn('phone', 'text')
      .addColumn('email', 'text')
      // Single-row table.
      .addCheckConstraint('ck_school_settings_singleton', sql`id = 'default'`)
      .addCheckConstraint('ck_school_settings_primary_color', sql`length(primary_color) = 7`),
  ).execute();

  await withTimestamps(
    withStatus(
      withId(db.schema.createTable('academic_years'))
        .addColumn('label', 'text', (col) => col.notNull().unique())
        .addColumn('start_date', 'text', (col) => col.notNull())
        .addColumn('end_date', 'text', (col) => col.notNull())
        .addCheckConstraint('ck_academic_years_dates', sql`start_date < end_date`),
      'academic_years',
      ACADEMIC_YEAR_STATUS,
    ),
  ).execute();
  // BR-AY-02: at most one CURRENT academic year.
  await db.schema
    .createIndex('ux_academic_years_single_current')
    .on('academic_years')
    .column('status')
    .unique()
    .where(sql.ref('status'), '=', sql.lit('CURRENT'))
    .execute();

  await withTimestamps(
    withStatus(
      withId(db.schema.createTable('classes'))
        .addColumn('name', 'text', (col) => col.notNull().unique())
        .addColumn('display_order', 'integer', (col) => col.notNull()),
      'classes',
      RECORD_STATUS_V1,
    ),
  ).execute();

  await withTimestamps(
    withStatus(
      withReference(withId(db.schema.createTable('sections')), 'sections', 'class_id', 'classes')
        .addColumn('name', 'text', (col) => col.notNull())
        .addUniqueConstraint('uq_sections_class_name', ['class_id', 'name']),
      'sections',
      RECORD_STATUS_V1,
    ),
  ).execute();

  await withTimestamps(
    withStatus(
      withId(db.schema.createTable('subjects'))
        .addColumn('name', 'text', (col) => col.notNull().unique())
        .addColumn('code', 'text', (col) => col.unique()),
      'subjects',
      RECORD_STATUS_V1,
    ),
  ).execute();

  // Periods and breaks share one ordered day structure per academic year (BR-TT-11).
  await withTimestamps(
    withStatus(
      withReference(
        withId(db.schema.createTable('periods')),
        'periods',
        'academic_year_id',
        'academic_years',
      )
        .addColumn('sequence', 'integer', (col) => col.notNull())
        .addColumn('period_number', 'integer')
        .addColumn('kind', 'text', (col) => col.notNull())
        .addColumn('label', 'text', (col) => col.notNull())
        .addColumn('start_time', 'text', (col) => col.notNull())
        .addColumn('end_time', 'text', (col) => col.notNull())
        .addCheckConstraint('ck_periods_kind', inList('kind', PERIOD_KIND))
        .addCheckConstraint(
          'ck_periods_number_matches_kind',
          sql`(kind = 'LESSON' and period_number is not null and period_number > 0) or (kind = 'BREAK' and period_number is null)`,
        )
        .addCheckConstraint('ck_periods_times', sql`start_time < end_time`)
        .addUniqueConstraint('uq_periods_year_sequence', ['academic_year_id', 'sequence'])
        .addUniqueConstraint('uq_periods_year_number', ['academic_year_id', 'period_number']),
      'periods',
      RECORD_STATUS_V1,
    ),
  ).execute();

  // ---- Users & people --------------------------------------------------------------------------
  // Credentials, sessions and permission data are added in Phase 2.
  await withTimestamps(
    withStatus(
      withId(db.schema.createTable('users'))
        .addColumn('username', 'text', (col) => col.notNull().unique())
        .addColumn('role', 'text', (col) => col.notNull())
        .addCheckConstraint('ck_users_role', inList('role', USER_ROLE))
        // Usernames are stored normalised so uniqueness is case-insensitive on every provider.
        .addCheckConstraint('ck_users_username_lowercase', sql`username = lower(username)`),
      'users',
      RECORD_STATUS_V1,
    ),
  ).execute();

  await withTimestamps(
    withStatus(
      withReference(withId(db.schema.createTable('teachers')), 'teachers', 'user_id', 'users')
        .addColumn('staff_code', 'text', (col) => col.notNull().unique())
        .addColumn('full_name', 'text', (col) => col.notNull())
        .addColumn('phone', 'text')
        .addColumn('email', 'text')
        .addUniqueConstraint('uq_teachers_user', ['user_id']),
      'teachers',
      RECORD_STATUS_V1,
    ),
  ).execute();
  await db.schema.createIndex('ix_teachers_full_name').on('teachers').column('full_name').execute();

  // Teacher → Subject, many-to-many (BR-TCH-01).
  await withReference(
    withReference(
      db.schema.createTable('teacher_subjects'),
      'teacher_subjects',
      'teacher_id',
      'teachers',
    ),
    'teacher_subjects',
    'subject_id',
    'subjects',
  )
    .addColumn('created_at', 'text', (col) => col.notNull())
    .addPrimaryKeyConstraint('pk_teacher_subjects', ['teacher_id', 'subject_id'])
    .execute();
  await db.schema
    .createIndex('ix_teacher_subjects_subject')
    .on('teacher_subjects')
    .column('subject_id')
    .execute();

  // Class teacher = teacher + section + academic year. History kept via status (BR-TCH-04).
  await withTimestamps(
    withStatus(
      withReference(
        withReference(
          withReference(
            withId(db.schema.createTable('class_teacher_assignments')),
            'class_teacher_assignments',
            'academic_year_id',
            'academic_years',
          ),
          'class_teacher_assignments',
          'section_id',
          'sections',
        ),
        'class_teacher_assignments',
        'teacher_id',
        'teachers',
      )
        .addColumn('assigned_on', 'text', (col) => col.notNull())
        .addColumn('ended_on', 'text'),
      'class_teacher_assignments',
      RECORD_STATUS_V1,
    ),
  ).execute();
  await db.schema
    .createIndex('ux_class_teacher_active_section')
    .on('class_teacher_assignments')
    .columns(['academic_year_id', 'section_id'])
    .unique()
    .where(sql.ref('status'), '=', sql.lit('ACTIVE'))
    .execute();
  await db.schema
    .createIndex('ix_class_teacher_teacher')
    .on('class_teacher_assignments')
    .columns(['teacher_id', 'academic_year_id'])
    .execute();

  await withTimestamps(
    withStatus(
      withReference(withId(db.schema.createTable('students')), 'students', 'user_id', 'users')
        .addColumn('admission_number', 'text', (col) => col.notNull().unique())
        .addColumn('full_name', 'text', (col) => col.notNull())
        .addColumn('date_of_birth', 'text')
        .addColumn('photo_path', 'text')
        .addUniqueConstraint('uq_students_user', ['user_id']),
      'students',
      RECORD_STATUS_V1,
    ),
  ).execute();
  await db.schema.createIndex('ix_students_full_name').on('students').column('full_name').execute();

  // ---- Student academic history -----------------------------------------------------------------
  // One row per (student, section, year) placement. Promotion/transfer CLOSES a row and opens a
  // new one; rows are never rewritten. Attendance, marks and behaviour will reference enrolments.
  await withTimestamps(
    withStatus(
      withReference(
        withReference(
          withReference(
            withId(db.schema.createTable('enrolments')),
            'enrolments',
            'student_id',
            'students',
          ),
          'enrolments',
          'academic_year_id',
          'academic_years',
        ),
        'enrolments',
        'section_id',
        'sections',
      )
        .addColumn('roll_number', 'text')
        .addColumn('started_on', 'text', (col) => col.notNull())
        .addColumn('ended_on', 'text'),
      'enrolments',
      ENROLMENT_STATUS,
    ),
  ).execute();
  await db.schema
    .createIndex('ux_enrolments_one_active_per_year')
    .on('enrolments')
    .columns(['student_id', 'academic_year_id'])
    .unique()
    .where(sql.ref('status'), '=', sql.lit('ACTIVE'))
    .execute();
  await db.schema
    .createIndex('ux_enrolments_active_roll_number')
    .on('enrolments')
    .columns(['academic_year_id', 'section_id', 'roll_number'])
    .unique()
    .where(sql<boolean>`status = 'ACTIVE' and roll_number is not null`)
    .execute();
  await db.schema
    .createIndex('ix_enrolments_section_year')
    .on('enrolments')
    .columns(['section_id', 'academic_year_id', 'status'])
    .execute();
  await db.schema
    .createIndex('ix_enrolments_student')
    .on('enrolments')
    .column('student_id')
    .execute();

  // ---- Audit -----------------------------------------------------------------------------------
  await withReference(
    withId(db.schema.createTable('audit_logs')),
    'audit_logs',
    'actor_user_id',
    'users',
    { nullable: true },
  )
    .addColumn('occurred_at', 'text', (col) => col.notNull())
    .addColumn('action', 'text', (col) => col.notNull())
    .addColumn('entity_type', 'text', (col) => col.notNull())
    .addColumn('entity_id', 'text')
    .addColumn('before_json', 'text')
    .addColumn('after_json', 'text')
    .addColumn('reason', 'text')
    .addColumn('request_id', 'text')
    .execute();
  await db.schema
    .createIndex('ix_audit_logs_entity')
    .on('audit_logs')
    .columns(['entity_type', 'entity_id', 'occurred_at'])
    .execute();
  await db.schema
    .createIndex('ix_audit_logs_actor')
    .on('audit_logs')
    .columns(['actor_user_id', 'occurred_at'])
    .execute();
  await db.schema
    .createIndex('ix_audit_logs_occurred_at')
    .on('audit_logs')
    .column('occurred_at')
    .execute();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function down(db: Kysely<any>): Promise<void> {
  for (const table of [
    'audit_logs',
    'enrolments',
    'students',
    'class_teacher_assignments',
    'teacher_subjects',
    'teachers',
    'users',
    'periods',
    'subjects',
    'sections',
    'classes',
    'academic_years',
    'school_settings',
  ]) {
    await db.schema.dropTable(table).execute();
  }
}

export const migration0001Foundation: Migration = { up, down };
