import {
  TIMETABLE_REQUEST_ACTIVE_LIMIT,
  type TimetableOperation,
  type TimetableRequestCreateSchema,
  type TimetableRequestDeclineSchema,
  type TimetableRequestList,
  type TimetableRequestListQuerySchema,
  type TimetableRequestOptions,
  type TimetableRequestReviewSchema,
  type TimetableRequestSummary,
  type TimetableRequestView,
  type TimetableRequestWithdrawSchema,
} from '@ttlmhss/shared';
import type { z } from 'zod';
import type { Principal } from '../../core/auth/access.js';
import { ConflictError, ForbiddenError, fieldConflict } from '../../core/errors/app-errors.js';
import { newId, toTimestamp } from '../../core/utils/clock.js';
import type { Repositories } from '../../data/data-store.js';
import type { AcademicYearRecord } from '../config/config.repository.js';
import type { TimetableChangeRequestRecord } from './change-requests.repository.js';
import { TimetableEditorService } from './timetable-editor.service.js';
import { checkSlot, checkTeaching } from './timetable-rules.js';
import {
  TimetableServiceBase,
  loadFrame,
  required,
  sectionRef,
  slotName,
  type RequestContext,
  type TimetableServiceDeps,
} from './timetable-service.js';

type Create = z.output<typeof TimetableRequestCreateSchema>;
type Review = z.output<typeof TimetableRequestReviewSchema>;
type Decline = z.output<typeof TimetableRequestDeclineSchema>;
type Withdraw = z.output<typeof TimetableRequestWithdrawSchema>;
type ListQuery = z.output<typeof TimetableRequestListQuerySchema>;

const STALE =
  'The timetable has changed since this request was made, so it cannot be applied as it is. Decline it (the class teacher can send a new request) or change the draft directly.';

/**
 * Timetable change requests (Phase 12C, D-122).
 *
 * - The class teacher of a section (current or open year) asks for a change to ONE lesson slot of
 *   their own section. Nothing changes until an administrator reviews it.
 * - Approval (`timetable.publish`, administrators only) applies the change to the year's DRAFT
 *   through the normal editor (`applyChanges`: section scope, qualification, teacher and class
 *   clashes are checked again). A draft is started from the published timetable when there is
 *   none. The published timetable is never touched; publishing stays a separate action.
 * - A request whose slot no longer holds the lesson it was based on is refused as stale.
 * - Every step is audited (entity `timetable_change_request`); the draft change itself is audited
 *   by the editor as usual.
 */
export class TimetableChangeRequestService extends TimetableServiceBase {
  private readonly editor: TimetableEditorService;

  constructor(deps: TimetableServiceDeps) {
    super(deps);
    this.editor = new TimetableEditorService(deps);
  }

  private canReview(p: Principal): boolean {
    return p.permissions.has('timetable.publish');
  }

  private ownSections(p: Principal, yearId: string): string[] {
    return p.classTeacherOf.filter((s) => s.academicYearId === yearId).map((s) => s.sectionId);
  }

  private async openYear(repos: Repositories, id?: string): Promise<AcademicYearRecord> {
    const year = await this.yearOrCurrent(repos, id);
    if (year.status === 'CLOSED') {
      throw new ConflictError(`${year.label} is closed. Its timetable cannot be changed.`);
    }
    return year;
  }

  private view(p: Principal, r: TimetableChangeRequestRecord): TimetableRequestView {
    const lesson = (
      sid: string | null,
      sn: string | null,
      tid: string | null,
      tn: string | null,
    ) =>
      sid && tid
        ? { subject: { id: sid, name: sn ?? '' }, teacher: { id: tid, name: tn ?? '' } }
        : null;
    return {
      id: r.id,
      academicYearId: r.academicYearId,
      section: { id: r.sectionId, label: r.sectionLabel },
      day: r.day,
      period: { id: r.periodId, label: r.periodLabel },
      kind: r.kind,
      current: lesson(
        r.currentSubjectId,
        r.currentSubjectName,
        r.currentTeacherId,
        r.currentTeacherName,
      ),
      proposed: lesson(
        r.proposedSubjectId,
        r.proposedSubjectName,
        r.proposedTeacherId,
        r.proposedTeacherName,
      ),
      reason: r.reason,
      status: r.status,
      requestedBy: r.requestedByName,
      requestedAt: r.createdAt,
      reviewNote: r.reviewNote,
      reviewedBy: r.reviewedByName,
      reviewedAt: r.reviewedAt,
      revision: r.revision,
      canReview: r.status === 'PENDING' && this.canReview(p),
      canWithdraw: r.status === 'PENDING' && r.requestedBy === p.userId,
    };
  }

  /** Who may see a request: reviewers all; class teachers those of their own sections. */
  private async readable(p: Principal, id: string): Promise<TimetableChangeRequestRecord> {
    const r = await this.repos.timetableRequests.find(id);
    if (!r || !(this.canReview(p) || this.ownSections(p, r.academicYearId).includes(r.sectionId))) {
      // Same answer for missing and out-of-scope requests.
      throw new ForbiddenError('You cannot see that timetable request.');
    }
    return r;
  }

  // ---- reading -----------------------------------------------------------------------------------

  async options(ctx: RequestContext, academicYearId?: string): Promise<TimetableRequestOptions> {
    const p = this.authorize(ctx, 'timetable.view');
    const repos = this.repos;
    const year = await repos.academicYears
      .findCurrent()
      .then(async (current) =>
        academicYearId
          ? required(await repos.academicYears.find(academicYearId), 'academic year')
          : current,
      );
    if (!year) {
      return {
        academicYear: null,
        sections: [],
        days: [],
        periods: [],
        subjects: [],
        teachers: [],
        activeCount: 0,
        activeLimit: TIMETABLE_REQUEST_ACTIVE_LIMIT,
      };
    }
    const frame = await loadFrame(repos, year);
    const own = this.ownSections(p, year.id);
    const sections = [];
    for (const id of own) {
      const ref = await sectionRef(repos, id);
      if (ref.active) sections.push({ id, label: ref.label });
    }
    const [subjects, teachers] = await Promise.all([
      repos.subjects.list(),
      repos.teachers.list({
        q: null,
        subjectId: null,
        status: 'ACTIVE',
        designation: null,
        offset: 0,
        limit: 100_000,
      }),
    ]);
    const assigned = await repos.teacherSubjects.forTeachers(teachers.rows.map((t) => t.id));
    const activeCount = await repos.timetableRequests.count({
      academicYearId: year.id,
      status: 'PENDING',
      sectionIds: null,
      requestedBy: p.userId,
    });
    return {
      academicYear: { id: year.id, label: year.label },
      sections,
      days: frame.workingDays,
      periods: frame.slots
        .filter((s) => s.kind === 'LESSON' && s.status === 'ACTIVE')
        .map((s) => ({ id: s.id, label: s.label })),
      subjects: subjects
        .filter((s) => s.status === 'ACTIVE')
        .map((s) => ({ id: s.id, name: s.name })),
      teachers: teachers.rows.map((t) => ({
        id: t.id,
        name: t.fullName,
        subjectIds: (assigned.get(t.id) ?? [])
          .filter((s) => s.status === 'ACTIVE')
          .map((s) => s.id),
      })),
      activeCount,
      activeLimit: TIMETABLE_REQUEST_ACTIVE_LIMIT,
    };
  }

  async list(ctx: RequestContext, q: ListQuery): Promise<TimetableRequestList> {
    const p = this.authorize(ctx, 'timetable.view');
    const repos = this.repos;
    const year = await this.yearOrCurrent(repos, q.academicYearId);
    const reviewer = this.canReview(p);
    const own = this.ownSections(p, year.id);
    if (!reviewer && own.length === 0) {
      throw new ForbiddenError('Only class teachers and administrators see timetable requests.');
    }
    const scope = { academicYearId: year.id, sectionIds: reviewer ? null : own, requestedBy: null };
    const [items, pending] = await Promise.all([
      repos.timetableRequests.list({ ...scope, status: q.status === 'ALL' ? null : q.status }),
      repos.timetableRequests.count({ ...scope, status: 'PENDING' }),
    ]);
    return { items: items.map((r) => this.view(p, r)), pending };
  }

  async get(ctx: RequestContext, id: string): Promise<TimetableRequestView> {
    const p = this.authorize(ctx, 'timetable.view');
    return this.view(p, await this.readable(p, id));
  }

  /** Administrator dashboard: pending requests of the current year (newest first, at most 5). */
  async summary(ctx: RequestContext): Promise<TimetableRequestSummary> {
    this.authorize(ctx, 'timetable.publish');
    const year = await this.repos.academicYears.findCurrent();
    if (!year) return { pending: 0, items: [] };
    const filter = {
      academicYearId: year.id,
      status: 'PENDING' as const,
      sectionIds: null,
      requestedBy: null,
    };
    const items = await this.repos.timetableRequests.list(filter);
    return {
      pending: items.length,
      items: items.slice(0, 5).map((r) => ({
        id: r.id,
        section: r.sectionLabel,
        day: r.day,
        period: r.periodLabel,
        kind: r.kind,
        reason: r.reason,
        requestedBy: r.requestedByName,
        requestedAt: r.createdAt,
      })),
    };
  }

  // ---- class teacher -----------------------------------------------------------------------------

  async create(ctx: RequestContext, input: Create): Promise<TimetableRequestView> {
    const p = this.authorize(ctx, 'timetable.view');
    const repos = this.repos;
    const year = await this.openYear(repos, input.academicYearId);
    if (!this.ownSections(p, year.id).includes(input.sectionId)) {
      throw new ForbiddenError('You can only request changes to the timetable of your own class.');
    }
    const section = await sectionRef(repos, input.sectionId);
    if (!section.active) throw fieldConflict('sectionId', `${section.label} is inactive.`);
    const frame = await loadFrame(repos, year);
    const field = (name: string) => name;
    checkSlot(frame, section.sectionId, input.day, input.periodId, field);

    // The lesson there now, in the timetable the class teacher sees (published).
    const published = await repos.timetable.versionWithStatus(year.id, 'PUBLISHED');
    const current = published
      ? await repos.timetable.sectionSlot(
          published.id,
          section.sectionId,
          input.day,
          input.periodId,
        )
      : null;
    const where = slotName(frame, input.day, input.periodId);
    if (input.kind === 'ADD' && current) {
      throw fieldConflict(
        'kind',
        `${where} already has ${current.subjectName} (${current.teacherName}). Ask for a change instead.`,
      );
    }
    if (input.kind !== 'ADD' && !current) {
      throw fieldConflict(
        'kind',
        `${where} has no lesson in the published timetable. Ask to add one instead.`,
      );
    }
    if (input.kind !== 'REMOVE') {
      await checkTeaching(repos, input.subjectId!, input.teacherId!, field);
      if (
        input.kind === 'CHANGE' &&
        current!.subjectId === input.subjectId &&
        current!.teacherId === input.teacherId
      ) {
        throw fieldConflict('teacherId', 'That is already the lesson in this period.');
      }
    }

    const id = newId();
    await this.write(ctx, 'timetable.view', async ({ repos: tx, now, actor, audit }) => {
      const mine = await tx.timetableRequests.count({
        academicYearId: year.id,
        status: 'PENDING',
        sectionIds: null,
        requestedBy: actor.userId,
      });
      if (mine >= TIMETABLE_REQUEST_ACTIVE_LIMIT) {
        throw new ConflictError(
          `You already have ${TIMETABLE_REQUEST_ACTIVE_LIMIT} timetable requests waiting. Please wait for some of them to be reviewed.`,
        );
      }
      const waiting = await tx.timetableRequests.list({
        academicYearId: year.id,
        status: 'PENDING',
        sectionIds: [section.sectionId],
        requestedBy: null,
      });
      if (waiting.some((w) => w.day === input.day && w.periodId === input.periodId)) {
        throw fieldConflict('periodId', `A request for ${where} is already waiting for review.`);
      }
      const record = {
        id,
        academicYearId: year.id,
        sectionId: section.sectionId,
        day: input.day,
        periodId: input.periodId,
        kind: input.kind,
        currentSubjectId: current?.subjectId ?? null,
        currentTeacherId: current?.teacherId ?? null,
        proposedSubjectId: input.kind === 'REMOVE' ? null : input.subjectId,
        proposedTeacherId: input.kind === 'REMOVE' ? null : input.teacherId,
        reason: input.reason,
        requestedBy: actor.userId,
      };
      await tx.timetableRequests.create(record, now);
      await audit({
        action: 'timetable.change_requested',
        entityType: 'timetable_change_request',
        entityId: id,
        after: { ...record, section: section.label, slot: where },
      });
    });
    return this.view(p, required(await this.repos.timetableRequests.find(id), 'request'));
  }

  async withdraw(ctx: RequestContext, id: string, input: Withdraw): Promise<TimetableRequestView> {
    const p = this.authorize(ctx, 'timetable.view');
    const r = await this.readable(p, id);
    if (r.requestedBy !== p.userId)
      throw new ForbiddenError('Only the person who asked can withdraw a request.');
    await this.transition(
      ctx,
      'timetable.view',
      r,
      input.revision,
      { status: 'WITHDRAWN' },
      'timetable.change_request_withdrawn',
    );
    return this.get(ctx, id);
  }

  // ---- administrator -----------------------------------------------------------------------------

  async decline(ctx: RequestContext, id: string, input: Decline): Promise<TimetableRequestView> {
    this.authorize(ctx, 'timetable.publish');
    const r = required(await this.repos.timetableRequests.find(id), 'timetable request');
    const now = toTimestamp(this.deps.clock.now());
    await this.transition(
      ctx,
      'timetable.publish',
      r,
      input.revision,
      {
        status: 'DECLINED',
        reviewNote: input.note,
        reviewedBy: ctx.principal!.userId,
        reviewedAt: now,
      },
      'timetable.change_request_declined',
    );
    return this.get(ctx, id);
  }

  async approve(ctx: RequestContext, id: string, input: Review): Promise<TimetableRequestView> {
    const p = this.authorize(ctx, 'timetable.publish');
    const repos = this.repos;
    const r = required(await repos.timetableRequests.find(id), 'timetable request');
    if (r.status !== 'PENDING')
      throw new ConflictError('This request has already been dealt with.');
    if (r.revision !== input.revision) {
      throw new ConflictError('This request was changed by someone else. Reload and try again.');
    }
    const year = await this.openYear(repos, r.academicYearId);
    let draft = await repos.timetable.versionWithStatus(year.id, 'DRAFT');
    if (!draft) {
      await this.editor.startDraft(ctx, year.id);
      draft = required(await repos.timetable.versionWithStatus(year.id, 'DRAFT'), 'draft');
    }
    // Stale check: the slot in the draft must still hold the lesson the request was based on.
    const now = await repos.timetable.sectionSlot(draft.id, r.sectionId, r.day, r.periodId);
    const same =
      r.kind === 'ADD'
        ? now === null
        : now !== null &&
          now.subjectId === r.currentSubjectId &&
          now.teacherId === r.currentTeacherId;
    if (!same) throw new ConflictError(STALE);

    const op: TimetableOperation =
      r.kind === 'ADD'
        ? {
            op: 'create',
            id: newId(),
            day: r.day,
            periodId: r.periodId,
            sectionId: r.sectionId,
            subjectId: r.proposedSubjectId!,
            teacherId: r.proposedTeacherId!,
          }
        : r.kind === 'CHANGE'
          ? {
              op: 'update',
              entryId: now!.id,
              subjectId: r.proposedSubjectId!,
              teacherId: r.proposedTeacherId!,
            }
          : { op: 'remove', entryId: now!.id };
    // The normal editor: scope, qualification and clash checks, its own audit entries.
    await this.editor.applyChanges(ctx, year.id, {
      sectionId: r.sectionId,
      operations: [op],
      dryRun: false,
    });

    await this.transition(
      ctx,
      'timetable.publish',
      r,
      input.revision,
      {
        status: 'APPROVED',
        reviewNote: input.note,
        reviewedBy: p.userId,
        reviewedAt: toTimestamp(this.deps.clock.now()),
      },
      'timetable.change_request_approved',
      { draftVersion: draft.versionNumber },
    );
    return this.get(ctx, id);
  }

  private async transition(
    ctx: RequestContext,
    permission: 'timetable.view' | 'timetable.publish',
    r: TimetableChangeRequestRecord,
    revision: number,
    change: Parameters<Repositories['timetableRequests']['setStatus']>[2],
    action: string,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    if (r.status !== 'PENDING')
      throw new ConflictError('This request has already been dealt with.');
    await this.write(ctx, permission, async ({ repos, now, actor, audit }) => {
      const ok = await repos.timetableRequests.setStatus(r.id, revision, change, actor.userId, now);
      if (!ok)
        throw new ConflictError('This request was changed by someone else. Reload and try again.');
      await audit({
        action,
        entityType: 'timetable_change_request',
        entityId: r.id,
        before: { status: r.status },
        after: { status: change.status, note: change.reviewNote ?? null, ...extra },
      });
    });
  }
}
