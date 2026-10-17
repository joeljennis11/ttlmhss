import type { TimetableRequestKind, TimetableRequestStatus, Weekday } from '@ttlmhss/shared';

/**
 * Repository interface for timetable change requests (Phase 12C). The Kysely adapter lives in
 * src/data/kysely/repositories/timetable.
 */
export interface TimetableChangeRequestRecord {
  id: string;
  academicYearId: string;
  sectionId: string;
  sectionLabel: string;
  day: Weekday;
  periodId: string;
  periodLabel: string;
  kind: TimetableRequestKind;
  currentSubjectId: string | null;
  currentSubjectName: string | null;
  currentTeacherId: string | null;
  currentTeacherName: string | null;
  proposedSubjectId: string | null;
  proposedSubjectName: string | null;
  proposedTeacherId: string | null;
  proposedTeacherName: string | null;
  reason: string;
  status: TimetableRequestStatus;
  reviewNote: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  revision: number;
  requestedBy: string;
  requestedByName: string;
  createdAt: string;
}

export interface NewTimetableChangeRequest {
  id: string;
  academicYearId: string;
  sectionId: string;
  day: Weekday;
  periodId: string;
  kind: TimetableRequestKind;
  currentSubjectId: string | null;
  currentTeacherId: string | null;
  proposedSubjectId: string | null;
  proposedTeacherId: string | null;
  reason: string;
  requestedBy: string;
}

export interface TimetableChangeRequestFilter {
  academicYearId: string;
  status: TimetableRequestStatus | null;
  /** null = every section. */
  sectionIds: string[] | null;
  /** null = anyone's. */
  requestedBy: string | null;
}

export interface TimetableChangeRequestRepository {
  find(id: string): Promise<TimetableChangeRequestRecord | null>;
  /** Newest first. */
  list(filter: TimetableChangeRequestFilter): Promise<TimetableChangeRequestRecord[]>;
  count(filter: TimetableChangeRequestFilter): Promise<number>;
  create(r: NewTimetableChangeRequest, now: string): Promise<void>;
  /** Applies only while the row has `expectedRevision` (then revision + 1). */
  setStatus(
    id: string,
    expectedRevision: number,
    change: {
      status: TimetableRequestStatus;
      reviewNote?: string | null;
      reviewedBy?: string | null;
      reviewedAt?: string | null;
    },
    actorUserId: string,
    now: string,
  ): Promise<boolean>;
}
