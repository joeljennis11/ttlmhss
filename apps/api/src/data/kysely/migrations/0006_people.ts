import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';
import { inList } from './ddl-helpers.js';

/**
 * 0006 — Student & teacher management (Phase 5).
 *
 * Extends the Phase 1 people tables with the details the school records, and records who placed or
 * moved a student on each enrolment. No rows are inserted.
 *
 * - students: personal, guardian, contact and address details; admission date; why the student
 *   left (TRANSFERRED / LEFT) and when. Admission numbers become unique ignoring case.
 * - teachers: gender, date of birth, address, designation, qualification, joining date. Staff codes
 *   become unique ignoring case.
 * - enrolments: optional note and the users who opened / closed the placement.
 * Indexes support the management lists (status filters, year filters).
 */
const GENDERS = ['MALE', 'FEMALE', 'OTHER'] as const;
const EXIT_REASONS = ['TRANSFERRED', 'LEFT'] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = Kysely<any>;

const STUDENT_TEXT = [
  'father_name',
  'mother_name',
  'guardian_name',
  'guardian_relation',
  'guardian_phone',
  'phone',
  'email',
  'emergency_phone',
  'address',
  'city',
  'state',
  'pincode',
  'admission_date',
  'exit_date',
] as const;
const TEACHER_TEXT = [
  'date_of_birth',
  'address',
  'designation',
  'qualification',
  'joining_date',
] as const;

async function up(db: Db): Promise<void> {
  // ---- students ---------------------------------------------------------------------------------
  await db.schema
    .alterTable('students')
    .addColumn('gender', 'text', (col) =>
      col.check(sql`gender is null or ${inList('gender', GENDERS)}`),
    )
    .execute();
  for (const column of STUDENT_TEXT) {
    await db.schema.alterTable('students').addColumn(column, 'text').execute();
  }
  await db.schema
    .alterTable('students')
    .addColumn('exit_reason', 'text', (col) =>
      col.check(sql`exit_reason is null or ${inList('exit_reason', EXIT_REASONS)}`),
    )
    .execute();
  await db.schema
    .createIndex('ux_students_admission_number_ci')
    .on('students')
    .unique()
    .expression(sql`lower(admission_number)`)
    .execute();
  await db.schema.createIndex('ix_students_status').on('students').column('status').execute();

  // ---- teachers ---------------------------------------------------------------------------------
  await db.schema
    .alterTable('teachers')
    .addColumn('gender', 'text', (col) =>
      col.check(sql`gender is null or ${inList('gender', GENDERS)}`),
    )
    .execute();
  for (const column of TEACHER_TEXT) {
    await db.schema.alterTable('teachers').addColumn(column, 'text').execute();
  }
  await db.schema
    .createIndex('ux_teachers_staff_code_ci')
    .on('teachers')
    .unique()
    .expression(sql`lower(staff_code)`)
    .execute();
  await db.schema.createIndex('ix_teachers_status').on('teachers').column('status').execute();

  // ---- enrolments: who placed / moved the student ----------------------------------------------
  await db.schema.alterTable('enrolments').addColumn('note', 'text').execute();
  for (const column of ['created_by', 'closed_by']) {
    await db.schema
      .alterTable('enrolments')
      .addColumn(column, 'text', (col) =>
        col.references('users.id').onDelete('restrict').onUpdate('restrict'),
      )
      .execute();
  }
  await db.schema
    .createIndex('ix_enrolments_year_status')
    .on('enrolments')
    .columns(['academic_year_id', 'status'])
    .execute();
}

async function down(db: Db): Promise<void> {
  for (const index of [
    'ix_enrolments_year_status',
    'ix_teachers_status',
    'ux_teachers_staff_code_ci',
    'ix_students_status',
    'ux_students_admission_number_ci',
  ]) {
    await db.schema.dropIndex(index).execute();
  }
  for (const column of ['closed_by', 'created_by', 'note']) {
    await db.schema.alterTable('enrolments').dropColumn(column).execute();
  }
  for (const column of [...TEACHER_TEXT, 'gender']) {
    await db.schema.alterTable('teachers').dropColumn(column).execute();
  }
  for (const column of ['exit_reason', ...STUDENT_TEXT, 'gender']) {
    await db.schema.alterTable('students').dropColumn(column).execute();
  }
}

export const migration0006People: Migration = { up, down };
