import {
  countAttendance,
  type AttendanceRegisterView,
  type AttendanceSaveSchema,
  type AttendanceStatus,
  type AttendanceStudentDaySaveSchema,
  type AttendanceStudentDayView,
  type LeaveReason,
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
import { loadFrame, sectionRef, toPeriodView } from '../timetable/timetable-service.js';
import type { AttendanceRecordRow } from './attendance.repository.js';
import {
  AttendanceServiceBase,
  byRoll,
  countsFor,
  describeLesson,
  lessonContext,
  placementOn,
  rosterOn,
  sectionPlacements,
  type Lesson,
  type RequestContext,
  type RosterStudent,
  type WriteScope,
} from './attendance-service.js';

type SaveInput = z.output<typeof AttendanceSaveSchema>;
type StudentDayInput = z.output<typeof AttendanceStudentDaySaveSchema>;

const NO_ACCESS = 'You can take attendance only for your own timetabled lessons.';
const MANAGED: readonly AttendanceStatus[] = ['L', 'C'];

interface Change {
  status: AttendanceStatus;
  leaveReason: LeaveReason | null;
  note: string | null;
}

const sameAs = (r: AttendanceRecordRow | undefined, c: Change) =>
  r
    ? r.status === c.status && r.leaveReason === c.leaveReason && (r.note ?? null) === c.note
    : c.status === '-';

/**
 * Registers (BR-ATT-01…13): open the register of a lesson, save it (all students in one
 * transaction, optimistic locking on the register revision), and the class teacher's
 * multi-period Leave / Excused for one student's day.
 */
export class AttendanceRegisterService extends AttendanceServiceBase {
  async register(
    ctx: RequestContext,
    date: string,
    periodId: string,
    sectionId: string,
  ): Promise<AttendanceRegisterView> {
    const principal = this.authorize(ctx, 'attendance.view');
    const repos = this.repos;
    const lesson = await this.resolveLesson(repos, date, periodId, sectionId);
    return this.buildRegister(repos, principal, lesson);
  }

  private async buildRegister(
    repos: Repositories,
    principal: Principal,
    lesson: Lesson,
  ): Promise<AttendanceRegisterView> {
    const { canView, ...access } = await this.accessFor(repos, principal, lesson);
    if (!canView) throw new ForbiddenError(NO_ACCESS);
    const placements = await sectionPlacements(
      repos,
      lesson.year.id,
      lesson.section.sectionId,
      lesson.date,
      lesson.date,
    );
    const roster = rosterOn(placements, lesson.section.sectionId, lesson.date);
    const records = lesson.session
      ? await repos.attendance.recordsForSessions([lesson.session.id])
      : [];
    const byStudent = new Map(records.map((r) => [r.studentId, r]));
    const onRoll = new Set(roster.map((s) => s.studentId));
    // Students with a record who are no longer placed here stay visible (history), read-only.
    const extra = records.filter((r) => !onRoll.has(r.studentId));
    const extraPeople = extra.length
      ? await repos.attendance.placementsOfStudents(
          extra.map((r) => r.studentId),
          lesson.year.id,
          lesson.year.startDate,
          lesson.year.endDate,
        )
      : [];
    const rows = [
      ...roster.map((s) => ({ ...s, onRoll: true })),
      ...extra.map((r) => {
        const p = extraPeople.find((x) => x.studentId === r.studentId);
        return {
          studentId: r.studentId,
          enrolmentId: r.enrolmentId,
          rollNumber: p?.rollNumber ?? null,
          admissionNumber: p?.admissionNumber ?? '',
          fullName: p?.fullName ?? 'Former student',
          onRoll: false,
        };
      }),
    ].sort(byRoll);
    return {
      context: lessonContext(lesson),
      session: lesson.session
        ? {
            id: lesson.session.id,
            revision: lesson.session.revision,
            updatedAt: lesson.session.updatedAt,
            updatedBy: lesson.session.updatedByName,
          }
        : null,
      rows: rows.map((s) => {
        const r = byStudent.get(s.studentId);
        const status = r?.status ?? '-';
        return {
          studentId: s.studentId,
          enrolmentId: s.enrolmentId,
          rollNumber: s.rollNumber,
          admissionNumber: s.admissionNumber,
          fullName: s.fullName,
          status,
          leaveReason: r?.leaveReason ?? null,
          note: r?.note ?? null,
          onRoll: s.onRoll,
          editable: access.editable && s.onRoll && (access.canManage || !MANAGED.includes(status)),
          updatedAt: r?.updatedAt ?? null,
          updatedBy: r?.updatedByName ?? null,
        };
      }),
      counts: countsFor(roster, records),
      access,
    };
  }

  /** Write gates shared by register and student-day saves (future date, cutoff, override). */
  private async checkWritable(
    repos: Repositories,
    principal: Principal,
    lesson: Lesson,
    override: { reason: string } | null,
  ) {
    const access = await this.accessFor(repos, principal, lesson);
    if (!access.canMark) throw new ForbiddenError(NO_ACCESS);
    if (lesson.date > this.today()) {
      throw new ConflictError('Attendance cannot be taken for a date in the future.');
    }
    if (access.locked) {
      if (!access.canOverride) {
        throw new ForbiddenError(
          `Attendance for ${lesson.date} is locked (since ${access.lockDate}). Only an administrator can change it.`,
        );
      }
      if (!override) {
        throw fieldConflict(
          'override',
          `Attendance for ${lesson.date} is locked. Confirm an administrator override and give a reason.`,
        );
      }
    }
    return { access, overriding: access.locked };
  }

  /** Ensure the register row exists and advance its revision (optimistic lock when `expected`). */
  private async touchSession(
    { repos, now, actor }: WriteScope,
    lesson: Lesson,
    expected: number | null | 'any',
  ): Promise<string> {
    if (!lesson.session) {
      if (expected !== null && expected !== 'any') {
        throw new ConflictError(
          'This register was changed by someone else. Reload it to see the latest attendance.',
        );
      }
      const id = newId();
      await repos.attendance.createSession(
        {
          id,
          academicYearId: lesson.year.id,
          date: lesson.date,
          day: lesson.day,
          periodId: lesson.period.id,
          sectionId: lesson.section.sectionId,
          timetableEntryId: lesson.timetableEntryId,
          timetableVersionId: lesson.timetableVersionId,
          subjectId: lesson.subject.id,
          teacherId: lesson.teacher.id,
        },
        actor.userId,
        now,
      );
      return id;
    }
    const s = lesson.session;
    if (expected === null) {
      throw new ConflictError(
        `This register was saved by ${s.updatedByName ?? 'someone else'} while you were working. Reload it to see the latest attendance.`,
      );
    }
    const advanced = await repos.attendance.advanceRevision(
      s.id,
      expected === 'any' ? null : expected,
      actor.userId,
      now,
    );
    if (!advanced) {
      throw new ConflictError(
        `This register was saved by ${s.updatedByName ?? 'someone else'} while you were working. Reload it to see the latest attendance.`,
      );
    }
    return s.id;
  }

  /** Write one student's record and its audit entry (BR-ATT-13). */
  private async apply(
    scope: WriteScope,
    lesson: Lesson,
    sessionId: string,
    student: { studentId: string; enrolmentId: string; fullName: string; admissionNumber: string },
    existing: AttendanceRecordRow | undefined,
    change: Change,
    meta: { overrideReason: string | null; multiPeriod: boolean },
  ) {
    const { repos, now, actor, audit } = scope;
    let id: string;
    if (existing) {
      id = existing.id;
      await repos.attendance.updateRecord(id, change, actor.userId, now);
    } else {
      id = newId();
      await repos.attendance.insertRecord(
        {
          id,
          sessionId,
          academicYearId: lesson.year.id,
          date: lesson.date,
          periodId: lesson.period.id,
          enrolmentId: student.enrolmentId,
          studentId: student.studentId,
          ...change,
        },
        actor.userId,
        now,
      );
    }
    const where = {
      ...describeLesson(lesson),
      studentId: student.studentId,
      student: student.fullName,
      admissionNumber: student.admissionNumber,
    };
    await audit({
      action: meta.overrideReason ? 'attendance.override' : 'attendance.marked',
      entityType: 'attendance_record',
      entityId: id,
      before: {
        ...where,
        status: existing?.status ?? '-',
        leaveReason: existing?.leaveReason ?? null,
        note: existing?.note ?? null,
      },
      after: {
        ...where,
        ...change,
        override: meta.overrideReason !== null,
        multiPeriod: meta.multiPeriod,
      },
      reason:
        meta.overrideReason ??
        (change.leaveReason
          ? `${change.leaveReason}${change.note ? `: ${change.note}` : ''}`
          : change.note),
    });
  }

  /** Save a register: every changed student in one transaction, or nothing. */
  async save(ctx: RequestContext, input: SaveInput): Promise<AttendanceRegisterView> {
    return this.write(ctx, 'attendance.mark', async (scope) => {
      const { repos, actor } = scope;
      const lesson = await this.resolveLesson(repos, input.date, input.periodId, input.sectionId);
      const { access } = await this.checkWritable(repos, actor, lesson, input.override);

      const placements = await sectionPlacements(
        repos,
        lesson.year.id,
        lesson.section.sectionId,
        lesson.date,
        lesson.date,
      );
      const roster = new Map(
        rosterOn(placements, lesson.section.sectionId, lesson.date).map((s) => [s.studentId, s]),
      );
      const existing = new Map(
        (lesson.session ? await repos.attendance.recordsForSessions([lesson.session.id]) : []).map(
          (r) => [r.studentId, r],
        ),
      );

      const changes: {
        student: RosterStudent;
        before: AttendanceRecordRow | undefined;
        change: Change;
      }[] = [];
      for (const [i, mark] of input.marks.entries()) {
        const student = roster.get(mark.studentId);
        if (!student) {
          throw fieldConflict(
            `marks.${i}.studentId`,
            `That student is not in ${lesson.section.label} on ${lesson.date}.`,
          );
        }
        const before = existing.get(mark.studentId);
        const change: Change = {
          status: mark.status,
          leaveReason: mark.leaveReason,
          note: mark.note,
        };
        if (sameAs(before, change)) continue;
        if (!access.canManage) {
          if (MANAGED.includes(change.status)) {
            throw new ForbiddenError(
              'Only the class teacher or an administrator can set Leave (L) or Excused (C).',
            );
          }
          if (before && MANAGED.includes(before.status)) {
            throw new ForbiddenError(
              `${student.fullName} is marked ${before.status} by the class teacher; only the class teacher or an administrator can change it.`,
            );
          }
        }
        changes.push({ student, before, change });
      }
      if (changes.length === 0) {
        return this.buildRegister(repos, actor, lesson);
      }
      const sessionId = await this.touchSession(scope, lesson, input.revision);
      for (const c of changes) {
        await this.apply(scope, lesson, sessionId, c.student, c.before, c.change, {
          overrideReason: input.override?.reason ?? null,
          multiPeriod: false,
        });
      }
      const fresh = await this.resolveLesson(repos, input.date, input.periodId, input.sectionId);
      return this.buildRegister(repos, actor, fresh);
    });
  }

  // ---- A student's day (class teacher) --------------------------------------------------------

  private async studentDayScope(
    repos: Repositories,
    principal: Principal,
    studentId: string,
    date: string,
  ) {
    const student = await repos.students.find(studentId);
    if (!student) throw new NotFoundError('That student was not found.');
    const year = await this.requireYear(repos, date);
    const placements = await repos.attendance.placementsOfStudents(
      [studentId],
      year.id,
      date,
      date,
    );
    const placement = placementOn(placements, studentId, date);
    if (!placement) {
      // Do not reveal placements to people who could not see them anyway.
      if (!this.isAdmin(principal) && principal.classTeacherOf.length === 0) {
        throw new ForbiddenError('You can only manage attendance of your own class.');
      }
      throw new ConflictError(`${student.fullName} is not placed in any class on ${date}.`);
    }
    if (!this.canManageClass(principal, year.id, placement.sectionId)) {
      throw new ForbiddenError('You can only manage attendance of your own class.');
    }
    return { student, year, placement };
  }

  async studentDay(
    ctx: RequestContext,
    studentId: string,
    date: string,
  ): Promise<AttendanceStudentDayView> {
    const principal = this.authorize(ctx, 'attendance.view');
    return this.buildStudentDay(this.repos, principal, studentId, date);
  }

  private async buildStudentDay(
    repos: Repositories,
    principal: Principal,
    studentId: string,
    date: string,
  ): Promise<AttendanceStudentDayView> {
    const { student, year, placement } = await this.studentDayScope(
      repos,
      principal,
      studentId,
      date,
    );
    const day = this.requireSchoolDay(year, date);
    const frame = await loadFrame(repos, year);
    const lessons = await this.sectionLessons(repos, year, frame, placement.sectionId, date);
    const records = await repos.attendance.recordsForStudent(studentId, date, date);
    const byPeriod = new Map(records.map((r) => [r.periodId, r]));
    const section = await sectionRef(repos, placement.sectionId);
    const { active: _a, label: _l, ...sectionView } = section;
    const periods = lessons.map((l) => {
      const r = byPeriod.get(l.period.id);
      return {
        period: toPeriodView(l.period),
        subject: l.subject,
        teacher: l.teacher,
        status: r?.status ?? ('-' as const),
        leaveReason: r?.leaveReason ?? null,
        note: r?.note ?? null,
      };
    });
    const { locked, lockDate } = await this.lockState(repos, date);
    const future = date > this.today();
    const canOverride = locked && principal.permissions.has('attendance.override');
    const editable = !future && (!locked || canOverride) && lessons.length > 0;
    return {
      date,
      day,
      academicYear: { id: year.id, label: year.label, status: year.status },
      student: {
        id: student.id,
        fullName: student.fullName,
        admissionNumber: student.admissionNumber,
        rollNumber: placement.rollNumber,
      },
      section: sectionView,
      periods,
      counts: countAttendance(periods.map((p) => p.status)),
      access: {
        canMark: true,
        canManage: true,
        locked,
        lockDate,
        canOverride,
        editable,
        readOnlyReason: future
          ? 'This day has not happened yet.'
          : locked && !canOverride
            ? `Attendance for this date is locked (since ${lockDate}). Only an administrator can change it.`
            : lessons.length === 0
              ? 'There are no lessons on this day.'
              : null,
      },
    };
  }

  /** BR-ATT-06/07: Leave or Excused for several periods of one student's day, all or nothing. */
  async saveStudentDay(
    ctx: RequestContext,
    input: StudentDayInput,
  ): Promise<AttendanceStudentDayView> {
    return this.write(ctx, 'attendance.manage', async (scope) => {
      const { repos, actor } = scope;
      const { student, placement } = await this.studentDayScope(
        repos,
        actor,
        input.studentId,
        input.date,
      );
      const change: Change = {
        status: input.status,
        leaveReason: input.leaveReason,
        note: input.note,
      };
      for (const [i, periodId] of input.periodIds.entries()) {
        let lesson: Lesson;
        try {
          lesson = await this.resolveLesson(repos, input.date, periodId, placement.sectionId);
        } catch (error) {
          if (error instanceof ConflictError) {
            throw fieldConflict(`periodIds.${i}`, error.message);
          }
          throw error;
        }
        await this.checkWritable(repos, actor, lesson, input.override);
        const before = lesson.session
          ? (await repos.attendance.recordsForSessions([lesson.session.id])).find(
              (r) => r.studentId === student.id,
            )
          : undefined;
        if (sameAs(before, change)) continue;
        const sessionId = await this.touchSession(scope, lesson, 'any');
        await this.apply(
          scope,
          lesson,
          sessionId,
          {
            studentId: student.id,
            enrolmentId: placement.enrolmentId,
            fullName: student.fullName,
            admissionNumber: student.admissionNumber,
          },
          before,
          change,
          { overrideReason: input.override?.reason ?? null, multiPeriod: true },
        );
      }
      return this.buildStudentDay(repos, actor, input.studentId, input.date);
    });
  }
}
