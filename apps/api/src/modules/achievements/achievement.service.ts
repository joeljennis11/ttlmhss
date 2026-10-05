import type {
  AcademicYearStatus,
  AchievementCreateSchema,
  AchievementList,
  AchievementListQuerySchema,
  AchievementOptionsView,
  AchievementUpdateSchema,
  AchievementView,
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
import { placementOn } from '../attendance/attendance-service.js';
import { MarksServiceBase, type RequestContext } from '../marks/marks-context.js';
import type { AchievementRecord } from './achievements.repository.js';

const NO_ACCESS = 'You do not have access to this achievement.';
const NOT_YOURS = 'You can record achievements only for students of your own class.';

/**
 * Achievements (Phase 9, BR-ACH). Recorded by administrators (any student) and class teachers
 * (students placed in their own section in that academic year) — never subject teachers. Students
 * read their own ACTIVE achievements. Archive hides an achievement and keeps it; only an
 * administrator may delete an archived one permanently. Every change is audited.
 */
export class AchievementService extends MarksServiceBase {
  private isClassTeacher(p: Principal, yearId: string, sectionId: string) {
    return p.classTeacherOf.some((s) => s.academicYearId === yearId && s.sectionId === sectionId);
  }

  private canManage(p: Principal, a: Pick<AchievementRecord, 'academicYearId' | 'sectionId'>) {
    return (
      this.isAdmin(p) ||
      (p.permissions.has('achievements.manage') &&
        this.isClassTeacher(p, a.academicYearId, a.sectionId))
    );
  }

  private canView(p: Principal, a: AchievementRecord) {
    if (p.studentId) return p.studentId === a.studentId && a.status === 'ACTIVE';
    return this.isAdmin(p) || this.isClassTeacher(p, a.academicYearId, a.sectionId);
  }

  private toView(p: Principal, a: AchievementRecord): AchievementView {
    return {
      id: a.id,
      academicYear: {
        id: a.academicYearId,
        label: a.yearLabel,
        status: a.yearStatus as AcademicYearStatus,
      },
      student: {
        id: a.studentId,
        fullName: a.fullName,
        admissionNumber: a.admissionNumber,
        rollNumber: a.rollNumber,
      },
      section: {
        sectionId: a.sectionId,
        sectionName: a.sectionName,
        classId: a.classId,
        className: a.className,
      },
      category: { id: a.categoryId, name: a.categoryName },
      title: a.title,
      description: a.description,
      achievedOn: a.achievedOn,
      hasAttachment: a.attachmentRef !== null,
      status: a.status,
      createdBy: p.studentId ? null : a.createdByName,
      updatedAt: a.updatedAt,
      canManage: !p.studentId && this.canManage(p, a),
    };
  }

  // ---- Reading --------------------------------------------------------------------------------

  async options(ctx: RequestContext, academicYearId?: string): Promise<AchievementOptionsView> {
    const p = this.authorize(ctx, 'achievements.view');
    if (p.studentId)
      throw new ForbiddenError('Students see their own achievements under My portal.');
    const repos = this.repos;
    const allYears = await repos.academicYears.list();
    const years = allYears.map((y) => ({
      id: y.id,
      label: y.label,
      status: y.status,
      startDate: y.startDate,
      endDate: y.endDate,
    }));
    const year =
      years.find((y) => y.id === academicYearId) ??
      years.find((y) => y.status === 'CURRENT') ??
      years[0] ??
      null;
    const admin = this.isAdmin(p);
    const own = new Set(
      p.classTeacherOf.filter((s) => s.academicYearId === year?.id).map((s) => s.sectionId),
    );
    const [classes, sections, categories] = await Promise.all([
      repos.classes.listClasses(),
      repos.classes.listSections(),
      repos.achievementCategories.list(),
    ]);
    const classOf = new Map(classes.map((c) => [c.id, c]));
    return {
      years,
      academicYearId: year?.id ?? null,
      sections: sections
        .filter((s) => (admin ? s.status === 'ACTIVE' : own.has(s.id)))
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
      categories: [...categories]
        .sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name))
        .map((c) => ({ id: c.id, name: c.name, active: c.status === 'ACTIVE' })),
      canDelete: admin,
    };
  }

  /** Staff list: administrators everything; class teachers their own sections of that year. */
  async list(
    ctx: RequestContext,
    q: z.output<typeof AchievementListQuerySchema>,
  ): Promise<AchievementList> {
    const p = this.authorize(ctx, 'achievements.view');
    if (p.studentId)
      throw new ForbiddenError('Students see their own achievements under My portal.');
    const repos = this.repos;
    const year = q.academicYearId
      ? await repos.academicYears.find(q.academicYearId)
      : await repos.academicYears.findCurrent();
    let sectionIds: string[] | null = q.sectionId ? [q.sectionId] : null;
    if (!this.isAdmin(p)) {
      const own = p.classTeacherOf
        .filter((s) => s.academicYearId === year?.id)
        .map((s) => s.sectionId);
      if (own.length === 0) throw new ForbiddenError('You do not have access to achievements.');
      sectionIds = sectionIds ? sectionIds.filter((id) => own.includes(id)) : own;
    }
    const { rows, total } = await repos.achievements.list({
      academicYearId: year?.id ?? null,
      sectionIds,
      studentId: q.studentId ?? null,
      categoryId: q.categoryId ?? null,
      from: q.from ?? null,
      to: q.to ?? null,
      q: q.q?.trim() || null,
      status: q.status,
      offset: (q.page - 1) * q.pageSize,
      limit: q.pageSize,
    });
    return { items: rows.map((r) => this.toView(p, r)), page: q.page, pageSize: q.pageSize, total };
  }

  async get(ctx: RequestContext, id: string): Promise<AchievementView> {
    const p = this.authorize(ctx, 'achievements.view');
    const a = await this.repos.achievements.find(id);
    if (!a || !this.canView(p, a)) {
      if (a === null && this.isAdmin(p)) throw new NotFoundError('That achievement was not found.');
      throw new ForbiddenError(NO_ACCESS);
    }
    return this.toView(p, a);
  }

  /** The signed-in student's own active achievements (all years, or one). */
  async mine(ctx: RequestContext, academicYearId?: string): Promise<AchievementList> {
    const p = this.authorize(ctx, 'achievements.view');
    if (!p.studentId) throw new ForbiddenError('Only students have their own achievements page.');
    const { rows, total } = await this.repos.achievements.list({
      academicYearId: academicYearId ?? null,
      sectionIds: null,
      studentId: p.studentId,
      categoryId: null,
      from: null,
      to: null,
      q: null,
      status: 'ACTIVE',
      offset: 0,
      limit: 500,
    });
    return { items: rows.map((r) => this.toView(p, r)), page: 1, pageSize: 500, total };
  }

  // ---- Changing -------------------------------------------------------------------------------

  /** The placement an achievement on `date` belongs to, checked against the caller's scope. */
  private async placement(
    repos: Repositories,
    p: Principal,
    studentId: string,
    yearId: string,
    date: string,
  ) {
    const year = await repos.academicYears.find(yearId);
    if (!year) throw fieldConflict('academicYearId', 'That academic year was not found.');
    if (date < year.startDate || date > year.endDate) {
      throw fieldConflict(
        'achievedOn',
        `The date must fall within ${year.label} (${year.startDate} to ${year.endDate}).`,
      );
    }
    const student = await repos.students.find(studentId);
    const placements = student
      ? await repos.attendance.placementsOfStudents([studentId], yearId, date, date)
      : [];
    const placed = placementOn(placements, studentId, date);
    if (!student || !placed) {
      // Never reveal to a class teacher whether another school's student exists.
      if (!this.isAdmin(p)) throw new ForbiddenError(NOT_YOURS);
      throw fieldConflict(
        'studentId',
        student
          ? `${student.fullName} is not placed in a class on ${date} in ${year.label}.`
          : 'That student was not found.',
      );
    }
    if (!this.canManage(p, { academicYearId: yearId, sectionId: placed.sectionId }))
      throw new ForbiddenError(NOT_YOURS);
    return { year, student, placed };
  }

  private async category(repos: Repositories, categoryId: string, current?: string) {
    const category = await repos.achievementCategories.find(categoryId);
    if (!category) throw fieldConflict('categoryId', 'That category was not found.');
    if (category.status !== 'ACTIVE' && category.id !== current)
      throw fieldConflict('categoryId', `${category.name} is inactive and cannot be chosen.`);
    return category;
  }

  async create(
    ctx: RequestContext,
    input: z.output<typeof AchievementCreateSchema>,
  ): Promise<AchievementView> {
    const id = newId();
    await this.write(ctx, 'achievements.manage', async ({ repos, actor, now, audit }) => {
      const { year, student, placed } = await this.placement(
        repos,
        actor,
        input.studentId,
        input.academicYearId,
        input.achievedOn,
      );
      const category = await this.category(repos, input.categoryId);
      await repos.achievements.create(
        {
          id,
          academicYearId: year.id,
          studentId: student.id,
          enrolmentId: placed.enrolmentId,
          categoryId: category.id,
          title: input.title,
          description: input.description,
          achievedOn: input.achievedOn,
          createdBy: actor.userId,
        },
        now,
      );
      await audit({
        action: 'achievement.created',
        entityType: 'achievement',
        entityId: id,
        after: snapshot((await repos.achievements.find(id))!),
      });
    });
    return this.get(ctx, id);
  }

  private async existing(repos: Repositories, p: Principal, id: string) {
    const a = await repos.achievements.find(id);
    if (!a || !this.canManage(p, a)) {
      if (!a && this.isAdmin(p)) throw new NotFoundError('That achievement was not found.');
      throw new ForbiddenError(NO_ACCESS);
    }
    return a;
  }

  async update(
    ctx: RequestContext,
    id: string,
    input: z.output<typeof AchievementUpdateSchema>,
  ): Promise<AchievementView> {
    await this.write(ctx, 'achievements.manage', async ({ repos, actor, now, audit }) => {
      const before = await this.existing(repos, actor, id);
      if (before.status !== 'ACTIVE')
        throw new ConflictError('Restore this achievement before editing it.');
      const { placed } = await this.placement(
        repos,
        actor,
        before.studentId,
        before.academicYearId,
        input.achievedOn,
      );
      const category = await this.category(repos, input.categoryId, before.categoryId);
      await repos.achievements.update(
        id,
        {
          categoryId: category.id,
          title: input.title,
          description: input.description,
          achievedOn: input.achievedOn,
          enrolmentId: placed.enrolmentId,
        },
        actor.userId,
        now,
      );
      await audit({
        action: 'achievement.updated',
        entityType: 'achievement',
        entityId: id,
        before: snapshot(before),
        after: snapshot((await repos.achievements.find(id))!),
      });
    });
    return this.get(ctx, id);
  }

  async setArchived(ctx: RequestContext, id: string, archived: boolean): Promise<AchievementView> {
    await this.write(ctx, 'achievements.manage', async ({ repos, actor, now, audit }) => {
      const before = await this.existing(repos, actor, id);
      const status = archived ? 'ARCHIVED' : 'ACTIVE';
      if (before.status === status)
        throw new ConflictError(`This achievement is already ${archived ? 'archived' : 'active'}.`);
      await repos.achievements.setStatus(id, status, actor.userId, now);
      await audit({
        action: archived ? 'achievement.archived' : 'achievement.restored',
        entityType: 'achievement',
        entityId: id,
        before: snapshot(before),
        after: { ...snapshot(before), status },
      });
    });
    return this.get(ctx, id);
  }

  /** Permanent deletion: administrators only, and only an archived achievement. */
  async remove(ctx: RequestContext, id: string): Promise<void> {
    await this.write(ctx, 'achievements.manage', async ({ repos, actor, audit }) => {
      const before = await this.existing(repos, actor, id);
      if (!this.isAdmin(actor))
        throw new ForbiddenError('Only an administrator can delete an achievement permanently.');
      if (before.status !== 'ARCHIVED')
        throw new ConflictError(
          'Archive the achievement first; only archived achievements can be deleted.',
        );
      await repos.achievements.delete(id);
      await audit({
        action: 'achievement.deleted',
        entityType: 'achievement',
        entityId: id,
        before: snapshot(before),
      });
    });
  }
}

/** Audit snapshot with readable names (student, year, class, category). */
function snapshot(a: AchievementRecord) {
  return {
    studentId: a.studentId,
    student: a.fullName,
    admissionNumber: a.admissionNumber,
    academicYearId: a.academicYearId,
    academicYear: a.yearLabel,
    enrolmentId: a.enrolmentId,
    classSection: `${a.className} ${a.sectionName}`,
    categoryId: a.categoryId,
    category: a.categoryName,
    title: a.title,
    description: a.description,
    achievedOn: a.achievedOn,
    status: a.status,
  };
}
