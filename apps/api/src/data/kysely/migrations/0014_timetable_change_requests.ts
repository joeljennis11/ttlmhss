import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';
import { inList, withId, withReference, withStatus, withTimestamps } from './ddl-helpers.js';

/**
 * 0014 — Timetable change requests (Phase 12C).
 *
 * timetable_change_requests — a class teacher's request to change ONE lesson slot (section + day +
 *   period) of an academic year's timetable. `current_*` is the lesson in that slot when the
 *   request was made (a snapshot used to detect stale approvals); `proposed_*` what is asked for
 *   (null for REMOVE). Approval applies the change to the year's DRAFT through the normal editor
 *   checks; the published timetable is never changed by a request. `revision` detects concurrent
 *   reviews. History is kept: requests are never deleted.
 *
 * References are ON DELETE RESTRICT. No rows are inserted.
 */
const STATUSES = ['PENDING', 'APPROVED', 'DECLINED', 'WITHDRAWN'] as const;
const KINDS = ['ADD', 'CHANGE', 'REMOVE'] as const;
const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
const T = 'timetable_change_requests';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = Kysely<any>;

async function up(db: Db): Promise<void> {
  let t = withId(db.schema.createTable(T));
  t = withReference(t, T, 'academic_year_id', 'academic_years');
  t = withReference(t, T, 'section_id', 'sections');
  t = t
    .addColumn('day', 'text', (col) => col.notNull())
    .addCheckConstraint(`ck_${T}_day`, inList('day', DAYS));
  t = withReference(t, T, 'period_id', 'periods');
  t = t
    .addColumn('kind', 'text', (col) => col.notNull())
    .addCheckConstraint(`ck_${T}_kind`, inList('kind', KINDS));
  t = withReference(t, T, 'current_subject_id', 'subjects', { nullable: true });
  t = withReference(t, T, 'current_teacher_id', 'teachers', { nullable: true });
  t = withReference(t, T, 'proposed_subject_id', 'subjects', { nullable: true });
  t = withReference(t, T, 'proposed_teacher_id', 'teachers', { nullable: true });
  t = t
    .addCheckConstraint(
      `ck_${T}_current`,
      sql`(current_subject_id is null) = (current_teacher_id is null)
        and ((kind = 'ADD') = (current_subject_id is null))`,
    )
    .addCheckConstraint(
      `ck_${T}_proposed`,
      sql`(proposed_subject_id is null) = (proposed_teacher_id is null)
        and ((kind = 'REMOVE') = (proposed_subject_id is null))`,
    )
    .addColumn('reason', 'text', (col) => col.notNull())
    .addCheckConstraint(`ck_${T}_reason`, sql`length(reason) between 1 and 500`);
  t = withStatus(t, T, STATUSES);
  t = t.addColumn('review_note', 'text');
  t = withReference(t, T, 'reviewed_by', 'users', { nullable: true });
  t = t
    .addColumn('reviewed_at', 'text')
    .addCheckConstraint(
      `ck_${T}_reviewed`,
      sql`(status in ('APPROVED', 'DECLINED')) = (reviewed_at is not null)
        and (status <> 'DECLINED' or review_note is not null)`,
    )
    .addColumn('revision', 'integer', (col) => col.notNull())
    .addCheckConstraint(`ck_${T}_revision`, sql`revision >= 1`);
  t = withReference(t, T, 'requested_by', 'users');
  t = withReference(t, T, 'updated_by', 'users', { nullable: true });
  await withTimestamps(t).execute();
  await db.schema
    .createIndex(`ix_${T}_year_status`)
    .on(T)
    .columns(['academic_year_id', 'status'])
    .execute();
  await db.schema.createIndex(`ix_${T}_section`).on(T).columns(['section_id']).execute();
  await db.schema.createIndex(`ix_${T}_requested_by`).on(T).columns(['requested_by']).execute();
}

async function down(db: Db): Promise<void> {
  await db.schema.dropTable(T).execute();
}

export const migration0014TimetableChangeRequests: Migration = { up, down };
