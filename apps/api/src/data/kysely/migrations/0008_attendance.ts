import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';
import { inList, withId, withReference, withTimestamps } from './ddl-helpers.js';

/**
 * 0008 — Period-wise attendance (Phase 7).
 *
 * attendance_sessions — one REGISTER: a class/section's lesson in one period on one date. It keeps a
 *   snapshot of the lesson it was taken for (timetable entry + version, subject, teacher), so later
 *   timetable changes never rewrite what happened (BR-TT-09, D-05). `revision` increases on every
 *   save and is how concurrent edits are detected (optimistic locking).
 *   Unique (academic year, date, period, section).
 *
 * attendance_records — one student's status in one register. Year, date and period are repeated
 *   from the session so the database itself refuses two records for the same
 *   (academic year, date, period, student) (BR-ATT-01). The record points at the ENROLMENT (the
 *   student's placement), so class changes and promotions never move old attendance.
 *   Status ∈ - P A L C; Leave requires a reason (MEDICAL / PERSONAL / SCHOOL_ACTIVITY / OTHER).
 *
 * Everything references with ON DELETE RESTRICT: attendance is history. No rows are inserted.
 */
const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
const STATUSES = ['-', 'P', 'A', 'L', 'C'] as const;
const LEAVE_REASONS = ['MEDICAL', 'PERSONAL', 'SCHOOL_ACTIVITY', 'OTHER'] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = Kysely<any>;

async function up(db: Db): Promise<void> {
  // ---- sessions (registers) --------------------------------------------------------------------
  let sessions = withId(db.schema.createTable('attendance_sessions'));
  sessions = withReference(sessions, 'attendance_sessions', 'academic_year_id', 'academic_years');
  sessions = sessions
    .addColumn('date', 'text', (col) => col.notNull())
    .addColumn('day', 'text', (col) => col.notNull())
    .addCheckConstraint('ck_attendance_sessions_day', inList('day', WEEKDAYS));
  sessions = withReference(sessions, 'attendance_sessions', 'period_id', 'periods');
  sessions = withReference(sessions, 'attendance_sessions', 'section_id', 'sections');
  sessions = withReference(
    sessions,
    'attendance_sessions',
    'timetable_entry_id',
    'timetable_entries',
  );
  sessions = withReference(
    sessions,
    'attendance_sessions',
    'timetable_version_id',
    'timetable_versions',
  );
  sessions = withReference(sessions, 'attendance_sessions', 'subject_id', 'subjects');
  sessions = withReference(sessions, 'attendance_sessions', 'teacher_id', 'teachers');
  sessions = sessions
    .addColumn('revision', 'integer', (col) => col.notNull())
    .addCheckConstraint('ck_attendance_sessions_revision', sql`revision >= 1`);
  sessions = withReference(sessions, 'attendance_sessions', 'created_by', 'users', {
    nullable: true,
  });
  sessions = withReference(sessions, 'attendance_sessions', 'updated_by', 'users', {
    nullable: true,
  });
  await withTimestamps(sessions).execute();

  await db.schema
    .createIndex('ux_attendance_sessions_slot')
    .on('attendance_sessions')
    .columns(['academic_year_id', 'date', 'period_id', 'section_id'])
    .unique()
    .execute();
  await db.schema
    .createIndex('ix_attendance_sessions_section_date')
    .on('attendance_sessions')
    .columns(['section_id', 'date'])
    .execute();
  await db.schema
    .createIndex('ix_attendance_sessions_teacher_date')
    .on('attendance_sessions')
    .columns(['teacher_id', 'date'])
    .execute();

  // ---- records ---------------------------------------------------------------------------------
  let records = withId(db.schema.createTable('attendance_records'));
  records = withReference(records, 'attendance_records', 'session_id', 'attendance_sessions');
  records = withReference(records, 'attendance_records', 'academic_year_id', 'academic_years');
  records = records.addColumn('date', 'text', (col) => col.notNull());
  records = withReference(records, 'attendance_records', 'period_id', 'periods');
  records = withReference(records, 'attendance_records', 'enrolment_id', 'enrolments');
  records = withReference(records, 'attendance_records', 'student_id', 'students');
  records = records
    .addColumn('status', 'text', (col) => col.notNull())
    .addCheckConstraint('ck_attendance_records_status', inList('status', STATUSES))
    .addColumn('leave_reason', 'text')
    .addCheckConstraint(
      'ck_attendance_records_leave_reason',
      sql`(status = 'L' and leave_reason is not null and ${inList('leave_reason', LEAVE_REASONS)}) or (status <> 'L' and leave_reason is null)`,
    )
    .addColumn('note', 'text');
  records = withReference(records, 'attendance_records', 'created_by', 'users', {
    nullable: true,
  });
  records = withReference(records, 'attendance_records', 'updated_by', 'users', {
    nullable: true,
  });
  await withTimestamps(records).execute();

  // BR-ATT-01: never two records for the same student in the same period of the same day.
  await db.schema
    .createIndex('ux_attendance_records_student_slot')
    .on('attendance_records')
    .columns(['academic_year_id', 'date', 'period_id', 'student_id'])
    .unique()
    .execute();
  await db.schema
    .createIndex('ux_attendance_records_session_student')
    .on('attendance_records')
    .columns(['session_id', 'student_id'])
    .unique()
    .execute();
  await db.schema
    .createIndex('ix_attendance_records_student_date')
    .on('attendance_records')
    .columns(['student_id', 'date'])
    .execute();
}

async function down(db: Db): Promise<void> {
  await db.schema.dropTable('attendance_records').execute();
  await db.schema.dropTable('attendance_sessions').execute();
}

export const migration0008Attendance: Migration = { up, down };
