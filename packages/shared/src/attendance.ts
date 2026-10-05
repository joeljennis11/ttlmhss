import { z } from 'zod';
import { AttendanceStatus, LeaveReason, Weekday } from './controlled-values.js';
import {
  TimetablePeriodViewSchema,
  TimetableSectionRefSchema,
  TimetableYearRefSchema,
} from './timetable.js';
import {
  IdSchema,
  IsoDateSchema,
  PAGE_SIZE_MAX,
  optionalText,
  requiredText,
} from './validation.js';

/*
 * Phase 7 — Period-wise attendance contracts.
 *
 *   Published timetable (version in force on the date)
 *     → Date + Period → Teacher + Subject + Class/Section (one "register" = attendance session)
 *     → students placed in that section on that date (enrolments)
 *     → one attendance record per student per period.
 *
 * Statuses: '-' Not marked · 'P' Present · 'A' Absent · 'L' Leave · 'C' Permission / excused.
 * Attendance % = P / (P + A) × 100; L, C and '-' are outside the denominator; with no P or A the
 * percentage is not measurable (null), never 0% or 100%.
 */

// ---- The percentage rule (BR-ATT-03) ----------------------------------------------------------

export interface AttendanceCounts {
  total: number;
  marked: number;
  notMarked: number;
  P: number;
  A: number;
  L: number;
  C: number;
  /** P / (P + A) × 100, rounded to 2 decimals; null when P + A = 0. */
  percentage: number | null;
}

export function attendancePercentage(present: number, absent: number): number | null {
  const denominator = present + absent;
  if (denominator === 0) return null;
  return Math.round((present / denominator) * 10_000) / 100;
}

export function countAttendance(statuses: Iterable<AttendanceStatus>): AttendanceCounts {
  const c = { P: 0, A: 0, L: 0, C: 0, '-': 0 };
  for (const s of statuses) c[s] += 1;
  const total = c.P + c.A + c.L + c.C + c['-'];
  return {
    total,
    marked: total - c['-'],
    notMarked: c['-'],
    P: c.P,
    A: c.A,
    L: c.L,
    C: c.C,
    percentage: attendancePercentage(c.P, c.A),
  };
}

export const AttendanceCountsSchema = z.object({
  total: z.number(),
  marked: z.number(),
  notMarked: z.number(),
  P: z.number(),
  A: z.number(),
  L: z.number(),
  C: z.number(),
  percentage: z.number().nullable(),
});

// ---- Requests -----------------------------------------------------------------------------------

const StatusSchema = z.enum(AttendanceStatus.values, { message: 'Choose P, A, L, C or -' });
const LeaveReasonSchema = z
  .enum(LeaveReason.values, { message: 'Choose a leave reason' })
  .nullable()
  .optional()
  .transform((v) => v ?? null);

/** Reason rules shared by single and multi-period marking (BR-ATT-07). */
function checkReason(
  v: { status: AttendanceStatus; leaveReason: LeaveReason | null; note: string | null },
  ctx: z.RefinementCtx,
) {
  if (v.status === 'L' && !v.leaveReason) {
    ctx.addIssue({ code: 'custom', path: ['leaveReason'], message: 'Choose a leave reason' });
  }
  if (v.status === 'L' && v.leaveReason === 'OTHER' && !v.note) {
    ctx.addIssue({ code: 'custom', path: ['note'], message: 'Describe the reason for "Other"' });
  }
  if (v.status !== 'L' && v.leaveReason) {
    ctx.addIssue({
      code: 'custom',
      path: ['leaveReason'],
      message: 'A leave reason applies only to Leave',
    });
  }
}

/** An administrator changing locked attendance must say why (BR-ATT-12). */
export const AttendanceOverrideSchema = z
  .object({ reason: requiredText(300, 'Override reason') })
  .nullable()
  .optional()
  .transform((v) => v ?? null);

export const AttendanceRegisterQuerySchema = z.object({
  date: IsoDateSchema,
  periodId: IdSchema,
  sectionId: IdSchema,
});
export type AttendanceRegisterQuery = z.infer<typeof AttendanceRegisterQuerySchema>;

export const AttendanceMarkSchema = z
  .object({
    studentId: IdSchema,
    status: StatusSchema,
    leaveReason: LeaveReasonSchema,
    note: optionalText(300, 'Note'),
  })
  .superRefine(checkReason);
export type AttendanceMarkInput = z.input<typeof AttendanceMarkSchema>;

export const ATTENDANCE_BATCH_MAX = 200;

export const AttendanceSaveSchema = AttendanceRegisterQuerySchema.extend({
  /** The register revision the user started from (null for a register never saved). */
  revision: z.number().int().min(0).nullable(),
  marks: z
    .array(AttendanceMarkSchema)
    .min(1, { message: 'There are no changes to save' })
    .max(ATTENDANCE_BATCH_MAX)
    .refine((marks) => new Set(marks.map((m) => m.studentId)).size === marks.length, {
      message: 'Each student can appear only once',
    }),
  override: AttendanceOverrideSchema,
});
export type AttendanceSaveInput = z.input<typeof AttendanceSaveSchema>;

/** Class teacher / admin: one status (Leave or Excused) for several periods of a student's day. */
export const AttendanceStudentDaySaveSchema = z
  .object({
    studentId: IdSchema,
    date: IsoDateSchema,
    periodIds: z
      .array(IdSchema)
      .min(1, { message: 'Choose at least one period' })
      .max(20)
      .refine((ids) => new Set(ids).size === ids.length, { message: 'Each period only once' }),
    status: z.enum(['L', 'C'], { message: 'Choose Leave or Excused' }),
    leaveReason: LeaveReasonSchema,
    note: optionalText(300, 'Note'),
    override: AttendanceOverrideSchema,
  })
  .superRefine(checkReason);
export type AttendanceStudentDaySaveInput = z.input<typeof AttendanceStudentDaySaveSchema>;

export const AttendanceDateQuerySchema = z.object({
  date: IsoDateSchema,
  teacherId: IdSchema.optional(),
});
export const AttendanceClassDayQuerySchema = z.object({ date: IsoDateSchema, sectionId: IdSchema });
export const AttendanceStudentDayQuerySchema = z.object({
  date: IsoDateSchema,
  studentId: IdSchema,
});

const MAX_RANGE_DAYS = 92;
const daysBetween = (from: string, to: string) =>
  (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;

export const AttendanceRangeQuerySchema = z
  .object({ from: IsoDateSchema, to: IsoDateSchema })
  .refine((v) => v.from <= v.to, {
    path: ['to'],
    message: 'The end date must not be before the start',
  })
  .refine((v) => daysBetween(v.from, v.to) < MAX_RANGE_DAYS, {
    path: ['to'],
    message: `Choose at most ${MAX_RANGE_DAYS} days`,
  });
export const AttendanceClassRangeQuerySchema = z
  .object({ sectionId: IdSchema, from: IsoDateSchema, to: IsoDateSchema })
  .refine((v) => v.from <= v.to, {
    path: ['to'],
    message: 'The end date must not be before the start',
  })
  .refine((v) => daysBetween(v.from, v.to) < MAX_RANGE_DAYS, {
    path: ['to'],
    message: `Choose at most ${MAX_RANGE_DAYS} days`,
  });

/** Administrator search over saved registers (paginated). */
export const AttendanceSessionListQuerySchema = z.object({
  academicYearId: IdSchema,
  from: IsoDateSchema.optional(),
  to: IsoDateSchema.optional(),
  sectionId: IdSchema.optional(),
  periodId: IdSchema.optional(),
  subjectId: IdSchema.optional(),
  teacherId: IdSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(PAGE_SIZE_MAX).default(25),
});
export type AttendanceSessionListQuery = z.input<typeof AttendanceSessionListQuerySchema>;

// ---- Views --------------------------------------------------------------------------------------

const PersonRef = z.object({ id: z.string(), fullName: z.string(), staffCode: z.string() });
const SubjectRef = z.object({ id: z.string(), name: z.string(), code: z.string().nullable() });

/** The lesson a register belongs to — resolved by the server, never chosen by the user. */
export const AttendanceContextSchema = z.object({
  date: z.string(),
  day: Weekday.schema,
  academicYear: TimetableYearRefSchema,
  period: TimetablePeriodViewSchema,
  section: TimetableSectionRefSchema,
  subject: SubjectRef,
  teacher: PersonRef,
  /** The timetable entry and version the lesson came from (history: kept on the register). */
  timetableEntryId: z.string(),
  timetableVersionId: z.string(),
});
export type AttendanceContext = z.infer<typeof AttendanceContextSchema>;

export const AttendanceAccessSchema = z.object({
  /** May set P / A / - in this register. */
  canMark: z.boolean(),
  /** May also set L / C (class teacher of the section, administrator). */
  canManage: z.boolean(),
  /** The cutoff has passed for this date. */
  locked: z.boolean(),
  /** First locked date for this date's month (null = never locks). */
  lockDate: z.string().nullable(),
  /** Locked, but the user may override with a reason (administrators). */
  canOverride: z.boolean(),
  /** Anything at all can be changed now (with an override when locked). */
  editable: z.boolean(),
  /** Why the register is read-only, when it is. */
  readOnlyReason: z.string().nullable(),
});
export type AttendanceAccess = z.infer<typeof AttendanceAccessSchema>;

export const AttendanceRowSchema = z.object({
  studentId: z.string(),
  enrolmentId: z.string().nullable(),
  rollNumber: z.string().nullable(),
  admissionNumber: z.string(),
  fullName: z.string(),
  status: AttendanceStatus.schema,
  leaveReason: LeaveReason.schema.nullable(),
  note: z.string().nullable(),
  /** Placed in the section on that date (false: kept because a record exists). */
  onRoll: z.boolean(),
  /** This user may change this row (e.g. a subject teacher cannot change L/C). */
  editable: z.boolean(),
  updatedAt: z.string().nullable(),
  updatedBy: z.string().nullable(),
});
export type AttendanceRow = z.infer<typeof AttendanceRowSchema>;

export const AttendanceRegisterViewSchema = z.object({
  context: AttendanceContextSchema,
  /** Null until the register is first saved. */
  session: z
    .object({
      id: z.string(),
      revision: z.number(),
      updatedAt: z.string(),
      updatedBy: z.string().nullable(),
    })
    .nullable(),
  rows: z.array(AttendanceRowSchema),
  counts: AttendanceCountsSchema,
  access: AttendanceAccessSchema,
});
export type AttendanceRegisterView = z.infer<typeof AttendanceRegisterViewSchema>;

/** Register state for one lesson in lists (taken? complete? locked?). */
export const AttendanceLessonStateSchema = z.object({
  taken: z.boolean(),
  counts: AttendanceCountsSchema.nullable(),
  locked: z.boolean(),
});

/** A teacher's lessons on a date from the timetable in force that day, with register state. */
export const AttendanceLessonsViewSchema = z.object({
  date: z.string(),
  day: Weekday.schema,
  academicYear: TimetableYearRefSchema.nullable(),
  /** False: outside every academic year or not a working day. */
  schoolDay: z.boolean(),
  /** The date is after today (attendance cannot be taken yet). */
  future: z.boolean(),
  teacher: PersonRef,
  lessons: z.array(
    z.object({
      period: TimetablePeriodViewSchema,
      section: TimetableSectionRefSchema,
      subject: SubjectRef,
      attendance: AttendanceLessonStateSchema,
    }),
  ),
});
export type AttendanceLessonsView = z.infer<typeof AttendanceLessonsViewSchema>;

/** A class/section's day: every lesson period × every student (class teacher, administrator). */
export const AttendanceClassDayViewSchema = z.object({
  date: z.string(),
  day: Weekday.schema,
  academicYear: TimetableYearRefSchema.nullable(),
  section: TimetableSectionRefSchema,
  schoolDay: z.boolean(),
  future: z.boolean(),
  locked: z.boolean(),
  periods: z.array(
    z.object({
      period: TimetablePeriodViewSchema,
      subject: SubjectRef,
      teacher: PersonRef,
      attendance: AttendanceLessonStateSchema,
    }),
  ),
  students: z.array(
    z.object({
      studentId: z.string(),
      rollNumber: z.string().nullable(),
      admissionNumber: z.string(),
      fullName: z.string(),
      /** periodId → status ('-' when not marked). */
      statuses: z.record(z.string(), AttendanceStatus.schema),
      counts: AttendanceCountsSchema,
    }),
  ),
  counts: AttendanceCountsSchema,
  canManage: z.boolean(),
});
export type AttendanceClassDayView = z.infer<typeof AttendanceClassDayViewSchema>;

/** One student's periods on one date (class teacher's multi-period Leave / Excused). */
export const AttendanceStudentDayViewSchema = z.object({
  date: z.string(),
  day: Weekday.schema,
  academicYear: TimetableYearRefSchema,
  student: z.object({
    id: z.string(),
    fullName: z.string(),
    admissionNumber: z.string(),
    rollNumber: z.string().nullable(),
  }),
  section: TimetableSectionRefSchema,
  periods: z.array(
    z.object({
      period: TimetablePeriodViewSchema,
      subject: SubjectRef,
      teacher: PersonRef,
      status: AttendanceStatus.schema,
      leaveReason: LeaveReason.schema.nullable(),
      note: z.string().nullable(),
    }),
  ),
  counts: AttendanceCountsSchema,
  access: AttendanceAccessSchema,
});
export type AttendanceStudentDayView = z.infer<typeof AttendanceStudentDayViewSchema>;

/** Per-student totals for a class over a date range (reporting foundation). */
export const AttendanceClassSummaryViewSchema = z.object({
  section: TimetableSectionRefSchema,
  from: z.string(),
  to: z.string(),
  students: z.array(
    z.object({
      studentId: z.string(),
      rollNumber: z.string().nullable(),
      admissionNumber: z.string(),
      fullName: z.string(),
      counts: AttendanceCountsSchema,
    }),
  ),
  counts: AttendanceCountsSchema,
});
export type AttendanceClassSummaryView = z.infer<typeof AttendanceClassSummaryViewSchema>;

/** A student's own attendance: dates × periods, plus totals (student portal view). */
export const StudentAttendanceViewSchema = z.object({
  student: z.object({ id: z.string(), fullName: z.string(), admissionNumber: z.string() }),
  from: z.string(),
  to: z.string(),
  /** Column headings: every lesson period that appears in the range, in day order. */
  periods: z.array(
    z.object({ id: z.string(), label: z.string(), periodNumber: z.number().nullable() }),
  ),
  days: z.array(
    z.object({
      date: z.string(),
      day: Weekday.schema,
      cells: z.record(
        z.string(),
        z.object({
          status: AttendanceStatus.schema,
          subjectName: z.string(),
          /** Phase 9: the teacher of that lesson (snapshot of the register, else the timetable). */
          teacherName: z.string(),
        }),
      ),
    }),
  ),
  counts: AttendanceCountsSchema,
});
export type StudentAttendanceView = z.infer<typeof StudentAttendanceViewSchema>;

export const AttendanceSessionListSchema = z.object({
  items: z.array(
    z.object({
      sessionId: z.string(),
      date: z.string(),
      period: TimetablePeriodViewSchema,
      section: TimetableSectionRefSchema,
      subject: SubjectRef,
      teacher: PersonRef,
      counts: AttendanceCountsSchema,
      updatedAt: z.string(),
      updatedBy: z.string().nullable(),
    }),
  ),
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
});
export type AttendanceSessionList = z.infer<typeof AttendanceSessionListSchema>;
