import { sql, type ForeignKeyConstraintBuilder, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';
import { inList, withId, withReference, withTimestamps } from './ddl-helpers.js';

/**
 * 0012 — Announcements and structured student requests (Phase 10).
 *
 * announcements — an informational message in an academic year for a STRUCTURED audience:
 *   SCHOOL (everyone), STAFF (teachers and administrators), CLASS (class_id: every section of it),
 *   SECTION (section_id + its class_id). The audience columns are checked so a row can never hold a
 *   half-specified target, and the section must belong to the class (composite key). Lifecycle
 *   DRAFT → PUBLISHED → ARCHIVED (archive instead of delete); `expires_on` (optional, inclusive)
 *   hides a published announcement from its audience after that date.
 *
 * requests — a student's request for review: ATTENDANCE_ISSUE (date + period, lesson subject
 *   resolved by the server), RESULT_CLARIFICATION (exam + subject) or PROFILE_CORRECTION (field
 *   category). Each row records the student's placement at the time (enrolment + section) so scope
 *   (class teacher of that section) never depends on later moves. Lifecycle OPEN → IN_REVIEW →
 *   RESOLVED → CLOSED (reopen → OPEN); `revision` detects concurrent reviewer changes. The status
 *   history lives in the audit trail (entity `request`). A request never changes attendance, marks
 *   or the profile.
 *
 * Everything references with ON DELETE RESTRICT. No rows are inserted.
 */
const AUDIENCES = ['SCHOOL', 'STAFF', 'CLASS', 'SECTION'] as const;
const ANNOUNCEMENT_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
const REQUEST_TYPES = ['ATTENDANCE_ISSUE', 'RESULT_CLARIFICATION', 'PROFILE_CORRECTION'] as const;
const REQUEST_STATUSES = ['OPEN', 'IN_REVIEW', 'RESOLVED', 'CLOSED'] as const;
const PROFILE_FIELDS = [
  'NAME',
  'DATE_OF_BIRTH',
  'GENDER',
  'PARENTS_GUARDIAN',
  'CONTACT',
  'ADDRESS',
  'ADMISSION_DETAILS',
  'CLASS_PLACEMENT',
  'OTHER',
] as const;
const REQUESTER_ROLES = ['STUDENT'] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = Kysely<any>;

const restrict = (fk: ForeignKeyConstraintBuilder) => fk.onDelete('restrict').onUpdate('restrict');

async function up(db: Db): Promise<void> {
  // ---- announcements ---------------------------------------------------------------------------
  let a = withId(db.schema.createTable('announcements'));
  a = withReference(a, 'announcements', 'academic_year_id', 'academic_years');
  a = a
    .addColumn('title', 'text', (col) => col.notNull())
    .addColumn('body', 'text', (col) => col.notNull())
    .addCheckConstraint(
      'ck_announcements_text',
      sql`length(title) between 1 and 120 and length(body) between 1 and 4000`,
    )
    .addColumn('audience', 'text', (col) => col.notNull())
    .addCheckConstraint('ck_announcements_audience', inList('audience', AUDIENCES));
  a = withReference(a, 'announcements', 'class_id', 'classes', { nullable: true });
  a = withReference(a, 'announcements', 'section_id', 'sections', { nullable: true });
  a = a
    .addCheckConstraint(
      'ck_announcements_target',
      sql`(audience in ('SCHOOL', 'STAFF') and class_id is null and section_id is null)
        or (audience = 'CLASS' and class_id is not null and section_id is null)
        or (audience = 'SECTION' and class_id is not null and section_id is not null)`,
    )
    .addForeignKeyConstraint(
      'fk_announcements_section_class',
      ['section_id', 'class_id'],
      'sections',
      ['id', 'class_id'],
      restrict,
    )
    .addColumn('status', 'text', (col) => col.notNull())
    .addCheckConstraint('ck_announcements_status', inList('status', ANNOUNCEMENT_STATUSES))
    .addColumn('published_at', 'text')
    .addCheckConstraint(
      'ck_announcements_published',
      sql`status <> 'PUBLISHED' or published_at is not null`,
    )
    .addColumn('expires_on', 'text');
  a = withReference(a, 'announcements', 'published_by', 'users', { nullable: true });
  a = withReference(a, 'announcements', 'created_by', 'users');
  a = withReference(a, 'announcements', 'updated_by', 'users', { nullable: true });
  await withTimestamps(a).execute();
  await db.schema
    .createIndex('ix_announcements_year_status')
    .on('announcements')
    .columns(['academic_year_id', 'status', 'published_at'])
    .execute();
  await db.schema
    .createIndex('ix_announcements_section')
    .on('announcements')
    .column('section_id')
    .execute();

  // ---- requests --------------------------------------------------------------------------------
  let r = withId(db.schema.createTable('requests'));
  r = r
    .addColumn('type', 'text', (col) => col.notNull())
    .addCheckConstraint('ck_requests_type', inList('type', REQUEST_TYPES))
    .addColumn('status', 'text', (col) => col.notNull())
    .addCheckConstraint('ck_requests_status', inList('status', REQUEST_STATUSES));
  r = withReference(r, 'requests', 'academic_year_id', 'academic_years');
  r = withReference(r, 'requests', 'student_id', 'students');
  r = withReference(r, 'requests', 'enrolment_id', 'enrolments');
  r = withReference(r, 'requests', 'section_id', 'sections');
  r = r.addForeignKeyConstraint(
    'fk_requests_placement',
    ['enrolment_id', 'academic_year_id', 'section_id', 'student_id'],
    'enrolments',
    ['id', 'academic_year_id', 'section_id', 'student_id'],
    restrict,
  );
  r = withReference(r, 'requests', 'requested_by', 'users');
  r = r
    .addColumn('requester_role', 'text', (col) => col.notNull())
    .addCheckConstraint('ck_requests_requester_role', inList('requester_role', REQUESTER_ROLES))
    .addColumn('summary', 'text', (col) => col.notNull())
    .addColumn('description', 'text', (col) => col.notNull())
    .addCheckConstraint(
      'ck_requests_text',
      sql`length(summary) between 1 and 200 and length(description) between 1 and 2000`,
    )
    .addColumn('related_date', 'text');
  r = withReference(r, 'requests', 'related_period_id', 'periods', { nullable: true });
  r = withReference(r, 'requests', 'related_subject_id', 'subjects', { nullable: true });
  r = withReference(r, 'requests', 'related_exam_id', 'exams', { nullable: true });
  r = r
    .addColumn('profile_field', 'text')
    .addCheckConstraint(
      'ck_requests_profile_field',
      sql`profile_field is null or ${inList('profile_field', PROFILE_FIELDS)}`,
    )
    .addCheckConstraint(
      'ck_requests_related',
      sql`(type = 'ATTENDANCE_ISSUE' and related_date is not null and related_period_id is not null and related_exam_id is null and profile_field is null)
        or (type = 'RESULT_CLARIFICATION' and related_exam_id is not null and related_subject_id is not null and related_date is null and profile_field is null)
        or (type = 'PROFILE_CORRECTION' and profile_field is not null and related_date is null and related_exam_id is null and related_subject_id is null)`,
    );
  r = withReference(r, 'requests', 'assigned_to', 'users', { nullable: true });
  r = r
    .addColumn('resolution_note', 'text')
    .addCheckConstraint(
      'ck_requests_resolution_note',
      sql`resolution_note is null or length(resolution_note) <= 1000`,
    )
    .addColumn('resolved_at', 'text');
  r = withReference(r, 'requests', 'resolved_by', 'users', { nullable: true });
  r = r.addColumn('closed_at', 'text');
  r = withReference(r, 'requests', 'closed_by', 'users', { nullable: true });
  r = r
    .addCheckConstraint(
      'ck_requests_lifecycle',
      sql`(status <> 'RESOLVED' or resolved_at is not null) and (status <> 'CLOSED' or closed_at is not null)`,
    )
    .addColumn('revision', 'integer', (col) => col.notNull())
    .addCheckConstraint('ck_requests_revision', sql`revision >= 1`);
  await withTimestamps(r).execute();
  await db.schema
    .createIndex('ix_requests_student')
    .on('requests')
    .columns(['student_id', 'created_at'])
    .execute();
  await db.schema
    .createIndex('ix_requests_year_status')
    .on('requests')
    .columns(['academic_year_id', 'status'])
    .execute();
  await db.schema
    .createIndex('ix_requests_section_status')
    .on('requests')
    .columns(['section_id', 'status'])
    .execute();
}

async function down(db: Db): Promise<void> {
  await db.schema.dropTable('requests').execute();
  await db.schema.dropTable('announcements').execute();
}

export const migration0012AnnouncementsRequests: Migration = { up, down };
