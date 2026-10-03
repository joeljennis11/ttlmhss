import {
  countAttendance,
  isAttendanceLocked,
  attendanceLockDate,
  weekdayOf,
  type AttendanceAccess,
  type AttendanceContext,
  type AttendanceCounts,
  type AttendanceStatus,
  type Permission,
  type Weekday,
} from '@ttlmhss/shared';
import { AuditRecorder, type AuditEvent } from '../../core/audit/audit-recorder.js';
import type { Principal } from '../../core/auth/access.js';
import type { AuthorizationService } from '../../core/auth/authorization.service.js';
import { ConflictError } from '../../core/errors/app-errors.js';
import { toTimestamp, type Clock } from '../../core/utils/clock.js';
import type { DataStore, Repositories } from '../../data/data-store.js';
import type { AcademicYearRecord, PeriodRecord } from '../config/config.repository.js';
import {
  DAY_NAMES,
  loadFrame,
  sectionRef,
  toPeriodView,
  type WeekFrame,
} from '../timetable/timetable-service.js';
import type {
  TimetableEntryRecord,
  TimetableVersionRecord,
} from '../timetable/timetable.repository.js';
import type {
  AttendanceRecordRow,
  AttendanceSessionRecord,
  PlacementOnDate,
} from './attendance.repository.js';

export interface RequestContext {
  principal: Principal | null;
  requestId: string | null;
}

export interface AttendanceServiceDeps {
  dataStore: DataStore;
  clock: Clock;
  authorization: AuthorizationService;
}

export interface WriteScope {
  repos: Repositories;
  now: string;
  actor: Principal;
  audit(event: AuditEvent): Promise<void>;
}

/** Calendar dates ("today") are taken in the school's time zone (Tamil Nadu, India). */
const SCHOOL_TIME_ZONE = 'Asia/Kolkata';
const SCHOOL_UTC_OFFSET_MINUTES = 330;

/**
 * The first instant (UTC ISO) after the school day `date` ends. A timetable version published
 * before this moment was in force on that date.
 */
export function endOfSchoolDay(date: string): string {
  const midnightUtc = Date.parse(`${date}T00:00:00.000Z`);
  return new Date(midnightUtc + 86_400_000 - SCHOOL_UTC_OFFSET_MINUTES * 60_000).toISOString();
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** The lesson behind a register, resolved from the timetable — never from the request. */
export interface Lesson {
  year: AcademicYearRecord;
  date: string;
  day: Weekday;
  frame: WeekFrame;
  period: PeriodRecord;
  section: Awaited<ReturnType<typeof sectionRef>>;
  /** The saved register, if any (its snapshot wins over today's timetable). */
  session: AttendanceSessionRecord | null;
  timetableEntryId: string;
  timetableVersionId: string;
  subject: { id: string; name: string; code: string | null };
  teacher: { id: string; fullName: string; staffCode: string };
}

export function lessonContext(lesson: Lesson): AttendanceContext {
  const { active: _a, label: _l, ...section } = lesson.section;
  return {
    date: lesson.date,
    day: lesson.day,
    academicYear: { id: lesson.year.id, label: lesson.year.label, status: lesson.year.status },
    period: toPeriodView(lesson.period),
    section,
    subject: lesson.subject,
    teacher: lesson.teacher,
    timetableEntryId: lesson.timetableEntryId,
    timetableVersionId: lesson.timetableVersionId,
  };
}

/** Audit snapshot of where a record belongs (names included so history stays readable). */
export function describeLesson(lesson: Lesson) {
  return {
    academicYearId: lesson.year.id,
    academicYear: lesson.year.label,
    date: lesson.date,
    periodId: lesson.period.id,
    period: lesson.period.label,
    sectionId: lesson.section.sectionId,
    classSection: lesson.section.label,
    subjectId: lesson.subject.id,
    subject: lesson.subject.name,
    teacherId: lesson.teacher.id,
    teacher: lesson.teacher.fullName,
    timetableEntryId: lesson.timetableEntryId,
    timetableVersionId: lesson.timetableVersionId,
  };
}

/** A student on a register: placed in that section on that date. */
export interface RosterStudent {
  studentId: string;
  enrolmentId: string;
  rollNumber: string | null;
  admissionNumber: string;
  fullName: string;
}

/** Roll number order (numeric when possible), then name. */
export function byRoll(
  a: { rollNumber: string | null; fullName: string },
  b: { rollNumber: string | null; fullName: string },
) {
  if (a.rollNumber && b.rollNumber && a.rollNumber !== b.rollNumber) {
    return a.rollNumber.localeCompare(b.rollNumber, undefined, { numeric: true });
  }
  if (a.rollNumber && !b.rollNumber) return -1;
  if (!a.rollNumber && b.rollNumber) return 1;
  return a.fullName.localeCompare(b.fullName);
}

/**
 * Who is placed where on a date (BR-ATT-10). A student's placement on a date is the newest one in
 * the year that covers it — on a class-change day the new class wins. A deactivated student whose
 * placement is still open is not on any register; a closed placement (promoted, transferred, left)
 * still counts for the dates it covered.
 */
export function placementOn(
  placements: readonly PlacementOnDate[],
  studentId: string,
  date: string,
): PlacementOnDate | null {
  let best: PlacementOnDate | null = null;
  for (const p of placements) {
    if (p.studentId !== studentId) continue;
    if (p.startedOn > date || (p.endedOn !== null && p.endedOn < date)) continue;
    if (!best || p.startedOn > best.startedOn) best = p;
  }
  if (!best) return null;
  if (best.enrolmentStatus === 'ACTIVE' && best.studentStatus !== 'ACTIVE') return null;
  return best;
}

/** Students placed in a section over a date range, with every placement needed to decide. */
export async function sectionPlacements(
  repos: Repositories,
  yearId: string,
  sectionId: string,
  from: string,
  to: string,
): Promise<PlacementOnDate[]> {
  const inSection = await repos.attendance.placementsInSection(yearId, sectionId, from, to);
  const ids = [...new Set(inSection.map((p) => p.studentId))];
  return repos.attendance.placementsOfStudents(ids, yearId, from, to);
}

export function rosterOn(
  placements: readonly PlacementOnDate[],
  sectionId: string,
  date: string,
): RosterStudent[] {
  const ids = [...new Set(placements.map((p) => p.studentId))];
  const roster: RosterStudent[] = [];
  for (const id of ids) {
    const p = placementOn(placements, id, date);
    if (p && p.sectionId === sectionId) {
      roster.push({
        studentId: p.studentId,
        enrolmentId: p.enrolmentId,
        rollNumber: p.rollNumber,
        admissionNumber: p.admissionNumber,
        fullName: p.fullName,
      });
    }
  }
  return roster.sort(byRoll);
}

/** Lessons of a section on a date: saved registers first, then the timetable in force that day. */
export interface DayLesson {
  period: PeriodRecord;
  session: AttendanceSessionRecord | null;
  timetableEntryId: string;
  timetableVersionId: string;
  subject: Lesson['subject'];
  teacher: Lesson['teacher'];
}

/**
 * Base of the attendance services: authorize first; every change and its audit entries in ONE
 * transaction (a register is saved completely or not at all).
 */
export abstract class AttendanceServiceBase {
  constructor(protected readonly deps: AttendanceServiceDeps) {}

  protected get repos(): Repositories {
    return this.deps.dataStore.repositories;
  }

  protected authorize(ctx: RequestContext, permission: Permission): Principal {
    return this.deps.authorization.authorize(ctx.principal, permission);
  }

  protected isAdmin(principal: Principal): boolean {
    return this.deps.authorization.isAdmin(principal);
  }

  /** Class teacher of this section in THIS academic year (not merely in some year). */
  protected isClassTeacher(principal: Principal, yearId: string, sectionId: string): boolean {
    return principal.classTeacherOf.some(
      (s) => s.sectionId === sectionId && s.academicYearId === yearId,
    );
  }

  /** May manage the whole class's attendance (all periods, L and C, multi-period). */
  protected canManageClass(principal: Principal, yearId: string, sectionId: string): boolean {
    if (this.isAdmin(principal)) return true;
    return (
      principal.permissions.has('attendance.manage') &&
      this.isClassTeacher(principal, yearId, sectionId)
    );
  }

  protected today(): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: SCHOOL_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(this.deps.clock.now());
  }

  protected async write<T>(
    ctx: RequestContext,
    permission: Permission,
    work: (scope: WriteScope) => Promise<T>,
  ): Promise<T> {
    const actor = this.authorize(ctx, permission);
    return this.deps.dataStore.transaction(async (repos) => {
      const recorder = new AuditRecorder(repos.auditLogs, this.deps.clock);
      return work({
        repos,
        actor,
        now: toTimestamp(this.deps.clock.now()),
        audit: async (event) => {
          await recorder.record(event, { actorUserId: actor.userId, requestId: ctx.requestId });
        },
      });
    });
  }

  /** The academic year a date belongs to (the CURRENT one if several could match). */
  protected async yearOf(repos: Repositories, date: string): Promise<AcademicYearRecord | null> {
    const years = (await repos.academicYears.list()).filter(
      (y) => y.startDate <= date && date <= y.endDate,
    );
    return years.find((y) => y.status === 'CURRENT') ?? years[0] ?? null;
  }

  protected async requireYear(repos: Repositories, date: string): Promise<AcademicYearRecord> {
    const year = await this.yearOf(repos, date);
    if (!year) throw new ConflictError(`${date} is not within any academic year.`);
    return year;
  }

  protected requireSchoolDay(year: AcademicYearRecord, date: string): Weekday {
    const day = weekdayOf(date);
    if (!(year.workingDays ?? []).includes(day)) {
      throw new ConflictError(
        `${DAY_NAMES[day]} ${date} is not a working day in ${year.label}. Attendance is taken on working days only.`,
      );
    }
    return day;
  }

  /**
   * Resolve the lesson for a date + period + section (BR-ATT-04): the saved register if one exists,
   * otherwise the timetable version in force on that date. Breaks, free periods and dates without
   * a published timetable have no lesson.
   */
  protected async resolveLesson(
    repos: Repositories,
    date: string,
    periodId: string,
    sectionId: string,
  ): Promise<Lesson> {
    const year = await this.requireYear(repos, date);
    const day = this.requireSchoolDay(year, date);
    const frame = await loadFrame(repos, year);
    const period = frame.slotById.get(periodId);
    if (!period)
      throw new ConflictError(`That period is not part of the ${year.label} school day.`);
    if (period.kind === 'BREAK') {
      throw new ConflictError(`${period.label} is a break. Attendance is taken for lessons only.`);
    }
    const section = await sectionRef(repos, sectionId);
    const session = await repos.attendance.findSession(year.id, date, periodId, sectionId);
    if (session) {
      return {
        year,
        date,
        day,
        frame,
        period,
        section,
        session,
        timetableEntryId: session.timetableEntryId,
        timetableVersionId: session.timetableVersionId,
        subject: { id: session.subjectId, name: session.subjectName, code: session.subjectCode },
        teacher: {
          id: session.teacherId,
          fullName: session.teacherName,
          staffCode: session.staffCode,
        },
      };
    }
    const version = await repos.timetable.versionInForce(year.id, endOfSchoolDay(date));
    if (!version) {
      throw new ConflictError(
        `There was no published timetable for ${year.label} on ${date}, so there is no lesson to take attendance for.`,
      );
    }
    const entry = await repos.timetable.sectionSlot(version.id, sectionId, day, periodId);
    if (!entry) {
      throw new ConflictError(
        `${section.label} has no lesson in ${period.label} on ${DAY_NAMES[day]} (free period).`,
      );
    }
    return {
      year,
      date,
      day,
      frame,
      period,
      section,
      session: null,
      timetableEntryId: entry.id,
      timetableVersionId: version.id,
      subject: { id: entry.subjectId, name: entry.subjectName, code: entry.subjectCode },
      teacher: { id: entry.teacherId, fullName: entry.teacherName, staffCode: entry.staffCode },
    };
  }

  /** Cutoff state of a date (Phase 4 policy; no saved policy = never locks). */
  protected async lockState(repos: Repositories, date: string) {
    const policy = await repos.attendancePolicy.get();
    const [y, m] = date.split('-').map(Number) as [number, number];
    const lockDate = policy ? attendanceLockDate(policy, y, m) : null;
    const locked = policy ? isAttendanceLocked(policy, date, this.today()) : false;
    return { locked, lockDate };
  }

  /** What this user may do in this register (BR-ATT-05/06/11/12). */
  protected async accessFor(
    repos: Repositories,
    principal: Principal,
    lesson: Lesson,
  ): Promise<AttendanceAccess & { canView: boolean }> {
    const manage = this.canManageClass(principal, lesson.year.id, lesson.section.sectionId);
    const ownLesson =
      principal.teacherId !== null &&
      principal.teacherId === lesson.teacher.id &&
      principal.permissions.has('attendance.mark');
    const canView = this.isAdmin(principal) || manage || ownLesson;
    const canMark = manage || ownLesson;
    const { locked, lockDate } = await this.lockState(repos, lesson.date);
    const future = lesson.date > this.today();
    const canOverride = locked && principal.permissions.has('attendance.override');
    const editable = canMark && !future && (!locked || canOverride);
    const readOnlyReason = !canMark
      ? 'You can view this register but not change it.'
      : future
        ? 'This lesson has not happened yet.'
        : locked && !canOverride
          ? `Attendance for this date is locked (since ${lockDate}). Only an administrator can change it.`
          : null;
    return {
      canView,
      canMark,
      canManage: manage,
      locked,
      lockDate,
      canOverride,
      editable,
      readOnlyReason,
    };
  }

  /** Every lesson of a section on a date (registers saved that day + the timetable in force). */
  protected async sectionLessons(
    repos: Repositories,
    year: AcademicYearRecord,
    frame: WeekFrame,
    sectionId: string,
    date: string,
    cache?: VersionCache,
  ): Promise<DayLesson[]> {
    const day = weekdayOf(date);
    const sessions = (await repos.attendance.sessionsForSection(sectionId, date, date)).filter(
      (s) => s.academicYearId === year.id,
    );
    const byPeriod = new Map(sessions.map((s) => [s.periodId, s]));
    const versions = cache ?? new VersionCache(repos, year.id);
    const entries = await versions.entriesOn(date, { sectionId, day });
    const out: DayLesson[] = [];
    for (const slot of frame.slots) {
      if (slot.kind !== 'LESSON') continue;
      const session = byPeriod.get(slot.id);
      if (session) {
        out.push({
          period: slot,
          session,
          timetableEntryId: session.timetableEntryId,
          timetableVersionId: session.timetableVersionId,
          subject: { id: session.subjectId, name: session.subjectName, code: session.subjectCode },
          teacher: {
            id: session.teacherId,
            fullName: session.teacherName,
            staffCode: session.staffCode,
          },
        });
        continue;
      }
      const entry = entries?.entries.find((e) => e.periodId === slot.id);
      if (entry && entries) {
        out.push({
          period: slot,
          session: null,
          timetableEntryId: entry.id,
          timetableVersionId: entries.version.id,
          subject: { id: entry.subjectId, name: entry.subjectName, code: entry.subjectCode },
          teacher: { id: entry.teacherId, fullName: entry.teacherName, staffCode: entry.staffCode },
        });
      }
    }
    return out;
  }
}

/** Timetable versions of a year and their entries, loaded once per request. */
export class VersionCache {
  private versions: Promise<TimetableVersionRecord[]> | null = null;
  private entries = new Map<string, Promise<TimetableEntryRecord[]>>();

  constructor(
    private readonly repos: Repositories,
    private readonly yearId: string,
  ) {}

  /** The version in force at the end of the school day `date`. */
  async versionOn(date: string): Promise<TimetableVersionRecord | null> {
    this.versions ??= this.repos.timetable.listVersions(this.yearId);
    const boundary = endOfSchoolDay(date);
    const list = await this.versions;
    return (
      list.find(
        (v) => v.status !== 'DRAFT' && v.publishedAt !== null && v.publishedAt < boundary,
      ) ?? null
    );
  }

  async entriesOn(
    date: string,
    filter: { sectionId?: string; teacherId?: string; day: Weekday },
  ): Promise<{ version: TimetableVersionRecord; entries: TimetableEntryRecord[] } | null> {
    const version = await this.versionOn(date);
    if (!version) return null;
    let all = this.entries.get(version.id);
    if (!all) {
      all = this.repos.timetable.listEntries(version.id);
      this.entries.set(version.id, all);
    }
    const entries = (await all).filter(
      (e) =>
        e.day === filter.day &&
        (!filter.sectionId || e.sectionId === filter.sectionId) &&
        (!filter.teacherId || e.teacherId === filter.teacherId),
    );
    return { version, entries };
  }
}

/** Status of each roster student in one register ('-' when no record). */
export function statusesFor(
  roster: readonly { studentId: string }[],
  records: readonly AttendanceRecordRow[],
): AttendanceStatus[] {
  const byStudent = new Map(records.map((r) => [r.studentId, r.status]));
  return roster.map((s) => byStudent.get(s.studentId) ?? '-');
}

export function countsFor(
  roster: readonly { studentId: string }[],
  records: readonly AttendanceRecordRow[],
): AttendanceCounts {
  return countAttendance(statusesFor(roster, records));
}
