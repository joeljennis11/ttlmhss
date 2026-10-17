import { sql, type Kysely } from 'kysely';
import type { TimetableRequestKind, TimetableRequestStatus, Weekday } from '@ttlmhss/shared';
import type {
  NewTimetableChangeRequest,
  TimetableChangeRequestFilter,
  TimetableChangeRequestRecord,
  TimetableChangeRequestRepository,
} from '../../../../modules/timetable/change-requests.repository.js';
import type { Database } from '../../database-schema.js';
import { guard } from '../../db-errors.js';
import { userName } from '../communication/announcements.repository.js';

const subjectName = (column: string) =>
  sql<string | null>`(select s.name from subjects s where s.id = ${sql.ref(column)})`;
const teacherName = (column: string) =>
  sql<string | null>`(select t.full_name from teachers t where t.id = ${sql.ref(column)})`;

export class KyselyTimetableChangeRequestRepository implements TimetableChangeRequestRepository {
  constructor(private readonly db: Kysely<Database>) {}

  private base(filter?: TimetableChangeRequestFilter) {
    let q = this.db
      .selectFrom('timetable_change_requests as r')
      .innerJoin('sections as sec', 'sec.id', 'r.section_id')
      .innerJoin('classes as c', 'c.id', 'sec.class_id')
      .innerJoin('periods as p', 'p.id', 'r.period_id');
    if (filter) {
      q = q.where('r.academic_year_id', '=', filter.academicYearId);
      if (filter.status) q = q.where('r.status', '=', filter.status);
      if (filter.sectionIds) {
        if (filter.sectionIds.length === 0) q = q.where(sql<boolean>`1 = 0`);
        else q = q.where('r.section_id', 'in', filter.sectionIds);
      }
      if (filter.requestedBy) q = q.where('r.requested_by', '=', filter.requestedBy);
    }
    return q;
  }

  private columns(filter?: TimetableChangeRequestFilter) {
    return this.base(filter).select([
      'r.id',
      'r.academic_year_id',
      'r.section_id',
      'c.name as class_name',
      'sec.name as section_name',
      'r.day',
      'r.period_id',
      'p.label as period_label',
      'r.kind',
      'r.current_subject_id',
      subjectName('r.current_subject_id').as('current_subject_name'),
      'r.current_teacher_id',
      teacherName('r.current_teacher_id').as('current_teacher_name'),
      'r.proposed_subject_id',
      subjectName('r.proposed_subject_id').as('proposed_subject_name'),
      'r.proposed_teacher_id',
      teacherName('r.proposed_teacher_id').as('proposed_teacher_name'),
      'r.reason',
      'r.status',
      'r.review_note',
      userName('r.reviewed_by').as('reviewed_by_name'),
      'r.reviewed_at',
      'r.revision',
      'r.requested_by',
      userName('r.requested_by').as('requested_by_name'),
      'r.created_at',
    ]);
  }

  private toRecord(r: Record<string, unknown>): TimetableChangeRequestRecord {
    const s = (k: string) => (r[k] as string | null) ?? null;
    return {
      id: r.id as string,
      academicYearId: r.academic_year_id as string,
      sectionId: r.section_id as string,
      sectionLabel: `${r.class_name as string} ${r.section_name as string}`,
      day: r.day as Weekday,
      periodId: r.period_id as string,
      periodLabel: r.period_label as string,
      kind: r.kind as TimetableRequestKind,
      currentSubjectId: s('current_subject_id'),
      currentSubjectName: s('current_subject_name'),
      currentTeacherId: s('current_teacher_id'),
      currentTeacherName: s('current_teacher_name'),
      proposedSubjectId: s('proposed_subject_id'),
      proposedSubjectName: s('proposed_subject_name'),
      proposedTeacherId: s('proposed_teacher_id'),
      proposedTeacherName: s('proposed_teacher_name'),
      reason: r.reason as string,
      status: r.status as TimetableRequestStatus,
      reviewNote: s('review_note'),
      reviewedByName: s('reviewed_by_name'),
      reviewedAt: s('reviewed_at'),
      revision: Number(r.revision),
      requestedBy: r.requested_by as string,
      requestedByName: (s('requested_by_name') ?? '') as string,
      createdAt: r.created_at as string,
    };
  }

  find(id: string) {
    return guard(async () => {
      const row = await this.columns().where('r.id', '=', id).executeTakeFirst();
      return row ? this.toRecord(row) : null;
    });
  }

  list(filter: TimetableChangeRequestFilter) {
    return guard(async () => {
      const rows = await this.columns(filter)
        .orderBy('r.created_at', 'desc')
        .orderBy('r.id')
        .execute();
      return rows.map((r) => this.toRecord(r));
    });
  }

  count(filter: TimetableChangeRequestFilter) {
    return guard(async () => {
      const row = await this.base(filter)
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .executeTakeFirstOrThrow();
      return Number(row.n);
    });
  }

  create(r: NewTimetableChangeRequest, now: string) {
    return guard(async () => {
      await this.db
        .insertInto('timetable_change_requests')
        .values({
          id: r.id,
          academic_year_id: r.academicYearId,
          section_id: r.sectionId,
          day: r.day,
          period_id: r.periodId,
          kind: r.kind,
          current_subject_id: r.currentSubjectId,
          current_teacher_id: r.currentTeacherId,
          proposed_subject_id: r.proposedSubjectId,
          proposed_teacher_id: r.proposedTeacherId,
          reason: r.reason,
          status: 'PENDING',
          review_note: null,
          reviewed_by: null,
          reviewed_at: null,
          revision: 1,
          requested_by: r.requestedBy,
          updated_by: r.requestedBy,
          created_at: now,
          updated_at: now,
        })
        .execute();
    });
  }

  setStatus(
    id: string,
    expectedRevision: number,
    c: {
      status: TimetableRequestStatus;
      reviewNote?: string | null;
      reviewedBy?: string | null;
      reviewedAt?: string | null;
    },
    actorUserId: string,
    now: string,
  ) {
    return guard(async () => {
      const result = await this.db
        .updateTable('timetable_change_requests')
        .set((eb) => ({
          status: c.status,
          ...(c.reviewNote !== undefined ? { review_note: c.reviewNote } : {}),
          ...(c.reviewedBy !== undefined ? { reviewed_by: c.reviewedBy } : {}),
          ...(c.reviewedAt !== undefined ? { reviewed_at: c.reviewedAt } : {}),
          revision: eb('revision', '+', 1),
          updated_by: actorUserId,
          updated_at: now,
        }))
        .where('id', '=', id)
        .where('revision', '=', expectedRevision)
        .executeTakeFirst();
      return Number(result.numUpdatedRows) === 1;
    });
  }
}
