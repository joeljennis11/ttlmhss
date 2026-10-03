import type {
  AttendanceStatus,
  EnrolmentStatus,
  LeaveReason,
  RecordStatus,
  Weekday,
} from '@ttlmhss/shared';

/**
 * Repository interfaces for period-wise attendance (Phase 7). Services depend on these; the Kysely
 * adapter in src/data/kysely/repositories/attendance implements them.
 */

/** A register: one class/section's lesson in one period on one date, with its lesson snapshot. */
export interface AttendanceSessionRecord {
  id: string;
  academicYearId: string;
  date: string;
  day: Weekday;
  periodId: string;
  sectionId: string;
  timetableEntryId: string;
  timetableVersionId: string;
  subjectId: string;
  subjectName: string;
  subjectCode: string | null;
  teacherId: string;
  teacherName: string;
  staffCode: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  updatedByName: string | null;
}

export interface NewAttendanceSession {
  id: string;
  academicYearId: string;
  date: string;
  day: Weekday;
  periodId: string;
  sectionId: string;
  timetableEntryId: string;
  timetableVersionId: string;
  subjectId: string;
  teacherId: string;
}

export interface AttendanceRecordRow {
  id: string;
  sessionId: string;
  academicYearId: string;
  date: string;
  periodId: string;
  enrolmentId: string;
  studentId: string;
  status: AttendanceStatus;
  leaveReason: LeaveReason | null;
  note: string | null;
  updatedAt: string;
  updatedByName: string | null;
}

/** A student's placement that covers a date (section roster candidate). */
export interface PlacementOnDate {
  enrolmentId: string;
  studentId: string;
  academicYearId: string;
  sectionId: string;
  rollNumber: string | null;
  enrolmentStatus: EnrolmentStatus;
  startedOn: string;
  endedOn: string | null;
  admissionNumber: string;
  fullName: string;
  studentStatus: RecordStatus;
}

export interface SessionFilter {
  academicYearId: string;
  from?: string;
  to?: string;
  sectionId?: string;
  periodId?: string;
  subjectId?: string;
  teacherId?: string;
}

export interface AttendanceRepository {
  findSession(
    academicYearId: string,
    date: string,
    periodId: string,
    sectionId: string,
  ): Promise<AttendanceSessionRecord | null>;
  sessionsForSection(
    sectionId: string,
    from: string,
    to: string,
  ): Promise<AttendanceSessionRecord[]>;
  sessionsForTeacher(teacherId: string, date: string): Promise<AttendanceSessionRecord[]>;
  createSession(session: NewAttendanceSession, actorUserId: string, now: string): Promise<void>;
  /**
   * Optimistic lock: move the register to the next revision only if it is still at `expected`.
   * Returns false when someone else saved first. `expected` null = increment unconditionally.
   */
  advanceRevision(
    sessionId: string,
    expected: number | null,
    actorUserId: string,
    now: string,
  ): Promise<boolean>;
  listSessions(
    filter: SessionFilter,
    offset: number,
    limit: number,
  ): Promise<{ rows: AttendanceSessionRecord[]; total: number }>;

  recordsForSessions(sessionIds: string[]): Promise<AttendanceRecordRow[]>;
  recordsForStudent(studentId: string, from: string, to: string): Promise<AttendanceRecordRow[]>;
  insertRecord(
    record: Omit<AttendanceRecordRow, 'updatedAt' | 'updatedByName'>,
    actorUserId: string,
    now: string,
  ): Promise<void>;
  updateRecord(
    id: string,
    change: { status: AttendanceStatus; leaveReason: LeaveReason | null; note: string | null },
    actorUserId: string,
    now: string,
  ): Promise<void>;

  /** Placements in the section (any status) whose dates overlap [from, to]. */
  placementsInSection(
    academicYearId: string,
    sectionId: string,
    from: string,
    to: string,
  ): Promise<PlacementOnDate[]>;
  /** Every placement of these students in the year (any section) overlapping [from, to]. */
  placementsOfStudents(
    studentIds: string[],
    academicYearId: string,
    from: string,
    to: string,
  ): Promise<PlacementOnDate[]>;

  countForStudent(studentId: string): Promise<number>;
}
