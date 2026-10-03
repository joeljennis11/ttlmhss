import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';
import { inList, withId, withReference, withTimestamps } from './ddl-helpers.js';

/**
 * 0010 — Exams, marks and results (Phase 8B).
 *
 * exams (Phase 4) gains its marks lifecycle — `stage` DRAFT → OPEN → CLOSED (separate from the
 *   ACTIVE/INACTIVE record status) — and an optional description.
 *
 * mark_sheets — ONE sheet per exam subject (exam × class × subject, Phase 4) and section. It holds
 *   the teacher explicitly authorised to enter its marks (never inferred from the timetable),
 *   the workflow state DRAFT / SUBMITTED / UNLOCKED, a revision for optimistic locking, who
 *   submitted / unlocked it and why, and — once submitted — the calculation settings used
 *   (maximums, pass marks, "convert to", grade bands) so the result can always be reproduced.
 *   Unique (exam subject, section): there can never be two sheets (or two authorisations).
 *
 * mark_entries — one student's RAW marks on a sheet, per component, in hundredths of a mark
 *   (42.5 → 4250). NULL = "-" (not entered); 0 is a real zero. The derived values (total,
 *   normalised mark, percentage, grade, pass) are written when the sheet is submitted and cleared
 *   when a mark changes. The entry points at the student's ENROLMENT, so later class changes and
 *   promotions never move it. Unique (sheet, student).
 *
 * Composite foreign keys make wrong combinations impossible in the database itself:
 *   sheet.exam + year  → the exam's own year;   sheet.exam subject + exam/class → that exam subject;
 *   sheet.section + class → a section of that class;
 *   entry.sheet + year + section → that sheet;  entry.enrolment + year + section + student → a
 *   placement of that student in that section and year.
 * The extra unique indexes exist only so those keys can reference them.
 *
 * Everything references with ON DELETE RESTRICT (marks are history). No rows are inserted.
 */
const STAGES = ['DRAFT', 'OPEN', 'CLOSED'] as const;
const SHEET_STATUSES = ['DRAFT', 'SUBMITTED', 'UNLOCKED'] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = Kysely<any>;

const KEY_INDEXES: [name: string, table: string, columns: string[]][] = [
  ['ux_exams_id_year', 'exams', ['id', 'academic_year_id']],
  ['ux_exam_subjects_id_exam_class', 'exam_subjects', ['id', 'exam_id', 'class_id']],
  ['ux_sections_id_class', 'sections', ['id', 'class_id']],
  [
    'ux_enrolments_id_year_section_student',
    'enrolments',
    ['id', 'academic_year_id', 'section_id', 'student_id'],
  ],
];

async function up(db: Db): Promise<void> {
  await db.schema
    .alterTable('exams')
    .addColumn('stage', 'text', (col) =>
      col.notNull().defaultTo('DRAFT').check(inList('stage', STAGES)),
    )
    .execute();
  await db.schema.alterTable('exams').addColumn('description', 'text').execute();

  for (const [name, table, columns] of KEY_INDEXES) {
    await db.schema.createIndex(name).on(table).columns(columns).unique().execute();
  }

  // ---- mark sheets -----------------------------------------------------------------------------
  let sheets = withId(db.schema.createTable('mark_sheets'));
  sheets = withReference(sheets, 'mark_sheets', 'academic_year_id', 'academic_years');
  sheets = withReference(sheets, 'mark_sheets', 'exam_id', 'exams');
  sheets = withReference(sheets, 'mark_sheets', 'exam_subject_id', 'exam_subjects');
  sheets = withReference(sheets, 'mark_sheets', 'class_id', 'classes');
  sheets = withReference(sheets, 'mark_sheets', 'section_id', 'sections');
  sheets = withReference(sheets, 'mark_sheets', 'subject_id', 'subjects');
  sheets = withReference(sheets, 'mark_sheets', 'entry_teacher_id', 'teachers', {
    nullable: true,
  });
  sheets = sheets
    .addColumn('status', 'text', (col) => col.notNull())
    .addCheckConstraint('ck_mark_sheets_status', inList('status', SHEET_STATUSES))
    .addColumn('revision', 'integer', (col) => col.notNull())
    .addCheckConstraint('ck_mark_sheets_revision', sql`revision >= 1`)
    .addColumn('calculation', 'text')
    .addColumn('submitted_at', 'text');
  sheets = withReference(sheets, 'mark_sheets', 'submitted_by', 'users', { nullable: true });
  sheets = sheets.addColumn('unlocked_at', 'text').addColumn('unlock_reason', 'text');
  sheets = withReference(sheets, 'mark_sheets', 'unlocked_by', 'users', { nullable: true });
  sheets = withReference(sheets, 'mark_sheets', 'created_by', 'users', { nullable: true });
  sheets = withReference(sheets, 'mark_sheets', 'updated_by', 'users', { nullable: true });
  sheets = sheets
    .addCheckConstraint(
      'ck_mark_sheets_submitted',
      sql`status <> 'SUBMITTED' or (submitted_at is not null and calculation is not null)`,
    )
    .addCheckConstraint(
      'ck_mark_sheets_unlocked',
      sql`status <> 'UNLOCKED' or (unlocked_at is not null and unlock_reason is not null)`,
    )
    .addForeignKeyConstraint(
      'fk_mark_sheets_exam_year',
      ['exam_id', 'academic_year_id'],
      'exams',
      ['id', 'academic_year_id'],
      (fk) => fk.onDelete('restrict').onUpdate('restrict'),
    )
    .addForeignKeyConstraint(
      'fk_mark_sheets_exam_subject_class',
      ['exam_subject_id', 'exam_id', 'class_id'],
      'exam_subjects',
      ['id', 'exam_id', 'class_id'],
      (fk) => fk.onDelete('restrict').onUpdate('restrict'),
    )
    .addForeignKeyConstraint(
      'fk_mark_sheets_section_class',
      ['section_id', 'class_id'],
      'sections',
      ['id', 'class_id'],
      (fk) => fk.onDelete('restrict').onUpdate('restrict'),
    );
  await withTimestamps(sheets).execute();
  await db.schema
    .createIndex('ux_mark_sheets_exam_subject_section')
    .on('mark_sheets')
    .columns(['exam_subject_id', 'section_id'])
    .unique()
    .execute();
  await db.schema
    .createIndex('ux_mark_sheets_id_year_section')
    .on('mark_sheets')
    .columns(['id', 'academic_year_id', 'section_id'])
    .unique()
    .execute();
  await db.schema
    .createIndex('ix_mark_sheets_exam_section')
    .on('mark_sheets')
    .columns(['exam_id', 'section_id'])
    .execute();
  await db.schema
    .createIndex('ix_mark_sheets_teacher')
    .on('mark_sheets')
    .column('entry_teacher_id')
    .execute();

  // ---- mark entries ----------------------------------------------------------------------------
  let entries = withId(db.schema.createTable('mark_entries'));
  entries = withReference(entries, 'mark_entries', 'mark_sheet_id', 'mark_sheets');
  entries = withReference(entries, 'mark_entries', 'academic_year_id', 'academic_years');
  entries = withReference(entries, 'mark_entries', 'section_id', 'sections');
  entries = withReference(entries, 'mark_entries', 'enrolment_id', 'enrolments');
  entries = withReference(entries, 'mark_entries', 'student_id', 'students');
  for (const column of ['theory_cm', 'internal_cm', 'practical_cm', 'total_cm', 'normalized_cm']) {
    entries = entries
      .addColumn(column, 'integer')
      .addCheckConstraint(
        `ck_mark_entries_${column}`,
        sql`${sql.ref(column)} is null or ${sql.ref(column)} >= 0`,
      );
  }
  entries = entries
    .addColumn('percent_bp', 'integer')
    .addCheckConstraint(
      'ck_mark_entries_percent',
      sql`percent_bp is null or percent_bp between 0 and 10000`,
    )
    .addColumn('grade', 'text')
    .addColumn('passed', 'integer')
    .addCheckConstraint('ck_mark_entries_passed', sql`passed is null or passed in (0, 1)`);
  entries = withReference(entries, 'mark_entries', 'created_by', 'users', { nullable: true });
  entries = withReference(entries, 'mark_entries', 'updated_by', 'users', { nullable: true });
  entries = entries
    .addForeignKeyConstraint(
      'fk_mark_entries_sheet_year_section',
      ['mark_sheet_id', 'academic_year_id', 'section_id'],
      'mark_sheets',
      ['id', 'academic_year_id', 'section_id'],
      (fk) => fk.onDelete('restrict').onUpdate('restrict'),
    )
    .addForeignKeyConstraint(
      'fk_mark_entries_placement',
      ['enrolment_id', 'academic_year_id', 'section_id', 'student_id'],
      'enrolments',
      ['id', 'academic_year_id', 'section_id', 'student_id'],
      (fk) => fk.onDelete('restrict').onUpdate('restrict'),
    );
  await withTimestamps(entries).execute();
  await db.schema
    .createIndex('ux_mark_entries_sheet_student')
    .on('mark_entries')
    .columns(['mark_sheet_id', 'student_id'])
    .unique()
    .execute();
  await db.schema
    .createIndex('ix_mark_entries_student')
    .on('mark_entries')
    .column('student_id')
    .execute();
}

async function down(db: Db): Promise<void> {
  await db.schema.dropTable('mark_entries').execute();
  await db.schema.dropTable('mark_sheets').execute();
  for (const [name] of [...KEY_INDEXES].reverse()) {
    await db.schema.dropIndex(name).execute();
  }
  await db.schema.alterTable('exams').dropColumn('description').execute();
  await db.schema.alterTable('exams').dropColumn('stage').execute();
}

export const migration0010Marks: Migration = { up, down };
