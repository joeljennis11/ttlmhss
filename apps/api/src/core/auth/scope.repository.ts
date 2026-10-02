import type { ScopeRef } from '@ttlmhss/shared';

/**
 * Reads the assignment data that defines a user's record-level scope. Resolved fresh on every
 * request, so assignment changes take effect immediately.
 *
 * Phase 6 adds teaching scope (sections/subjects/periods from the published timetable).
 */
export interface AuthScopeRepository {
  /** Sections the teacher is ACTIVE class teacher of, in the CURRENT academic year. */
  classTeacherSections(teacherId: string): Promise<ScopeRef[]>;
  /** Sections the student is ACTIVELY enrolled in, in the CURRENT academic year. */
  studentSections(studentId: string): Promise<ScopeRef[]>;
}
