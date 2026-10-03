import { z } from 'zod';

/**
 * Controlled values for business-critical states.
 *
 * One definition per concept, shared by the API (validation, database CHECK constraints are
 * kept in sync by tests) and the web app (labels, pickers). Never compare against bare string
 * literals elsewhere — import from here.
 *
 * School-configurable lists (exam names, grade bands, behaviour categories, achievement
 * categories, leave reasons shown to users, etc.) are DATA, not controlled values, unless the
 * specification fixes them. See docs/business-rules.md.
 */
export interface ControlledValueSet<T extends string> {
  readonly values: readonly T[];
  readonly schema: z.ZodType<T>;
  is(value: unknown): value is T;
}

export function controlledValues<const T extends readonly [string, ...string[]]>(
  values: T,
): ControlledValueSet<T[number]> {
  const set = new Set<string>(values);
  return Object.freeze({
    values,
    schema: z.enum(values) as unknown as z.ZodType<T[number]>,
    is: (value: unknown): value is T[number] => typeof value === 'string' && set.has(value),
  });
}

/** Account roles. CLASS TEACHER is not an account role: it is a Teacher with a class-teacher assignment (docs/permissions.md). */
export const UserRole = controlledValues(['ADMIN', 'TEACHER', 'STUDENT']);
export type UserRole = (typeof UserRole.values)[number];

/** Generic lifecycle for configurable/master records. INACTIVE replaces destructive deletion. */
export const RecordStatus = controlledValues(['ACTIVE', 'INACTIVE']);
export type RecordStatus = (typeof RecordStatus.values)[number];

/** BR-AY-02: exactly one CURRENT academic year at a time. */
export const AcademicYearStatus = controlledValues(['UPCOMING', 'CURRENT', 'CLOSED']);
export type AcademicYearStatus = (typeof AcademicYearStatus.values)[number];

/** A period slot is either a teaching period or a break (breaks never hold timetable assignments, BR-TT-11). */
export const PeriodKind = controlledValues(['LESSON', 'BREAK']);
export type PeriodKind = (typeof PeriodKind.values)[number];

export const Weekday = controlledValues(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);
export type Weekday = (typeof Weekday.values)[number];

/**
 * Enrolment (student academic history) status. ACTIVE = currently studying in that section/year;
 * the other four are the promotion outcomes from the specification (BR-ST-05).
 */
export const EnrolmentStatus = controlledValues([
  'ACTIVE',
  'PROMOTED',
  'TRANSFERRED',
  'NOT_PROMOTED',
  'LEFT',
]);
export type EnrolmentStatus = (typeof EnrolmentStatus.values)[number];

export const PromotionOutcome = controlledValues([
  'PROMOTED',
  'TRANSFERRED',
  'NOT_PROMOTED',
  'LEFT',
]);
export type PromotionOutcome = (typeof PromotionOutcome.values)[number];

/** BR-ATT-02. The display codes are exactly these five; nothing else is a valid status. */
export const AttendanceStatus = controlledValues(['-', 'P', 'A', 'L', 'C']);
export type AttendanceStatus = (typeof AttendanceStatus.values)[number];

export const ATTENDANCE_STATUS_LABELS: Readonly<Record<AttendanceStatus, string>> = Object.freeze({
  '-': 'Not Marked',
  P: 'Present',
  A: 'Absent',
  L: 'Leave',
  C: 'Excused',
});

/** Longer wording for help text and screen readers (Phase 7: C = permission / conditionally excused). */
export const ATTENDANCE_STATUS_DESCRIPTIONS: Readonly<Record<AttendanceStatus, string>> =
  Object.freeze({
    '-': 'Not marked',
    P: 'Present',
    A: 'Absent',
    L: 'Leave',
    C: 'Permission / conditionally excused',
  });

/** BR-ATT-07. OTHER requires a free-text description. */
export const LeaveReason = controlledValues(['MEDICAL', 'PERSONAL', 'SCHOOL_ACTIVITY', 'OTHER']);
export type LeaveReason = (typeof LeaveReason.values)[number];

export const LEAVE_REASON_LABELS: Readonly<Record<LeaveReason, string>> = Object.freeze({
  MEDICAL: 'Medical',
  PERSONAL: 'Personal',
  SCHOOL_ACTIVITY: 'School Activity',
  OTHER: 'Other',
});

/** BR-TT-07: DRAFT → (save) → PUBLISHED; the previous published version becomes SUPERSEDED. */
export const TimetableStatus = controlledValues(['DRAFT', 'PUBLISHED', 'SUPERSEDED']);
export type TimetableStatus = (typeof TimetableStatus.values)[number];

/** BR-MK-04/05: Save Draft → Submit (locks) → optionally Unlocked for audited correction. */
export const MarkSheetStatus = controlledValues(['DRAFT', 'SUBMITTED', 'UNLOCKED']);
export type MarkSheetStatus = (typeof MarkSheetStatus.values)[number];

/**
 * Phase 8B: an exam's marks lifecycle (separate from its ACTIVE/INACTIVE record status).
 * DRAFT — being set up, no mark entry, invisible to students; OPEN — marks can be entered and
 * submitted, submitted subjects are visible to students; CLOSED — marks are frozen (read-only).
 */
export const ExamStage = controlledValues(['DRAFT', 'OPEN', 'CLOSED']);
export type ExamStage = (typeof ExamStage.values)[number];

/** BR-RQ-01. */
export const RequestType = controlledValues([
  'ATTENDANCE_ISSUE',
  'RESULT_CLARIFICATION',
  'PROFILE_CORRECTION',
]);
export type RequestType = (typeof RequestType.values)[number];

export const RequestStatus = controlledValues(['OPEN', 'RESOLVED', 'REJECTED']);
export type RequestStatus = (typeof RequestStatus.values)[number];

/** BR-BH-02: behaviour ratings are integers 1–5. Labels are school-configurable data. */
export const BEHAVIOUR_RATING_MIN = 1;
export const BEHAVIOUR_RATING_MAX = 5;
export const BehaviourRatingSchema = z
  .number()
  .int()
  .min(BEHAVIOUR_RATING_MIN)
  .max(BEHAVIOUR_RATING_MAX);
export type BehaviourRating = 1 | 2 | 3 | 4 | 5;
