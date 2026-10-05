import type { Kysely } from 'kysely';
import type { ProfileField, RequestStatus, RequestType, UserRole } from '@ttlmhss/shared';
import type {
  NewRequest,
  RequestChange,
  RequestFilter,
  RequestRecord,
  RequestRepository,
} from '../../../../modules/requests/requests.repository.js';
import type { Database } from '../../database-schema.js';
import { guard } from '../../db-errors.js';
import { userName } from './announcements.repository.js';

export class KyselyRequestRepository implements RequestRepository {
  constructor(private readonly db: Kysely<Database>) {}

  private base() {
    return this.db
      .selectFrom('requests as r')
      .innerJoin('academic_years as y', 'y.id', 'r.academic_year_id')
      .innerJoin('students as st', 'st.id', 'r.student_id')
      .innerJoin('enrolments as e', 'e.id', 'r.enrolment_id')
      .innerJoin('sections as sec', 'sec.id', 'r.section_id')
      .innerJoin('classes as c', 'c.id', 'sec.class_id')
      .leftJoin('periods as p', 'p.id', 'r.related_period_id')
      .leftJoin('subjects as sub', 'sub.id', 'r.related_subject_id')
      .leftJoin('exams as ex', 'ex.id', 'r.related_exam_id');
  }

  private columns() {
    return this.base().select([
      'r.id',
      'r.type',
      'r.status',
      'r.academic_year_id',
      'y.label as year_label',
      'y.status as year_status',
      'r.student_id',
      'st.full_name',
      'st.admission_number',
      'e.roll_number',
      'r.enrolment_id',
      'r.section_id',
      'sec.name as section_name',
      'c.id as class_id',
      'c.name as class_name',
      'r.requested_by',
      userName('r.requested_by').as('requester_name'),
      'r.requester_role',
      'r.summary',
      'r.description',
      'r.related_date',
      'r.related_period_id',
      'p.label as period_label',
      'r.related_subject_id',
      'sub.name as subject_name',
      'r.related_exam_id',
      'ex.name as exam_name',
      'r.profile_field',
      'r.assigned_to',
      userName('r.assigned_to').as('assigned_name'),
      'r.resolution_note',
      'r.resolved_at',
      userName('r.resolved_by').as('resolved_by_name'),
      'r.closed_at',
      'r.revision',
      'r.created_at',
      'r.updated_at',
    ]);
  }

  private toRecord(r: Record<string, unknown>): RequestRecord {
    const s = (k: string) => (r[k] as string | null) ?? null;
    return {
      id: r.id as string,
      type: r.type as RequestType,
      status: r.status as RequestStatus,
      academicYearId: r.academic_year_id as string,
      yearLabel: r.year_label as string,
      yearStatus: r.year_status as string,
      studentId: r.student_id as string,
      fullName: r.full_name as string,
      admissionNumber: r.admission_number as string,
      rollNumber: s('roll_number'),
      enrolmentId: r.enrolment_id as string,
      sectionId: r.section_id as string,
      sectionName: r.section_name as string,
      classId: r.class_id as string,
      className: r.class_name as string,
      requestedBy: r.requested_by as string,
      requesterName: (r.requester_name as string | null) ?? '',
      requesterRole: r.requester_role as UserRole,
      summary: r.summary as string,
      description: r.description as string,
      relatedDate: s('related_date'),
      relatedPeriodId: s('related_period_id'),
      relatedPeriodLabel: s('period_label'),
      relatedSubjectId: s('related_subject_id'),
      relatedSubjectName: s('subject_name'),
      relatedExamId: s('related_exam_id'),
      relatedExamName: s('exam_name'),
      profileField: s('profile_field') as ProfileField | null,
      assignedTo: s('assigned_to'),
      assignedName: s('assigned_name'),
      resolutionNote: s('resolution_note'),
      resolvedAt: s('resolved_at'),
      resolvedByName: s('resolved_by_name'),
      closedAt: s('closed_at'),
      revision: Number(r.revision),
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
    };
  }

  find(id: string) {
    return guard(async () => {
      const row = await this.columns().where('r.id', '=', id).executeTakeFirst();
      return row ? this.toRecord(row) : null;
    });
  }

  private filtered(f: Omit<RequestFilter, 'offset' | 'limit'>) {
    let q = this.columns();
    if (f.academicYearId) q = q.where('r.academic_year_id', '=', f.academicYearId);
    if (f.studentId) q = q.where('r.student_id', '=', f.studentId);
    if (f.sectionIds) q = q.where('r.section_id', 'in', f.sectionIds.length ? f.sectionIds : ['']);
    if (f.types) q = q.where('r.type', 'in', f.types.length ? f.types : ['']);
    if (f.statuses) q = q.where('r.status', 'in', f.statuses.length ? f.statuses : ['']);
    if (f.from) q = q.where('r.created_at', '>=', f.from);
    if (f.to) q = q.where('r.created_at', '<=', f.to);
    return q;
  }

  list(f: RequestFilter) {
    return guard(async () => {
      const q = this.filtered(f);
      const total = await q
        .clearSelect()
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .executeTakeFirst();
      const rows = await q
        .orderBy('r.updated_at', 'desc')
        .orderBy('r.id')
        .offset(f.offset)
        .limit(f.limit)
        .execute();
      return { rows: rows.map((r) => this.toRecord(r)), total: Number(total?.n ?? 0) };
    });
  }

  count(f: Omit<RequestFilter, 'offset' | 'limit'>) {
    return guard(async () => {
      const total = await this.filtered(f)
        .clearSelect()
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .executeTakeFirst();
      return Number(total?.n ?? 0);
    });
  }

  create(r: NewRequest, now: string) {
    return guard(async () => {
      await this.db
        .insertInto('requests')
        .values({
          id: r.id,
          type: r.type,
          status: 'OPEN',
          academic_year_id: r.academicYearId,
          student_id: r.studentId,
          enrolment_id: r.enrolmentId,
          section_id: r.sectionId,
          requested_by: r.requestedBy,
          requester_role: r.requesterRole,
          summary: r.summary,
          description: r.description,
          related_date: r.relatedDate,
          related_period_id: r.relatedPeriodId,
          related_subject_id: r.relatedSubjectId,
          related_exam_id: r.relatedExamId,
          profile_field: r.profileField,
          assigned_to: r.assignedTo,
          resolution_note: null,
          resolved_at: null,
          resolved_by: null,
          closed_at: null,
          closed_by: null,
          revision: 1,
          created_at: now,
          updated_at: now,
        })
        .execute();
    });
  }

  update(id: string, expectedRevision: number, c: RequestChange, now: string) {
    return guard(async () => {
      const result = await this.db
        .updateTable('requests')
        .set((eb) => ({
          ...(c.status !== undefined ? { status: c.status } : {}),
          ...(c.assignedTo !== undefined ? { assigned_to: c.assignedTo } : {}),
          ...(c.resolutionNote !== undefined ? { resolution_note: c.resolutionNote } : {}),
          ...(c.resolvedAt !== undefined ? { resolved_at: c.resolvedAt } : {}),
          ...(c.resolvedBy !== undefined ? { resolved_by: c.resolvedBy } : {}),
          ...(c.closedAt !== undefined ? { closed_at: c.closedAt } : {}),
          ...(c.closedBy !== undefined ? { closed_by: c.closedBy } : {}),
          revision: eb('revision', '+', 1),
          updated_at: now,
        }))
        .where('id', '=', id)
        .where('revision', '=', expectedRevision)
        .executeTakeFirst();
      return Number(result.numUpdatedRows) === 1;
    });
  }
}
