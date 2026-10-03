import {
  countAttendance,
  weekdayOf,
  type AttendanceClassDayView,
  type AttendanceClassSummaryView,
  type AttendanceLessonsView,
  type AttendanceSessionList,
  type AttendanceSessionListQuerySchema,
  type AttendanceStatus,
  type StudentAttendanceView,
} from '@ttlmhss/shared';
import type { z } from 'zod';
import type { Principal } from '../../core/auth/access.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../../core/errors/app-errors.js';
import type { Repositories } from '../../data/data-store.js';
import type { AcademicYearRecord } from '../config/config.repository.js';
import { loadFrame, sectionRef, toPeriodView } from '../timetable/timetable-service.js';
import type { AttendanceRecordRow } from './attendance.repository.js';
import {
  AttendanceServiceBase,
  VersionCache,
  byRoll,
  countsFor,
  datesBetween,
  placementOn,
  rosterOn,
  sectionPlacements,
  type DayLesson,
  type RequestContext,
} from './attendance-service.js';

const sectionView = (s: Awaited<ReturnType<typeof sectionRef>>) => {
  const { active: _a, label: _l, ...rest } = s;
  return rest;
};
const yearView = (y: AcademicYearRecord) => ({ id: y.id, label: y.label, status: y.status });

/**
 * Read-only attendance views and the reporting foundation (Phase 11 will consume these):
 * a teacher's lessons on a date, a class's day, class totals over a range, a student's own
 * attendance, and the administrator's register search. Every number uses BR-ATT-03.
 */
export class AttendanceViewService extends AttendanceServiceBase {
  // ---- Teacher: lessons on a date ----------------------------------------------------------------

  async lessons(
    ctx: RequestContext,
    date: string,
    teacherId?: string,
  ): Promise<AttendanceLessonsView> {
    const principal = this.authorize(ctx, 'attendance.view');
    const target = teacherId ?? principal.teacherId;
    if (!target) throw new ConflictError('Only teachers have lessons. Choose a teacher.');
    if (!this.isAdmin(principal) && target !== principal.teacherId) {
      throw new ForbiddenError('You can only see your own lessons.');
    }
    const repos = this.repos;
    const teacher = await repos.teachers.find(target);
    if (!teacher) throw new NotFoundError('That teacher was not found.');
    const day = weekdayOf(date);
    const year = await this.yearOf(repos, date);
    const base = {
      date,
      day,
      academicYear: year ? yearView(year) : null,
      future: date > this.today(),
      teacher: { id: teacher.id, fullName: teacher.fullName, staffCode: teacher.staffCode },
    };
    if (!year || !(year.workingDays ?? []).includes(day)) {
      return { ...base, schoolDay: false, lessons: [] };
    }
    const frame = await loadFrame(repos, year);
    const cache = new VersionCache(repos, year.id);
    // Registers already taken by this teacher that day keep their own lesson (history) …
    const sessions = (await repos.attendance.sessionsForTeacher(target, date)).filter(
      (s) => s.academicYearId === year.id,
    );
    // … and the timetable in force that day adds the rest.
    const inForce = await cache.entriesOn(date, { teacherId: target, day });
    const taken = new Set(sessions.map((s) => `${s.periodId}|${s.sectionId}`));
    const lessons: { periodId: string; sectionId: string; subject: DayLesson['subject'] }[] = [
      ...sessions.map((s) => ({
        periodId: s.periodId,
        sectionId: s.sectionId,
        subject: { id: s.subjectId, name: s.subjectName, code: s.subjectCode },
      })),
      ...(inForce?.entries ?? [])
        .filter((e) => !taken.has(`${e.periodId}|${e.sectionId}`))
        .map((e) => ({
          periodId: e.periodId,
          sectionId: e.sectionId,
          subject: { id: e.subjectId, name: e.subjectName, code: e.subjectCode },
        })),
    ];
    // A register taken by someone else for the same class and period replaces the timetable lesson.
    const position = new Map(frame.slots.map((s, i) => [s.id, i]));
    const { locked } = await this.lockState(repos, date);
    const out: AttendanceLessonsView['lessons'] = [];
    for (const l of lessons.sort(
      (a, b) => (position.get(a.periodId) ?? 0) - (position.get(b.periodId) ?? 0),
    )) {
      const period = frame.slotById.get(l.periodId);
      if (!period || period.kind !== 'LESSON') continue;
      const session = await repos.attendance.findSession(year.id, date, l.periodId, l.sectionId);
      if (session && session.teacherId !== target) continue;
      const roster = rosterOn(
        await sectionPlacements(repos, year.id, l.sectionId, date, date),
        l.sectionId,
        date,
      );
      const records = session ? await repos.attendance.recordsForSessions([session.id]) : [];
      out.push({
        period: toPeriodView(period),
        section: sectionView(await sectionRef(repos, l.sectionId)),
        subject: l.subject,
        attendance: {
          taken: session !== null,
          counts: countsFor(roster, records),
          locked,
        },
      });
    }
    return { ...base, schoolDay: true, lessons: out };
  }

  // ---- Class teacher / admin: a class's day ----------------------------------------------------

  private checkClassScope(principal: Principal, yearId: string, sectionId: string) {
    if (!this.canManageClass(principal, yearId, sectionId)) {
      throw new ForbiddenError('You can only view attendance of your own class.');
    }
  }

  async classDay(
    ctx: RequestContext,
    sectionId: string,
    date: string,
  ): Promise<AttendanceClassDayView> {
    const principal = this.authorize(ctx, 'attendance.view');
    const repos = this.repos;
    const year = await this.requireYear(repos, date);
    this.checkClassScope(principal, year.id, sectionId);
    const section = sectionView(await sectionRef(repos, sectionId));
    const day = weekdayOf(date);
    const future = date > this.today();
    const { locked } = await this.lockState(repos, date);
    const schoolDay = (year.workingDays ?? []).includes(day);
    const empty = countAttendance([]);
    if (!schoolDay) {
      return {
        date,
        day,
        academicYear: yearView(year),
        section,
        schoolDay,
        future,
        locked,
        periods: [],
        students: [],
        counts: empty,
        canManage: true,
      };
    }
    const frame = await loadFrame(repos, year);
    const lessons = await this.sectionLessons(repos, year, frame, sectionId, date);
    const roster = rosterOn(
      await sectionPlacements(repos, year.id, sectionId, date, date),
      sectionId,
      date,
    );
    const records = await repos.attendance.recordsForSessions(
      lessons.flatMap((l) => (l.session ? [l.session.id] : [])),
    );
    const bySession = new Map<string, AttendanceRecordRow[]>();
    for (const r of records) bySession.set(r.sessionId, [...(bySession.get(r.sessionId) ?? []), r]);
    const status = (studentId: string, l: DayLesson): AttendanceStatus =>
      (l.session && bySession.get(l.session.id)?.find((r) => r.studentId === studentId)?.status) ||
      '-';
    const all: AttendanceStatus[] = [];
    const students = roster.map((s) => {
      const statuses: Record<string, AttendanceStatus> = {};
      for (const l of lessons) statuses[l.period.id] = status(s.studentId, l);
      const list = Object.values(statuses);
      all.push(...list);
      return {
        studentId: s.studentId,
        rollNumber: s.rollNumber,
        admissionNumber: s.admissionNumber,
        fullName: s.fullName,
        statuses,
        counts: countAttendance(list),
      };
    });
    return {
      date,
      day,
      academicYear: yearView(year),
      section,
      schoolDay,
      future,
      locked,
      periods: lessons.map((l) => ({
        period: toPeriodView(l.period),
        subject: l.subject,
        teacher: l.teacher,
        attendance: {
          taken: l.session !== null,
          counts: countsFor(roster, l.session ? (bySession.get(l.session.id) ?? []) : []),
          locked,
        },
      })),
      students,
      counts: countAttendance(all),
      canManage: true,
    };
  }

  // ---- Reporting foundation: expected lessons over a range --------------------------------------

  /**
   * Every lesson a section had between two dates (only dates up to today, working days only), with
   * the status of each placed student. Lessons without a record count as '-' (not marked).
   */
  private async sectionCells(
    repos: Repositories,
    year: AcademicYearRecord,
    sectionId: string,
    from: string,
    to: string,
  ) {
    const frame = await loadFrame(repos, year);
    const cache = new VersionCache(repos, year.id);
    const last = to < this.today() ? to : this.today();
    const placements = await sectionPlacements(repos, year.id, sectionId, from, to);
    const sessions = await repos.attendance.sessionsForSection(sectionId, from, last);
    const records = await repos.attendance.recordsForSessions(sessions.map((s) => s.id));
    const recordAt = new Map(records.map((r) => [`${r.sessionId}|${r.studentId}`, r.status]));
    const cells: {
      date: string;
      studentId: string;
      periodId: string;
      subjectName: string;
      status: AttendanceStatus;
    }[] = [];
    for (const date of datesBetween(
      from < year.startDate ? year.startDate : from,
      last > year.endDate ? year.endDate : last,
    )) {
      if (!(year.workingDays ?? []).includes(weekdayOf(date))) continue;
      const lessons = await this.sectionLessons(repos, year, frame, sectionId, date, cache);
      if (lessons.length === 0) continue;
      for (const s of rosterOn(placements, sectionId, date)) {
        for (const l of lessons) {
          cells.push({
            date,
            studentId: s.studentId,
            periodId: l.period.id,
            subjectName: l.subject.name,
            status: (l.session && recordAt.get(`${l.session.id}|${s.studentId}`)) || '-',
          });
        }
      }
    }
    return { frame, placements, cells };
  }

  async classSummary(
    ctx: RequestContext,
    sectionId: string,
    from: string,
    to: string,
  ): Promise<AttendanceClassSummaryView> {
    const principal = this.authorize(ctx, 'attendance.view');
    const repos = this.repos;
    const year = await this.requireYear(repos, from);
    if (to > year.endDate) {
      throw new ConflictError(
        `Choose dates within one academic year (${year.label} ends ${year.endDate}).`,
      );
    }
    this.checkClassScope(principal, year.id, sectionId);
    const section = sectionView(await sectionRef(repos, sectionId));
    const { placements, cells } = await this.sectionCells(repos, year, sectionId, from, to);
    const people = new Map(
      placements.filter((p) => p.sectionId === sectionId).map((p) => [p.studentId, p]),
    );
    const byStudent = new Map<string, AttendanceStatus[]>();
    for (const c of cells)
      byStudent.set(c.studentId, [...(byStudent.get(c.studentId) ?? []), c.status]);
    const students = [...byStudent.entries()]
      .map(([studentId, statuses]) => {
        const p = people.get(studentId)!;
        return {
          studentId,
          rollNumber: p.rollNumber,
          admissionNumber: p.admissionNumber,
          fullName: p.fullName,
          counts: countAttendance(statuses),
        };
      })
      .sort(byRoll);
    return { section, from, to, students, counts: countAttendance(cells.map((c) => c.status)) };
  }

  // ---- A student's own attendance --------------------------------------------------------------

  async studentAttendance(
    ctx: RequestContext,
    studentId: string,
    from: string,
    to: string,
  ): Promise<StudentAttendanceView> {
    const principal = this.authorize(ctx, 'attendance.view');
    const repos = this.repos;
    const student = await repos.students.find(studentId);
    // Scope first; an unknown id answers like a forbidden one for non-admins.
    if (!student) {
      if (!this.isAdmin(principal))
        throw new ForbiddenError('You can only view your own attendance.');
      throw new NotFoundError('That student was not found.');
    }
    const year = await this.requireYear(repos, from);
    const effectiveTo = to > year.endDate ? year.endDate : to;
    const placements = await repos.attendance.placementsOfStudents(
      [studentId],
      year.id,
      from,
      effectiveTo,
    );
    const allowed =
      this.isAdmin(principal) ||
      (principal.accountRole === 'STUDENT' && principal.studentId === studentId) ||
      (principal.accountRole !== 'STUDENT' &&
        placements.some((p) => this.canManageClass(principal, year.id, p.sectionId)));
    if (!allowed) throw new ForbiddenError('You can only view your own attendance.');

    const frame = await loadFrame(repos, year);
    const cache = new VersionCache(repos, year.id);
    const records = await repos.attendance.recordsForStudent(studentId, from, effectiveTo);
    const recordAt = new Map(records.map((r) => [`${r.date}|${r.periodId}`, r.status]));
    const last = effectiveTo < this.today() ? effectiveTo : this.today();
    const days: StudentAttendanceView['days'] = [];
    const used = new Set<string>();
    const statuses: AttendanceStatus[] = [];
    for (const date of datesBetween(from < year.startDate ? year.startDate : from, last)) {
      const day = weekdayOf(date);
      if (!(year.workingDays ?? []).includes(day)) continue;
      const placement = placementOn(placements, studentId, date);
      if (!placement) continue;
      const lessons = await this.sectionLessons(
        repos,
        year,
        frame,
        placement.sectionId,
        date,
        cache,
      );
      if (lessons.length === 0) continue;
      const cells: StudentAttendanceView['days'][number]['cells'] = {};
      for (const l of lessons) {
        const status = recordAt.get(`${date}|${l.period.id}`) ?? '-';
        cells[l.period.id] = { status, subjectName: l.subject.name };
        used.add(l.period.id);
        statuses.push(status);
      }
      days.push({ date, day, cells });
    }
    return {
      student: {
        id: student.id,
        fullName: student.fullName,
        admissionNumber: student.admissionNumber,
      },
      from,
      to: effectiveTo,
      periods: frame.slots
        .filter((s) => used.has(s.id))
        .map((s) => ({ id: s.id, label: s.label, periodNumber: s.periodNumber })),
      days: days.reverse(),
      counts: countAttendance(statuses),
    };
  }

  /** The signed-in student's own attendance (student portal). */
  async myAttendance(
    ctx: RequestContext,
    from: string,
    to: string,
  ): Promise<StudentAttendanceView> {
    const principal = this.authorize(ctx, 'attendance.view');
    if (!principal.studentId) throw new ConflictError('Only students have their own attendance.');
    return this.studentAttendance(ctx, principal.studentId, from, to);
  }

  // ---- Classes the caller manages (filters) -----------------------------------------------------

  /** Administrators: every active class/section; class teachers: their own class(es) that year. */
  async manageableSections(ctx: RequestContext, academicYearId: string) {
    const principal = this.authorize(ctx, 'attendance.view');
    const repos = this.repos;
    const year = await repos.academicYears.find(academicYearId);
    if (!year) throw new NotFoundError('That academic year was not found.');
    const [classes, sections] = await Promise.all([
      repos.classes.listClasses(),
      repos.classes.listSections(),
    ]);
    const items = [...classes]
      .sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name))
      .flatMap((c) =>
        sections
          .filter(
            (s) =>
              s.classId === c.id &&
              this.canManageClass(principal, year.id, s.id) &&
              (this.isAdmin(principal) ? s.status === 'ACTIVE' && c.status === 'ACTIVE' : true),
          )
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((s) => ({ sectionId: s.id, sectionName: s.name, classId: c.id, className: c.name })),
      );
    return { items };
  }

  // ---- Administrator: register search ------------------------------------------------------------

  async sessions(
    ctx: RequestContext,
    q: z.output<typeof AttendanceSessionListQuerySchema>,
  ): Promise<AttendanceSessionList> {
    const principal = this.authorize(ctx, 'attendance.view');
    if (!this.isAdmin(principal)) {
      throw new ForbiddenError('Only administrators can search all attendance registers.');
    }
    const repos = this.repos;
    const year = await repos.academicYears.find(q.academicYearId);
    if (!year) throw new NotFoundError('That academic year was not found.');
    const frame = await loadFrame(repos, year);
    const { rows, total } = await repos.attendance.listSessions(
      {
        academicYearId: year.id,
        ...(q.from ? { from: q.from } : {}),
        ...(q.to ? { to: q.to } : {}),
        ...(q.sectionId ? { sectionId: q.sectionId } : {}),
        ...(q.periodId ? { periodId: q.periodId } : {}),
        ...(q.subjectId ? { subjectId: q.subjectId } : {}),
        ...(q.teacherId ? { teacherId: q.teacherId } : {}),
      },
      (q.page - 1) * q.pageSize,
      q.pageSize,
    );
    const records = await repos.attendance.recordsForSessions(rows.map((r) => r.id));
    const items: AttendanceSessionList['items'] = [];
    for (const s of rows) {
      const period = frame.slotById.get(s.periodId);
      if (!period) continue;
      const roster = rosterOn(
        await sectionPlacements(repos, year.id, s.sectionId, s.date, s.date),
        s.sectionId,
        s.date,
      );
      items.push({
        sessionId: s.id,
        date: s.date,
        period: toPeriodView(period),
        section: sectionView(await sectionRef(repos, s.sectionId)),
        subject: { id: s.subjectId, name: s.subjectName, code: s.subjectCode },
        teacher: { id: s.teacherId, fullName: s.teacherName, staffCode: s.staffCode },
        counts: countsFor(
          roster,
          records.filter((r) => r.sessionId === s.id),
        ),
        updatedAt: s.updatedAt,
        updatedBy: s.updatedByName,
      });
    }
    return { items, page: q.page, pageSize: q.pageSize, total };
  }
}
