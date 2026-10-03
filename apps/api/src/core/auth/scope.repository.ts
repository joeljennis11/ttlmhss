import type { ScopeRef } from '@ttlmhss/shared';

/**
 * Reads the assignment data that defines a user's record-level scope. Resolved fresh on every
 * request, so assignment changes take effect immediately.
 *
 * Teaching scope (sections a teacher teaches) is read from the published timetable through
 * TimetableRepository (Phase 6); Phase 7 decides whether it also widens student access.
 */
export interface AuthScopeRepository {
  /** Sections the teacher is ACTIVE class teacher of, in the CURRENT academic year. */
  classTeacherSections(teacherId: string): Promise<ScopeRef[]>;
  /** Sections the student is ACTIVELY enrolled in, in the CURRENT academic year. */
  studentSections(studentId: string): Promise<ScopeRef[]>;
}
