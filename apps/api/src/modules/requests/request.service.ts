import {
  PROFILE_FIELD_LABELS,
  REQUEST_STATUS_LABELS,
  type AcademicYearStatus,
  type RequestAssignSchema,
  type RequestCreateSchema,
  type RequestDetail,
  type RequestFormOptions,
  type RequestList,
  type RequestListQuerySchema,
  type RequestStatus,
  type RequestStatusChangeSchema,
  type RequestType,
  type RequestView,
} from '@ttlmhss/shared';
import type { z } from 'zod';
import type { Principal } from '../../core/auth/access.js';
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  fieldConflict,
} from '../../core/errors/app-errors.js';
import { newId } from '../../core/utils/clock.js';
import type { Repositories } from '../../data/data-store.js';
import { AttendanceViewService } from '../attendance/attendance-views.service.js';
import {
  MarksServiceBase,
  type MarksServiceDeps,
  type RequestContext,
} from '../marks/marks-context.js';
import { ResultsService } from '../marks/results.service.js';
import type { RequestChange, RequestRecord } from './requests.repository.js';

/** A student may have at most this many requests Open or In review at once (D-97). */
export const ACTIVE_REQUEST_LIMIT = 10;

const NO_ACCESS = 'You do not have access to this request.';
const STALE =
  'This request was changed by someone else after you opened it. Reload it to see the latest state, then try again.';
const ACTIVE: RequestStatus[] = ['OPEN', 'IN_REVIEW'];
/** Types a class teacher handles for their own section; profile corrections are administrator-only. */
const CLASS_TEACHER_TYPES: RequestType[] = ['ATTENDANCE_ISSUE', 'RESULT_CLARIFICATION'];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const longDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return `${d} ${MONTHS[m - 1]} ${y}`;
};

/** School-local (IST) date bounds as UTC timestamps, for "created on" filters. */
const dayStart = (date: string) => new Date(`${date}T00:00:00.000+05:30`).toISOString();
const dayEnd = (date: string) => new Date(`${date}T23:59:59.999+05:30`).toISOString();

const HISTORY_ACTIONS: Record<string, string> = {
  'request.created': 'Request created',
  'request.review_started': 'Review started',
  'request.assigned': 'Assignment changed',
  'request.resolved': 'Resolved',
  'request.closed': 'Closed',
  'request.reopened': 'Reopened',
};

/**
 * Structured student requests (Phase 10, BR-RQ). Students create and read their OWN requests
 * (attendance issue, result clarification, profile correction). Reviewers:
 *   - administrators: every request;
 *   - the class teacher of the request's section (this academic year) with `requests.view` /
 *     `requests.handle`: attendance issues and result clarifications of their own section;
 *   - subject teachers: none (D-95).
 * Routing on creation: attendance issues and result clarifications are assigned to the section's
 * class teacher (administrators see them too); profile corrections go to administrators.
 * Handling a request changes only the request — never attendance, marks or the profile; the
 * reviewer uses the existing pages for any correction. Every change is audited (entity `request`).
 */
export class RequestService extends MarksServiceBase {
  private readonly attendance: AttendanceViewService;
  private readonly results: ResultsService;

  constructor(deps: MarksServiceDeps) {
    super(deps);
    this.attendance = new AttendanceViewService(deps);
    this.results = new ResultsService(deps);
  }

  // ---- Scope ----------------------------------------------------------------------------------

  private ownSections(p: Principal, yearId: string) {
    return p.classTeacherOf.filter((s) => s.academicYearId === yearId).map((s) => s.sectionId);
  }

  /** Staff reading scope in a year: null = no access; sectionIds/types null = unrestricted. */
  private staffScope(p: Principal, yearId: string) {
    if (p.studentId) return null;
    if (this.isAdmin(p)) return { sectionIds: null, types: null };
    const own = this.ownSections(p, yearId);
    if (!p.permissions.has('requests.view') || own.length === 0) return null;
    return { sectionIds: own, types: CLASS_TEACHER_TYPES };
  }

  private inStaffScope(p: Principal, r: RequestRecord) {
    const scope = this.staffScope(p, r.academicYearId);
    if (!scope) return false;
    return (
      (scope.sectionIds === null || scope.sectionIds.includes(r.sectionId)) &&
      (scope.types === null || scope.types.includes(r.type))
    );
  }

  private canHandle(p: Principal, r: RequestRecord) {
    if (this.isAdmin(p)) return true;
    return p.permissions.has('requests.handle') && this.inStaffScope(p, r);
  }

  private canView(p: Principal, r: RequestRecord) {
    if (p.studentId) return r.studentId === p.studentId;
    return this.inStaffScope(p, r);
  }

  private toView(p: Principal, r: RequestRecord): RequestView {
    const handle = !p.studentId && this.canHandle(p, r);
    return {
      id: r.id,
      reference: `RQ-${r.id.slice(0, 8).toUpperCase()}`,
      type: r.type,
      status: r.status,
      summary: r.summary,
      academicYear: {
        id: r.academicYearId,
        label: r.yearLabel,
        status: r.yearStatus as AcademicYearStatus,
      },
      student: {
        id: r.studentId,
        fullName: r.fullName,
        admissionNumber: r.admissionNumber,
        rollNumber: r.rollNumber,
      },
      section: {
        sectionId: r.sectionId,
        sectionName: r.sectionName,
        classId: r.classId,
        className: r.className,
      },
      requester: { name: r.requesterName, role: r.requesterRole },
      related: {
        date: r.relatedDate,
        period:
          r.relatedPeriodId && r.relatedPeriodLabel
            ? { id: r.relatedPeriodId, label: r.relatedPeriodLabel }
            : null,
        subject:
          r.relatedSubjectId && r.relatedSubjectName
            ? { id: r.relatedSubjectId, name: r.relatedSubjectName }
            : null,
        exam:
          r.relatedExamId && r.relatedExamName
            ? { id: r.relatedExamId, name: r.relatedExamName }
            : null,
        field: r.profileField,
      },
      description: r.description,
      assignedTo:
        r.assignedTo && r.assignedName ? { userId: r.assignedTo, name: r.assignedName } : null,
      resolutionNote: r.resolutionNote,
      resolvedBy: r.resolvedByName,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      resolvedAt: r.resolvedAt,
      closedAt: r.closedAt,
      revision: r.revision,
      actions: {
        startReview: handle && r.status === 'OPEN',
        resolve: handle && ACTIVE.includes(r.status),
        close: handle && r.status !== 'CLOSED',
        reopen: handle && (r.status === 'RESOLVED' || r.status === 'CLOSED'),
        assign: handle && this.isAdmin(p) && r.status !== 'CLOSED',
      },
    };
  }

  // ---- Reading --------------------------------------------------------------------------------

  /** Reviewers' list (administrators: all; class teachers: their own section's requests). */
  async list(
    ctx: RequestContext,
    q: z.output<typeof RequestListQuerySchema>,
  ): Promise<RequestList> {
    const p = this.authorize(ctx, 'requests.view');
    if (p.studentId) throw new ForbiddenError('Students see their own requests under My requests.');
    const repos = this.repos;
    const year = q.academicYearId
      ? await repos.academicYears.find(q.academicYearId)
      : await repos.academicYears.findCurrent();
    const scope = this.staffScope(p, year?.id ?? '');
    if (!scope) throw new ForbiddenError('You do not have access to requests.');
    let sectionIds = scope.sectionIds;
    if (q.sectionId)
      sectionIds = sectionIds ? sectionIds.filter((s) => s === q.sectionId) : [q.sectionId];
    let types = scope.types;
    if (q.type) types = types ? types.filter((t) => t === q.type) : [q.type];
    const { rows, total } = await repos.requests.list({
      academicYearId: year?.id ?? null,
      studentId: null,
      sectionIds,
      types,
      statuses: q.status === 'ALL' ? null : q.status === 'ACTIVE' ? ACTIVE : [q.status],
      from: q.from ? dayStart(q.from) : null,
      to: q.to ? dayEnd(q.to) : null,
      offset: (q.page - 1) * q.pageSize,
      limit: q.pageSize,
    });
    return { items: rows.map((r) => this.toView(p, r)), page: q.page, pageSize: q.pageSize, total };
  }

  /** The signed-in student's own requests (every year, newest activity first). */
  async mine(
    ctx: RequestContext,
    q: z.output<typeof RequestListQuerySchema>,
  ): Promise<RequestList> {
    const p = this.authorize(ctx, 'requests.view');
    if (!p.studentId) throw new ForbiddenError('Only students have their own requests.');
    const { rows, total } = await this.repos.requests.list({
      academicYearId: q.academicYearId ?? null,
      studentId: p.studentId,
      sectionIds: null,
      types: q.type ? [q.type] : null,
      statuses: q.status === 'ALL' ? null : q.status === 'ACTIVE' ? ACTIVE : [q.status],
      from: q.from ? dayStart(q.from) : null,
      to: q.to ? dayEnd(q.to) : null,
      offset: (q.page - 1) * q.pageSize,
      limit: q.pageSize,
    });
    return { items: rows.map((r) => this.toView(p, r)), page: q.page, pageSize: q.pageSize, total };
  }

  /** Active (Open + In review) requests the caller can see — dashboard counts. */
  async activeCount(ctx: RequestContext): Promise<number> {
    const p = this.authorize(ctx, 'requests.view');
    const repos = this.repos;
    if (p.studentId) {
      return repos.requests.count({
        academicYearId: null,
        studentId: p.studentId,
        sectionIds: null,
        types: null,
        statuses: ACTIVE,
        from: null,
        to: null,
      });
    }
    const year = await repos.academicYears.findCurrent();
    const scope = this.staffScope(p, year?.id ?? '');
    if (!scope || !year) return 0;
    return repos.requests.count({
      academicYearId: year.id,
      studentId: null,
      ...scope,
      statuses: ACTIVE,
      from: null,
      to: null,
    });
  }

  async get(ctx: RequestContext, id: string): Promise<RequestDetail> {
    const p = this.authorize(ctx, 'requests.view');
    const repos = this.repos;
    const r = await repos.requests.find(id);
    if (!r || !this.canView(p, r)) {
      if (!r && this.isAdmin(p)) throw new NotFoundError('That request was not found.');
      throw new ForbiddenError(NO_ACCESS);
    }
    const staff = !p.studentId;
    return {
      request: this.toView(p, r),
      history: staff ? await this.history(repos, r.id) : [],
      assignees:
        staff && this.isAdmin(p) && r.status !== 'CLOSED' ? await this.assignees(repos, r) : [],
    };
  }

  private async history(repos: Repositories, id: string): Promise<RequestDetail['history']> {
    const logs = await repos.auditLogs.listForEntity('request', id, 200);
    const names = new Map<string, string>();
    for (const l of logs) {
      if (l.actorUserId && !names.has(l.actorUserId)) {
        const u = await repos.userAccounts.findById(l.actorUserId);
        names.set(l.actorUserId, u?.displayName ?? 'Unknown user');
      }
    }
    return [...logs]
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
      .map((l) => {
        const after = (l.after ?? {}) as Record<string, unknown>;
        const status = after.status as RequestStatus | undefined;
        const assignee = after.assignedToName as string | null | undefined;
        const summary =
          l.action === 'request.assigned'
            ? assignee
              ? `Assigned to ${assignee}`
              : 'Unassigned'
            : status
              ? `Status: ${REQUEST_STATUS_LABELS[status]}`
              : '';
        return {
          at: l.occurredAt,
          actor: l.actorUserId ? (names.get(l.actorUserId) ?? null) : null,
          action: HISTORY_ACTIONS[l.action] ?? l.action,
          summary,
          note: l.reason,
        };
      });
  }

  /** Administrators may assign to an active administrator or the section's class teacher. */
  private async assignees(repos: Repositories, r: RequestRecord) {
    const admins = await repos.userAccounts.listActiveByRole('ADMIN');
    const out = admins.map((u) => ({ userId: u.id, name: u.displayName }));
    if (r.type !== 'PROFILE_CORRECTION') {
      const ct = await this.classTeacherUser(repos, r.academicYearId, r.sectionId);
      if (ct && !out.some((o) => o.userId === ct.userId)) out.push(ct);
    }
    return out;
  }

  private async classTeacherUser(repos: Repositories, yearId: string, sectionId: string) {
    const assignment = await repos.classTeachers.findActiveForSection(yearId, sectionId);
    if (!assignment) return null;
    const teacher = await repos.teachers.find(assignment.teacherId);
    if (!teacher || teacher.status !== 'ACTIVE') return null;
    return { userId: teacher.userId, name: teacher.fullName };
  }

  // ---- Students: creating ---------------------------------------------------------------------

  private async studentYear(repos: Repositories, p: Principal) {
    const year = await repos.academicYears.findCurrent();
    if (!year) return { year: null, placement: null };
    const placement = await repos.enrolments.findActive(p.studentId!, year.id);
    return { year, placement };
  }

  /** Exams the student may see results for (Phase 8B visibility) with their own subjects. */
  private async studentExams(ctx: RequestContext, yearId: string) {
    const exams = (await this.results.myExams(ctx, yearId)).exams;
    const out: RequestFormOptions['exams'] = [];
    for (const exam of exams) {
      try {
        const result = await this.results.myResult(ctx, exam.id);
        out.push({
          id: exam.id,
          name: exam.name,
          subjects: result.subjects.map((s) => ({ id: s.subjectId, name: s.subjectName })),
        });
      } catch (error) {
        // The student did not sit this exam (not placed in a class that takes it).
        if (!(error instanceof AppError)) throw error;
      }
    }
    return out;
  }

  async formOptions(ctx: RequestContext): Promise<RequestFormOptions> {
    const p = this.authorize(ctx, 'requests.create');
    if (!p.studentId) throw new ForbiddenError('Only students create requests.');
    const repos = this.repos;
    const { year, placement } = await this.studentYear(repos, p);
    const activeCount = await this.activeCount(ctx);
    if (!year || !placement) {
      return {
        academicYear: year ? { id: year.id, label: year.label, status: year.status } : null,
        section: null,
        exams: [],
        attendanceFrom: null,
        attendanceTo: null,
        activeCount,
        activeLimit: ACTIVE_REQUEST_LIMIT,
      };
    }
    const today = this.today();
    return {
      academicYear: { id: year.id, label: year.label, status: year.status },
      section: {
        sectionId: placement.sectionId,
        sectionName: placement.sectionName,
        classId: placement.classId,
        className: placement.className,
      },
      exams: await this.studentExams(ctx, year.id),
      attendanceFrom: year.startDate,
      attendanceTo: today < year.endDate ? today : year.endDate,
      activeCount,
      activeLimit: ACTIVE_REQUEST_LIMIT,
    };
  }

  async create(
    ctx: RequestContext,
    input: z.output<typeof RequestCreateSchema>,
  ): Promise<RequestDetail> {
    const p = this.authorize(ctx, 'requests.create');
    if (!p.studentId) throw new ForbiddenError('Only students create requests.');
    const repos = this.repos;
    const { year, placement } = await this.studentYear(repos, p);
    if (!year || !placement) {
      throw new ConflictError(
        'You are not placed in a class this academic year, so requests cannot be sent. Please contact the school office.',
      );
    }

    // What the request refers to — resolved and checked by the server from the student's own data.
    let summary: string;
    const related = {
      relatedDate: null as string | null,
      relatedPeriodId: null as string | null,
      relatedSubjectId: null as string | null,
      relatedExamId: null as string | null,
      profileField: null as RequestRecord['profileField'],
    };
    if (input.type === 'ATTENDANCE_ISSUE') {
      if (input.date < year.startDate || input.date > year.endDate) {
        throw fieldConflict('date', `Choose a date within ${year.label}.`);
      }
      if (input.date > this.today()) {
        throw fieldConflict('date', 'You can only ask about attendance that has already happened.');
      }
      const day = await this.attendance.myDay(ctx, input.date);
      const lesson = day.lessons.find((l) => l.period.id === input.periodId);
      if (!lesson) {
        throw fieldConflict('periodId', 'You had no lesson in that period on that date.');
      }
      summary = `Attendance on ${longDate(input.date)}, ${lesson.period.label} (${lesson.subject.name})`;
      related.relatedDate = input.date;
      related.relatedPeriodId = lesson.period.id;
      related.relatedSubjectId = lesson.subject.id;
    } else if (input.type === 'RESULT_CLARIFICATION') {
      const exam = (await this.studentExams(ctx, year.id)).find((e) => e.id === input.examId);
      if (!exam) throw fieldConflict('examId', 'Choose one of your exams.');
      const subject = exam.subjects.find((s) => s.id === input.subjectId);
      if (!subject) throw fieldConflict('subjectId', 'Choose a subject of that exam.');
      summary = `${exam.name} — ${subject.name}`;
      related.relatedExamId = exam.id;
      related.relatedSubjectId = subject.id;
    } else {
      summary = `Profile: ${PROFILE_FIELD_LABELS[input.field]}`;
      related.profileField = input.field;
    }

    const id = newId();
    await this.write(ctx, 'requests.create', async ({ repos: tx, actor, now, audit }) => {
      const active = await tx.requests.count({
        academicYearId: null,
        studentId: actor.studentId,
        sectionIds: null,
        types: null,
        statuses: ACTIVE,
        from: null,
        to: null,
      });
      if (active >= ACTIVE_REQUEST_LIMIT) {
        throw new ConflictError(
          `You already have ${ACTIVE_REQUEST_LIMIT} requests waiting. Please wait for some of them to be resolved first.`,
        );
      }
      // Routing (D-95): attendance and result questions go to the section's class teacher;
      // profile corrections to administrators (unassigned = the administrators' queue).
      const classTeacher =
        input.type === 'PROFILE_CORRECTION'
          ? null
          : await this.classTeacherUser(tx, year.id, placement.sectionId);
      await tx.requests.create(
        {
          id,
          type: input.type,
          academicYearId: year.id,
          studentId: actor.studentId!,
          enrolmentId: placement.enrolmentId,
          sectionId: placement.sectionId,
          requestedBy: actor.userId,
          requesterRole: 'STUDENT',
          summary,
          description: input.description,
          ...related,
          assignedTo: classTeacher?.userId ?? null,
        },
        now,
      );
      await audit({
        action: 'request.created',
        entityType: 'request',
        entityId: id,
        after: {
          type: input.type,
          status: 'OPEN',
          studentId: actor.studentId,
          academicYearId: year.id,
          sectionId: placement.sectionId,
          summary,
          ...related,
          description: input.description,
          assignedTo: classTeacher?.userId ?? null,
          assignedToName: classTeacher?.name ?? null,
        },
      });
    });
    return this.get(ctx, id);
  }

  // ---- Reviewers: workflow --------------------------------------------------------------------

  private async handled(repos: Repositories, p: Principal, id: string) {
    const r = await repos.requests.find(id);
    if (!r || !this.canHandle(p, r) || p.studentId) {
      if (!r && this.isAdmin(p)) throw new NotFoundError('That request was not found.');
      throw new ForbiddenError(NO_ACCESS);
    }
    return r;
  }

  /**
   * Open → In review → Resolved → Closed; Resolved/Closed → Open (reopen). Resolving, closing an
   * unresolved request and reopening need a note. Changes the request only.
   */
  async changeStatus(
    ctx: RequestContext,
    id: string,
    input: z.output<typeof RequestStatusChangeSchema>,
  ): Promise<RequestDetail> {
    await this.write(ctx, 'requests.handle', async ({ repos, actor, now, audit }) => {
      const r = await this.handled(repos, actor, id);
      const note = input.note;
      const needNote = (message: string) => {
        if (!note || note.length < 5) throw fieldConflict('note', message);
      };
      let change: RequestChange;
      let action: string;
      switch (input.status) {
        case 'IN_REVIEW':
          if (r.status !== 'OPEN')
            throw new ConflictError('Only an open request can be taken into review.');
          change = { status: 'IN_REVIEW', assignedTo: r.assignedTo ?? actor.userId };
          action = 'request.review_started';
          break;
        case 'RESOLVED':
          if (!ACTIVE.includes(r.status)) {
            throw new ConflictError('Only an open or in-review request can be resolved.');
          }
          needNote(
            'Write the resolution (at least 5 characters) so the student knows the outcome.',
          );
          change = {
            status: 'RESOLVED',
            resolutionNote: note,
            resolvedAt: now,
            resolvedBy: actor.userId,
          };
          action = 'request.resolved';
          break;
        case 'CLOSED':
          if (r.status === 'CLOSED') throw new ConflictError('This request is already closed.');
          change = { status: 'CLOSED', closedAt: now, closedBy: actor.userId };
          if (r.status !== 'RESOLVED') {
            needNote('Say why the request is closed without a resolution (at least 5 characters).');
            change.resolutionNote = note;
          }
          action = 'request.closed';
          break;
        case 'OPEN':
          if (r.status !== 'RESOLVED' && r.status !== 'CLOSED') {
            throw new ConflictError('Only a resolved or closed request can be reopened.');
          }
          needNote('Say why the request is reopened (at least 5 characters).');
          change = {
            status: 'OPEN',
            resolutionNote: null,
            resolvedAt: null,
            resolvedBy: null,
            closedAt: null,
            closedBy: null,
          };
          action = 'request.reopened';
          break;
      }
      if (!(await repos.requests.update(id, input.revision, change, now))) {
        throw new ConflictError(STALE);
      }
      await audit({
        action,
        entityType: 'request',
        entityId: id,
        before: { status: r.status, assignedTo: r.assignedTo, resolutionNote: r.resolutionNote },
        after: {
          status: change.status,
          assignedTo: change.assignedTo !== undefined ? change.assignedTo : r.assignedTo,
          resolutionNote:
            change.resolutionNote !== undefined ? change.resolutionNote : r.resolutionNote,
        },
        reason: note,
      });
    });
    return this.get(ctx, id);
  }

  async assign(
    ctx: RequestContext,
    id: string,
    input: z.output<typeof RequestAssignSchema>,
  ): Promise<RequestDetail> {
    await this.write(ctx, 'requests.handle', async ({ repos, actor, now, audit }) => {
      const r = await this.handled(repos, actor, id);
      if (!this.isAdmin(actor)) throw new ForbiddenError('Only administrators assign requests.');
      if (r.status === 'CLOSED') throw new ConflictError('A closed request cannot be reassigned.');
      let name: string | null = null;
      if (input.assigneeUserId) {
        const choice = (await this.assignees(repos, r)).find(
          (a) => a.userId === input.assigneeUserId,
        );
        if (!choice) {
          throw fieldConflict(
            'assigneeUserId',
            "Assign to an administrator or the class teacher of the student's section.",
          );
        }
        name = choice.name;
      }
      if ((r.assignedTo ?? null) === input.assigneeUserId) return;
      if (
        !(await repos.requests.update(
          id,
          input.revision,
          { assignedTo: input.assigneeUserId },
          now,
        ))
      ) {
        throw new ConflictError(STALE);
      }
      await audit({
        action: 'request.assigned',
        entityType: 'request',
        entityId: id,
        before: { assignedTo: r.assignedTo, assignedToName: r.assignedName },
        after: { assignedTo: input.assigneeUserId, assignedToName: name },
      });
    });
    return this.get(ctx, id);
  }
}
