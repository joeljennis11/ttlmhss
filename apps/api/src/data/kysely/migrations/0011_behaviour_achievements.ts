import {
  sql,
  type CreateTableBuilder,
  type ForeignKeyConstraintBuilder,
  type Kysely,
} from 'kysely';
import type { Migration } from 'kysely/migration';
import { inList, withId, withReference, withTimestamps } from './ddl-helpers.js';

/**
 * 0011 — Exam-based behaviour and student achievements (Phase 9).
 *
 * behaviour_sheets — ONE per exam and section: the class teacher's behaviour assessment of that
 *   section for that exam. DRAFT → SUBMITTED (finalised; visible to students). Submitted sheets are
 *   corrected in place with a reason (audited); there is no hidden "unlocked" state. `revision`
 *   detects concurrent edits. Composite keys tie the exam to its year and the section to its class.
 *
 * behaviour_assessments — one per sheet and student (the student's placement = enrolment) with an
 *   optional remark. behaviour_ratings — one per assessment and configured behaviour category:
 *   rating 1–5 (BR-BH-02) and, once submitted, the configured label of that rating at the time
 *   (so later label changes never rewrite a finalised assessment).
 *
 * achievements — a student's achievement in an academic year: category (configured), title,
 *   description, date, the placement it was recorded against, an optional attachment reference
 *   (reserved; no file storage yet) and ACTIVE / ARCHIVED (archived = hidden, kept as history).
 *
 * Everything references with ON DELETE RESTRICT. No rows are inserted.
 */
const SHEET_STATUSES = ['DRAFT', 'SUBMITTED'] as const;
const ACHIEVEMENT_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = Kysely<any>;

const restrict = (fk: ForeignKeyConstraintBuilder) => fk.onDelete('restrict').onUpdate('restrict');

async function up(db: Db): Promise<void> {
  // ---- behaviour sheets ------------------------------------------------------------------------
  let sheets = withId(db.schema.createTable('behaviour_sheets'));
  sheets = withReference(sheets, 'behaviour_sheets', 'academic_year_id', 'academic_years');
  sheets = withReference(sheets, 'behaviour_sheets', 'exam_id', 'exams');
  sheets = withReference(sheets, 'behaviour_sheets', 'class_id', 'classes');
  sheets = withReference(sheets, 'behaviour_sheets', 'section_id', 'sections');
  sheets = sheets
    .addColumn('status', 'text', (col) => col.notNull())
    .addCheckConstraint('ck_behaviour_sheets_status', inList('status', SHEET_STATUSES))
    .addColumn('revision', 'integer', (col) => col.notNull())
    .addCheckConstraint('ck_behaviour_sheets_revision', sql`revision >= 1`)
    .addColumn('submitted_at', 'text');
  sheets = withReference(sheets, 'behaviour_sheets', 'submitted_by', 'users', { nullable: true });
  sheets = withReference(sheets, 'behaviour_sheets', 'created_by', 'users', { nullable: true });
  sheets = withReference(sheets, 'behaviour_sheets', 'updated_by', 'users', { nullable: true });
  sheets = sheets
    .addCheckConstraint(
      'ck_behaviour_sheets_submitted',
      sql`status <> 'SUBMITTED' or submitted_at is not null`,
    )
    .addForeignKeyConstraint(
      'fk_behaviour_sheets_exam_year',
      ['exam_id', 'academic_year_id'],
      'exams',
      ['id', 'academic_year_id'],
      restrict,
    )
    .addForeignKeyConstraint(
      'fk_behaviour_sheets_section_class',
      ['section_id', 'class_id'],
      'sections',
      ['id', 'class_id'],
      restrict,
    );
  await withTimestamps(sheets).execute();
  await db.schema
    .createIndex('ux_behaviour_sheets_exam_section')
    .on('behaviour_sheets')
    .columns(['exam_id', 'section_id'])
    .unique()
    .execute();
  await db.schema
    .createIndex('ux_behaviour_sheets_id_year_section')
    .on('behaviour_sheets')
    .columns(['id', 'academic_year_id', 'section_id'])
    .unique()
    .execute();

  // ---- assessments (one per sheet and student) --------------------------------------------------
  let assessments = withId(db.schema.createTable('behaviour_assessments'));
  assessments = withReference(assessments, 'behaviour_assessments', 'sheet_id', 'behaviour_sheets');
  assessments = withReference(
    assessments,
    'behaviour_assessments',
    'academic_year_id',
    'academic_years',
  );
  assessments = withReference(assessments, 'behaviour_assessments', 'section_id', 'sections');
  assessments = withReference(assessments, 'behaviour_assessments', 'enrolment_id', 'enrolments');
  assessments = withReference(assessments, 'behaviour_assessments', 'student_id', 'students');
  assessments = assessments
    .addColumn('remark', 'text')
    .addCheckConstraint(
      'ck_behaviour_assessments_remark',
      sql`remark is null or length(remark) <= 300`,
    );
  assessments = withReference(assessments, 'behaviour_assessments', 'created_by', 'users', {
    nullable: true,
  });
  assessments = withReference(assessments, 'behaviour_assessments', 'updated_by', 'users', {
    nullable: true,
  });
  assessments = assessments
    .addForeignKeyConstraint(
      'fk_behaviour_assessments_sheet_year_section',
      ['sheet_id', 'academic_year_id', 'section_id'],
      'behaviour_sheets',
      ['id', 'academic_year_id', 'section_id'],
      restrict,
    )
    .addForeignKeyConstraint(
      'fk_behaviour_assessments_placement',
      ['enrolment_id', 'academic_year_id', 'section_id', 'student_id'],
      'enrolments',
      ['id', 'academic_year_id', 'section_id', 'student_id'],
      restrict,
    );
  await withTimestamps(assessments).execute();
  await db.schema
    .createIndex('ux_behaviour_assessments_sheet_student')
    .on('behaviour_assessments')
    .columns(['sheet_id', 'student_id'])
    .unique()
    .execute();
  await db.schema
    .createIndex('ix_behaviour_assessments_student')
    .on('behaviour_assessments')
    .column('student_id')
    .execute();

  // ---- ratings (one per assessment and category) ------------------------------------------------
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ratings: CreateTableBuilder<any, any> = db.schema.createTable('behaviour_ratings');
  ratings = withReference(ratings, 'behaviour_ratings', 'assessment_id', 'behaviour_assessments');
  ratings = withReference(ratings, 'behaviour_ratings', 'category_id', 'behaviour_categories');
  await ratings
    .addColumn('rating', 'integer', (col) => col.notNull())
    .addCheckConstraint('ck_behaviour_ratings_rating', sql`rating between 1 and 5`)
    .addColumn('rating_label', 'text')
    .addColumn('updated_at', 'text', (col) => col.notNull())
    .addPrimaryKeyConstraint('pk_behaviour_ratings', ['assessment_id', 'category_id'])
    .execute();

  // ---- achievements -----------------------------------------------------------------------------
  await db.schema
    .createIndex('ux_enrolments_id_year_student')
    .on('enrolments')
    .columns(['id', 'academic_year_id', 'student_id'])
    .unique()
    .execute();
  let achievements = withId(db.schema.createTable('achievements'));
  achievements = withReference(achievements, 'achievements', 'academic_year_id', 'academic_years');
  achievements = withReference(achievements, 'achievements', 'student_id', 'students');
  achievements = withReference(achievements, 'achievements', 'enrolment_id', 'enrolments');
  achievements = withReference(
    achievements,
    'achievements',
    'category_id',
    'achievement_categories',
  );
  achievements = achievements
    .addColumn('title', 'text', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('achieved_on', 'text', (col) => col.notNull())
    .addColumn('attachment_ref', 'text')
    .addColumn('status', 'text', (col) => col.notNull())
    .addCheckConstraint('ck_achievements_status', inList('status', ACHIEVEMENT_STATUSES))
    .addCheckConstraint(
      'ck_achievements_text',
      sql`length(title) between 1 and 120 and (description is null or length(description) <= 1000)`,
    );
  achievements = withReference(achievements, 'achievements', 'created_by', 'users', {
    nullable: true,
  });
  achievements = withReference(achievements, 'achievements', 'updated_by', 'users', {
    nullable: true,
  });
  achievements = achievements.addForeignKeyConstraint(
    'fk_achievements_placement',
    ['enrolment_id', 'academic_year_id', 'student_id'],
    'enrolments',
    ['id', 'academic_year_id', 'student_id'],
    restrict,
  );
  await withTimestamps(achievements).execute();
  await db.schema
    .createIndex('ix_achievements_student')
    .on('achievements')
    .columns(['student_id', 'achieved_on'])
    .execute();
  await db.schema
    .createIndex('ix_achievements_year_status')
    .on('achievements')
    .columns(['academic_year_id', 'status'])
    .execute();
}

async function down(db: Db): Promise<void> {
  await db.schema.dropTable('achievements').execute();
  await db.schema.dropIndex('ux_enrolments_id_year_student').execute();
  await db.schema.dropTable('behaviour_ratings').execute();
  await db.schema.dropTable('behaviour_assessments').execute();
  await db.schema.dropTable('behaviour_sheets').execute();
}

export const migration0011BehaviourAchievements: Migration = { up, down };
