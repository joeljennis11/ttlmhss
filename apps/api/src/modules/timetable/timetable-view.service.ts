import {
  weekdayOf,
  type ClassTimetableView,
  type StudentTimetableView,
  type TeacherTimetableView,
  type TimetableLessonsView,
  type TimetableSectionList,
  type TimetableYearList,
} from '@ttlmhss/shared';
import type { Principal } from '../../core/auth/access.js';
import { ConflictError, ForbiddenError } from '../../core/errors/app-errors.js';
import type { Repositories } from '../../data/data-store.js';
import type { AcademicYearRecord } from '../config/config.repository.js';
import {
  TimetableServiceBase,
  gridFor,
  loadFrame,
  required,
  sectionRef,
  sortEntries,
  toEntryView,
  toPeriodView,
  toVersionView,
  type RequestContext,
} from './timetable-service.js';

const NOT_YOURS = 'You can only view timetables of your own classes.';

/**
 * Read-only timetables (BR-TT-03, 08): class, teacher and student views and the Phase 7 lesson
 * context are all DERIVED from the PUBLISHED version of a year. Nothing here reads a draft and
 * nothing is stored a second time.
 *
 * Scope (timetable.view):
 *   ADMIN          every section and teacher.
 *   TEACHER        their own timetable; the class timetables of sections they teach (published).
 *   CLASS_TEACHER  additionally the sections they are class teacher of.
 *   STUDENT        their own placement's class timetable (API foundation; no portal yet).
 */
export class TimetableViewService extends TimetableServiceBase {
  /** Academic years, newest first (for choosing which year's timetable to open). */
  async years(ctx: RequestContext): Promise<TimetableYearList> {
    this.authorize(ctx, 'timetable.view');
    const years = await this.repos.academicYears.list();
    return {
      items: [...years]
        .sort((a, b) => b.startDate.localeCompare(a.startDate))
        .map((y) => ({
          id: y.id,
          label: y.label,
          status: y.status,
          startDate: y.startDate,
          endDate: y.endDate,
        })),
    };
  }

  /** Sections the caller may open a class timetable for, in the given year. */
  async viewableSections(
    ctx: RequestContext,
    academicYearId: string,
  ): Promise<TimetableSectionList> {
    const principal = this.authorize(ctx, 'timetable.view');
    const repos = this.repos;
    const year = required(await repos.academicYears.find(academicYearId), 'academic year');
    const [classes, sections, taught] = await Promise.all([
      repos.classes.listClasses(),
      repos.classes.listSections(),
      this.taughtSections(repos, principal, year.id),
    ]);
    const allowed = (sectionId: string) =>
      this.isAdmin(principal) ||
      this.deps.authorization.isClassTeacherOf(principal, sectionId) ||
      principal.enrolledIn.some((s) => s.sectionId === sectionId) ||
      taught.has(sectionId);
    const items = [...classes]
      .sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name))
      .flatMap((c) =>
        sections
          .filter(
            (s) =>
              s.classId === c.id &&
              allowed(s.id) &&
              ((s.status === 'ACTIVE' && c.status === 'ACTIVE') || taught.has(s.id)),
          )
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((s) => ({ sectionId: s.id, sectionName: s.name, classId: c.id, className: c.name })),
      );
    return { items };
  }

  /** Sections a teacher teaches in the year's published timetable. */
  private async taughtSections(
    repos: Repositories,
    principal: Principal,
    academicYearId: string,
  ): Promise<Set<string>> {
    if (!principal.teacherId) return new Set();
    const published = await repos.timetable.versionWithStatus(academicYearId, 'PUBLISHED');
    if (!published) return new Set();
    const entries = await repos.timetable.listEntries(published.id, {
      teacherId: principal.teacherId,
    });
    return new Set(entries.map((e) => e.sectionId));
  }

  async classTimetable(
    ctx: RequestContext,
    academicYearId: string,
    sectionId: string,
  ): Promise<ClassTimetableView> {
    const principal = this.authorize(ctx, 'timetable.view');
    const repos = this.repos;
    const year = required(await repos.academicYears.find(academicYearId), 'academic year');
    const allowed =
      this.deps.authorization.canAccessSection(principal, sectionId) ||
      (await this.taughtSections(repos, principal, year.id)).has(sectionId);
    if (!allowed) throw new ForbiddenError(NOT_YOURS);
    return this.buildClass(repos, year, sectionId);
  }

  private async buildClass(
    repos: Repositories,
    year: AcademicYearRecord,
    sectionId: string,
  ): Promise<ClassTimetableView> {
    const [section, frame, published] = await Promise.all([
      sectionRef(repos, sectionId),
      loadFrame(repos, year),
      repos.timetable.versionWithStatus(year.id, 'PUBLISHED'),
    ]);
    const entries = published ? await repos.timetable.listEntries(published.id, { sectionId }) : [];
    const { active: _a, label: _l, ...sectionView } = section;
    return {
      ...gridFor(frame, entries),
      section: sectionView,
      published: published ? toVersionView(published) : null,
      entries: sortEntries(frame, entries).map(toEntryView),
    };
  }

  async teacherTimetable(
    ctx: RequestContext,
    academicYearId: string | undefined,
    teacherId: string,
  ): Promise<TeacherTimetableView> {
    const principal = this.authorize(ctx, 'timetable.view');
    if (!this.isAdmin(principal) && principal.teacherId !== teacherId) {
      throw new ForbiddenError('You can only view your own timetable.');
    }
    const repos = this.repos;
    const teacher = required(await repos.teachers.find(teacherId), 'teacher');
    const year = await this.yearOrCurrent(repos, academicYearId);
    const [frame, published] = await Promise.all([
      loadFrame(repos, year),
      repos.timetable.versionWithStatus(year.id, 'PUBLISHED'),
    ]);
    const entries = published ? await repos.timetable.listEntries(published.id, { teacherId }) : [];
    return {
      ...gridFor(frame, entries),
      teacher: { id: teacher.id, fullName: teacher.fullName, staffCode: teacher.staffCode },
      published: published ? toVersionView(published) : null,
      entries: sortEntries(frame, entries).map(toEntryView),
    };
  }

  /** The signed-in teacher's own timetable. */
  async myTimetable(ctx: RequestContext, academicYearId?: string): Promise<TeacherTimetableView> {
    const principal = this.authorize(ctx, 'timetable.view');
    if (!principal.teacherId) {
      throw new ConflictError('Only teachers have a personal timetable.');
    }
    return this.teacherTimetable(ctx, academicYearId, principal.teacherId);
  }

  /**
   * Student timetable foundation: student → placement (ACTIVE enrolment) in the year → its
   * class/section → the published class timetable. No copy is stored.
   */
  async studentTimetable(
    ctx: RequestContext,
    studentId: string,
    academicYearId?: string,
  ): Promise<StudentTimetableView> {
    const principal = this.authorize(ctx, 'timetable.view');
    await this.deps.authorization.checkStudentScope(principal, studentId);
    const repos = this.repos;
    required(await repos.students.find(studentId), 'student');
    const year = await this.yearOrCurrent(repos, academicYearId);
    const placement = await repos.enrolments.findActive(studentId, year.id);
    if (!placement) return { studentId, placement: null, timetable: null };
    return {
      studentId,
      placement: {
        enrolmentId: placement.enrolmentId,
        sectionId: placement.sectionId,
        sectionName: placement.sectionName,
        classId: placement.classId,
        className: placement.className,
      },
      timetable: await this.buildClass(repos, year, placement.sectionId),
    };
  }

  /**
   * Phase 7 foundation: a teacher's lessons on a calendar date from the published timetable, each
   * with its full context (Date + Period + Class/Section + Subject + Teacher). No attendance here.
   */
  async lessons(
    ctx: RequestContext,
    date: string,
    teacherId?: string,
  ): Promise<TimetableLessonsView> {
    const principal = this.authorize(ctx, 'timetable.view');
    const target = teacherId ?? principal.teacherId;
    if (!target) throw new ConflictError('Only teachers have lessons. Choose a teacher.');
    if (!this.isAdmin(principal) && target !== principal.teacherId) {
      throw new ForbiddenError('You can only view your own lessons.');
    }
    const repos = this.repos;
    required(await repos.teachers.find(target), 'teacher');
    const day = weekdayOf(date);
    const years = (await repos.academicYears.list()).filter(
      (y) => y.startDate <= date && date <= y.endDate,
    );
    const year = years.find((y) => y.status === 'CURRENT') ?? years[0] ?? null;
    const none = (schoolDay: boolean): TimetableLessonsView => ({
      date,
      day,
      academicYear: year ? { id: year.id, label: year.label, status: year.status } : null,
      schoolDay,
      lessons: [],
    });
    if (!year || !(year.workingDays ?? []).includes(day)) return none(false);
    const [frame, published] = await Promise.all([
      loadFrame(repos, year),
      repos.timetable.versionWithStatus(year.id, 'PUBLISHED'),
    ]);
    if (!published) return none(true);
    const entries = await repos.timetable.listEntries(published.id, { teacherId: target, day });
    return {
      ...none(true),
      lessons: sortEntries(frame, entries).flatMap((e) => {
        const period = frame.slotById.get(e.periodId);
        return period
          ? [
              {
                date,
                day,
                period: toPeriodView(period),
                entry: toEntryView(e),
                versionId: published.id,
              },
            ]
          : [];
      }),
    };
  }
}
