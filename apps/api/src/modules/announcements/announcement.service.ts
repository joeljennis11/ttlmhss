import {
  ANNOUNCEMENT_AUDIENCE_LABELS,
  type AcademicYearStatus,
  type AnnouncementAudience,
  type AnnouncementCreateSchema,
  type AnnouncementFeedQuerySchema,
  type AnnouncementInputSchema,
  type AnnouncementList,
  type AnnouncementListQuerySchema,
  type AnnouncementOptionsView,
  type AnnouncementView,
} from '@ttlmhss/shared';
import type { z } from 'zod';
import type { Principal } from '../../core/auth/access.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  fieldConflict,
} from '../../core/errors/app-errors.js';
import { newId } from '../../core/utils/clock.js';
import type { Repositories } from '../../data/data-store.js';
import { MarksServiceBase, type RequestContext } from '../marks/marks-context.js';
import type { AnnouncementRecord, AnnouncementValues } from './announcements.repository.js';

type Input = z.output<typeof AnnouncementInputSchema>;

const NO_ACCESS = 'You do not have access to this announcement.';
const OWN_SECTION_ONLY =
  'Class teachers can post announcements only to their own class section. Ask an administrator for anything wider.';

/**
 * Announcements (Phase 10, BR-AN). A structured audience — whole school, teachers/staff, a class or
 * a section — in an academic year. Draft → Published → Archived (never deleted); an optional expiry
 * date hides it from its audience afterwards.
 *
 * Who writes: administrators (any audience); class teachers holding `announcements.manage` — their
 * own section (this academic year) only. Subject teachers and students only read.
 * Who reads (`announcements.view`): administrators everything; the whole school SCHOOL; teachers
 * and administrators STAFF; a class/section's students and its class teacher CLASS and SECTION.
 */
export class AnnouncementService extends MarksServiceBase {
  private nowStamp() {
    return this.deps.clock.now().toISOString();
  }

  private ownSections(p: Principal, yearId: string): string[] {
    return p.classTeacherOf.filter((s) => s.academicYearId === yearId).map((s) => s.sectionId);
  }

  private canManage(
    p: Principal,
    a: Pick<AnnouncementRecord, 'academicYearId' | 'audience' | 'sectionId'>,
  ) {
    if (this.isAdmin(p)) return true;
    return (
      p.permissions.has('announcements.manage') &&
      !p.studentId &&
      a.audience === 'SECTION' &&
      a.sectionId !== null &&
      this.ownSections(p, a.academicYearId).includes(a.sectionId)
    );
  }

  /** Audience membership of the caller (current academic year placements/assignments). */
  private async audienceOf(repos: Repositories, p: Principal) {
    const sectionIds = p.studentId
      ? p.enrolledIn.map((s) => s.sectionId)
      : p.classTeacherOf.map((s) => s.sectionId);
    const sections = sectionIds.length ? await repos.classes.listSections() : [];
    const classIds = [
      ...new Set(sections.filter((s) => sectionIds.includes(s.id)).map((s) => s.classId)),
    ];
    return { everything: this.isAdmin(p), staff: !p.studentId, sectionIds, classIds };
  }

  private isActive(a: AnnouncementRecord) {
    return (
      a.status === 'PUBLISHED' &&
      a.publishedAt !== null &&
      a.publishedAt <= this.nowStamp() &&
      (a.expiresOn === null || a.expiresOn >= this.today())
    );
  }

  private toView(p: Principal, a: AnnouncementRecord): AnnouncementView {
    const audienceLabel =
      a.audience === 'CLASS'
        ? `${a.className ?? ''} (all sections)`
        : a.audience === 'SECTION'
          ? `${a.className ?? ''} ${a.sectionName ?? ''}`.trim()
          : ANNOUNCEMENT_AUDIENCE_LABELS[a.audience];
    return {
      id: a.id,
      academicYear: {
        id: a.academicYearId,
        label: a.yearLabel,
        status: a.yearStatus as AcademicYearStatus,
      },
      title: a.title,
      body: a.body,
      audience: a.audience,
      audienceLabel,
      classId: a.classId,
      sectionId: a.sectionId,
      status: a.status,
      publishedAt: a.publishedAt,
      expiresOn: a.expiresOn,
      expired: a.expiresOn !== null && a.expiresOn < this.today(),
      author: a.authorName,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
      canManage: this.canManage(p, a),
    };
  }

  // ---- Reading --------------------------------------------------------------------------------

  /** Active announcements for the caller's own audience (dashboards, the announcements page). */
  async feed(
    ctx: RequestContext,
    q: z.output<typeof AnnouncementFeedQuerySchema>,
  ): Promise<AnnouncementList> {
    const p = this.authorize(ctx, 'announcements.view');
    const repos = this.repos;
    const year = await repos.academicYears.findCurrent();
    if (!year) return { items: [], page: q.page, pageSize: q.pageSize, total: 0 };
    const who = await this.audienceOf(repos, p);
    const { rows, total } = await repos.announcements.feed({
      academicYearId: year.id,
      now: this.nowStamp(),
      today: this.today(),
      ...who,
      offset: (q.page - 1) * q.pageSize,
      limit: q.pageSize,
    });
    return { items: rows.map((r) => this.toView(p, r)), page: q.page, pageSize: q.pageSize, total };
  }

  async get(ctx: RequestContext, id: string): Promise<AnnouncementView> {
    const p = this.authorize(ctx, 'announcements.view');
    const repos = this.repos;
    const a = await repos.announcements.find(id);
    if (!a) {
      if (this.isAdmin(p)) throw new NotFoundError('That announcement was not found.');
      throw new ForbiddenError(NO_ACCESS);
    }
    if (this.canManage(p, a)) return this.toView(p, a);
    const year = await repos.academicYears.findCurrent();
    const who = await this.audienceOf(repos, p);
    const inAudience =
      a.audience === 'SCHOOL' ||
      (a.audience === 'STAFF' && who.staff) ||
      (a.audience === 'CLASS' && a.classId !== null && who.classIds.includes(a.classId)) ||
      (a.audience === 'SECTION' && a.sectionId !== null && who.sectionIds.includes(a.sectionId));
    if (!inAudience || !this.isActive(a) || a.academicYearId !== year?.id) {
      throw new ForbiddenError(NO_ACCESS);
    }
    return this.toView(p, a);
  }

  /** Management list: administrators everything; class teachers their own sections' announcements. */
  async list(
    ctx: RequestContext,
    q: z.output<typeof AnnouncementListQuerySchema>,
  ): Promise<AnnouncementList> {
    const p = this.authorize(ctx, 'announcements.manage');
    if (p.studentId) throw new ForbiddenError('Students cannot manage announcements.');
    const repos = this.repos;
    const year = q.academicYearId
      ? await repos.academicYears.find(q.academicYearId)
      : await repos.academicYears.findCurrent();
    const sectionIds = this.isAdmin(p) ? null : this.ownSections(p, year?.id ?? '');
    if (sectionIds && sectionIds.length === 0) {
      throw new ForbiddenError('Only administrators and class teachers manage announcements.');
    }
    const { rows, total } = await repos.announcements.list({
      academicYearId: year?.id ?? null,
      status: q.status === 'ALL' ? null : q.status,
      audience: q.audience ?? null,
      q: q.q?.trim() || null,
      sectionIds,
      offset: (q.page - 1) * q.pageSize,
      limit: q.pageSize,
    });
    return { items: rows.map((r) => this.toView(p, r)), page: q.page, pageSize: q.pageSize, total };
  }

  async options(ctx: RequestContext): Promise<AnnouncementOptionsView> {
    const p = this.authorize(ctx, 'announcements.manage');
    if (p.studentId) throw new ForbiddenError('Students cannot manage announcements.');
    const repos = this.repos;
    const [years, year, classes, sections] = await Promise.all([
      repos.academicYears.list(),
      repos.academicYears.findCurrent(),
      repos.classes.listClasses(),
      repos.classes.listSections(),
    ]);
    const admin = this.isAdmin(p);
    const own = this.ownSections(p, year?.id ?? '');
    const classOf = new Map(classes.map((c) => [c.id, c]));
    const activeClasses = [...classes]
      .filter((c) => c.status === 'ACTIVE')
      .sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name));
    return {
      academicYear: year ? { id: year.id, label: year.label, status: year.status } : null,
      years: years.map((y) => ({ id: y.id, label: y.label, status: y.status })),
      audiences: admin ? ['SCHOOL', 'STAFF', 'CLASS', 'SECTION'] : own.length ? ['SECTION'] : [],
      classes: admin ? activeClasses.map((c) => ({ id: c.id, name: c.name })) : [],
      sections: sections
        .filter((s) =>
          admin
            ? s.status === 'ACTIVE' && classOf.get(s.classId)?.status === 'ACTIVE'
            : own.includes(s.id),
        )
        .sort(
          (a, b) =>
            (classOf.get(a.classId)?.displayOrder ?? 0) -
              (classOf.get(b.classId)?.displayOrder ?? 0) || a.name.localeCompare(b.name),
        )
        .map((s) => ({
          sectionId: s.id,
          sectionName: s.name,
          classId: s.classId,
          className: classOf.get(s.classId)?.name ?? '',
        })),
    };
  }

  // ---- Changing -------------------------------------------------------------------------------

  /** Validates the audience against the school structure and the caller's scope. */
  private async target(
    repos: Repositories,
    p: Principal,
    yearId: string,
    input: Input,
    prefix = '',
  ): Promise<AnnouncementValues> {
    let classId: string | null = null;
    let sectionId: string | null = null;
    if (input.audience === 'CLASS') {
      const c = input.classId ? await repos.classes.findClass(input.classId) : null;
      if (!c || c.status !== 'ACTIVE')
        throw fieldConflict(`${prefix}classId`, 'Choose an active class.');
      classId = c.id;
    }
    if (input.audience === 'SECTION') {
      const s = input.sectionId ? await repos.classes.findSection(input.sectionId) : null;
      if (!s || s.status !== 'ACTIVE') {
        throw fieldConflict(`${prefix}sectionId`, 'Choose an active class section.');
      }
      classId = s.classId;
      sectionId = s.id;
    }
    if (!this.isAdmin(p)) {
      if (input.audience !== 'SECTION' || !sectionId) throw new ForbiddenError(OWN_SECTION_ONLY);
      if (!this.ownSections(p, yearId).includes(sectionId)) {
        throw new ForbiddenError(OWN_SECTION_ONLY);
      }
    }
    if (input.expiresOn !== null && input.expiresOn < this.today()) {
      throw fieldConflict(`${prefix}expiresOn`, 'The expiry date cannot be in the past.');
    }
    return {
      title: input.title,
      body: input.body,
      audience: input.audience as AnnouncementAudience,
      classId,
      sectionId,
      expiresOn: input.expiresOn,
    };
  }

  private snapshot(
    a: Pick<
      AnnouncementRecord,
      'title' | 'audience' | 'classId' | 'sectionId' | 'status' | 'expiresOn'
    > & { body?: string },
  ) {
    return {
      title: a.title,
      body: a.body,
      audience: a.audience,
      classId: a.classId,
      sectionId: a.sectionId,
      status: a.status,
      expiresOn: a.expiresOn,
    };
  }

  async create(
    ctx: RequestContext,
    input: z.output<typeof AnnouncementCreateSchema>,
  ): Promise<AnnouncementView> {
    const id = newId();
    await this.write(ctx, 'announcements.manage', async ({ repos, actor, now, audit }) => {
      if (actor.studentId) throw new ForbiddenError('Students cannot post announcements.');
      const year = await repos.academicYears.findCurrent();
      if (!year) throw new ConflictError('There is no current academic year. Set one up first.');
      const values = await this.target(repos, actor, year.id, input.announcement, 'announcement.');
      const status = input.publish ? 'PUBLISHED' : 'DRAFT';
      await repos.announcements.create(
        {
          ...values,
          id,
          academicYearId: year.id,
          status,
          publishedAt: input.publish ? now : null,
          createdBy: actor.userId,
        },
        now,
      );
      await audit({
        action: 'announcement.created',
        entityType: 'announcement',
        entityId: id,
        after: { academicYearId: year.id, ...this.snapshot({ ...values, status }) },
      });
      if (input.publish) {
        await audit({
          action: 'announcement.published',
          entityType: 'announcement',
          entityId: id,
          after: { status: 'PUBLISHED', publishedAt: now },
        });
      }
    });
    return this.get(ctx, id);
  }

  /** The announcement, checked against the caller's management scope (same refusal if missing). */
  private async managed(repos: Repositories, p: Principal, id: string) {
    const a = await repos.announcements.find(id);
    if (!a || !this.canManage(p, a)) {
      if (!a && this.isAdmin(p)) throw new NotFoundError('That announcement was not found.');
      throw new ForbiddenError(NO_ACCESS);
    }
    return a;
  }

  async update(ctx: RequestContext, id: string, input: Input): Promise<AnnouncementView> {
    await this.write(ctx, 'announcements.manage', async ({ repos, actor, now, audit }) => {
      const before = await this.managed(repos, actor, id);
      if (before.status === 'ARCHIVED') {
        throw new ConflictError('This announcement is archived. Restore it before editing.');
      }
      if (before.yearStatus === 'CLOSED') {
        throw new ConflictError('This academic year is closed; its announcements are read-only.');
      }
      const values = await this.target(repos, actor, before.academicYearId, input);
      await repos.announcements.update(id, values, actor.userId, now);
      const targetChanged =
        before.audience !== values.audience ||
        before.classId !== values.classId ||
        before.sectionId !== values.sectionId;
      await audit({
        action: targetChanged ? 'announcement.retargeted' : 'announcement.updated',
        entityType: 'announcement',
        entityId: id,
        before: this.snapshot(before),
        after: this.snapshot({ ...values, status: before.status }),
      });
    });
    return this.get(ctx, id);
  }

  async publish(ctx: RequestContext, id: string): Promise<AnnouncementView> {
    await this.write(ctx, 'announcements.manage', async ({ repos, actor, now, audit }) => {
      const a = await this.managed(repos, actor, id);
      if (a.status !== 'DRAFT') throw new ConflictError('Only a draft can be published.');
      if (a.yearStatus === 'CLOSED') {
        throw new ConflictError('This academic year is closed; its announcements are read-only.');
      }
      if (a.expiresOn !== null && a.expiresOn < this.today()) {
        throw new ConflictError(
          'This announcement has already expired. Change the expiry date first.',
        );
      }
      await repos.announcements.setStatus(
        id,
        'PUBLISHED',
        { at: now, by: actor.userId },
        actor.userId,
        now,
      );
      await audit({
        action: 'announcement.published',
        entityType: 'announcement',
        entityId: id,
        before: { status: a.status },
        after: { status: 'PUBLISHED', publishedAt: now },
      });
    });
    return this.get(ctx, id);
  }

  async setArchived(ctx: RequestContext, id: string, archived: boolean): Promise<AnnouncementView> {
    await this.write(ctx, 'announcements.manage', async ({ repos, actor, now, audit }) => {
      const a = await this.managed(repos, actor, id);
      if (archived && a.status === 'ARCHIVED') {
        throw new ConflictError('This announcement is already archived.');
      }
      if (!archived && a.status !== 'ARCHIVED') {
        throw new ConflictError('Only an archived announcement can be restored.');
      }
      // Restore returns it to where it was: published if it had been published, else a draft.
      const next = archived ? 'ARCHIVED' : a.publishedAt ? 'PUBLISHED' : 'DRAFT';
      await repos.announcements.setStatus(id, next, null, actor.userId, now);
      await audit({
        action: archived ? 'announcement.archived' : 'announcement.restored',
        entityType: 'announcement',
        entityId: id,
        before: { status: a.status },
        after: { status: next },
      });
    });
    return this.get(ctx, id);
  }
}
