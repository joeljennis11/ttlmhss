import { z } from 'zod';
import {
  AttendanceClassSummaryViewSchema,
  AttendanceCountsSchema,
  StudentAttendanceViewSchema,
} from './attendance.js';
import { AttendanceStatus } from './controlled-values.js';
import {
  ExamRefSchema,
  MarkSheetViewSchema,
  StudentExamResultViewSchema,
  halfUpDiv,
} from './marks.js';
import { AchievementViewSchema, StudentBehaviourSchema } from './portal.js';
import { TimetableSectionRefSchema, TimetableYearRefSchema } from './timetable.js';
import { IdSchema, IsoDateSchema, optionalText } from './validation.js';

/*
 * Phase 11 — reports, PDFs and annual reports.
 *
 * Every report is a JSON "document" composed from the existing source-of-truth services (Phase 8B
 * results and mark sheets, Phase 7/8A attendance views, Phase 9 behaviour and achievements). The
 * on-screen preview and the A4 PDF are rendered from the SAME document, so they cannot disagree.
 * Nothing here recalculates marks, grades, ranks or attendance percentages.
 */

// ---------------------------------------------------------------------------
// Annual weighting — the ONE definition (BR-AR-02, D-102)
// ---------------------------------------------------------------------------

/**
 * Annual percentage in hundredths of a percent:
 *   Σ (exam percentage × exam weightage) ÷ 100 %, half-up to 2 decimals.
 * Exam percentages are the Phase 8B results (Σ final marks ÷ Σ final maximums); weightages are the
 * Phase 4 configuration in basis points (2000 = 20 %) and must total exactly 10000. Returns null
 * when the weightages do not total 100 % or there is nothing to weigh.
 */
export function annualPercentBp(
  contributions: readonly { percentBp: number; weightBp: number }[],
): number | null {
  const total = contributions.reduce((sum, c) => sum + c.weightBp, 0);
  if (contributions.length === 0 || total !== 10_000) return null;
  return halfUpDiv(
    contributions.reduce((sum, c) => sum + c.percentBp * c.weightBp, 0),
    10_000,
  );
}

// ---------------------------------------------------------------------------
// Common parts
// ---------------------------------------------------------------------------

/** School identity printed on reports — only values the school has configured (never invented). */
export const ReportSchoolSchema = z.object({
  fullName: z.string(),
  shortName: z.string(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  website: z.string().nullable(),
  motto: z.string().nullable(),
  /** Printed under the principal's signature line when configured. */
  principalName: z.string().nullable().default(null),
});
export type ReportSchool = z.infer<typeof ReportSchoolSchema>;

const ReportStudentSchema = z.object({
  id: z.string(),
  fullName: z.string(),
  admissionNumber: z.string(),
  rollNumber: z.string().nullable(),
});

const DocumentBase = {
  school: ReportSchoolSchema,
  generatedAt: z.string(),
  /** Deterministic file name for the PDF/XLSX of this document. */
  fileName: z.string(),
};

export const ReportFormat = z.enum(['json', 'pdf', 'xlsx']);
export type ReportFormat = z.infer<typeof ReportFormat>;

// ---------------------------------------------------------------------------
// Report documents
// ---------------------------------------------------------------------------

export const ExamReportCardSchema = z.object({
  ...DocumentBase,
  kind: z.literal('EXAM_REPORT_CARD'),
  result: StudentExamResultViewSchema,
  /** An official card exists only for a complete result (Phase 8B). */
  official: z.boolean(),
});
export type ExamReportCard = z.infer<typeof ExamReportCardSchema>;

export const MarkSheetReportSchema = z.object({
  ...DocumentBase,
  kind: z.literal('MARK_SHEET'),
  sheet: MarkSheetViewSchema,
});
export type MarkSheetReport = z.infer<typeof MarkSheetReportSchema>;

export const StudentAttendanceReportSchema = z.object({
  ...DocumentBase,
  kind: z.literal('STUDENT_ATTENDANCE'),
  academicYear: TimetableYearRefSchema,
  student: ReportStudentSchema,
  section: TimetableSectionRefSchema.nullable(),
  attendance: StudentAttendanceViewSchema,
});
export type StudentAttendanceReport = z.infer<typeof StudentAttendanceReportSchema>;

/** One lesson cell of a class register over a range (date + period + student). */
export const AttendanceDetailRowSchema = z.object({
  date: z.string(),
  periodLabel: z.string(),
  admissionNumber: z.string(),
  rollNumber: z.string().nullable(),
  fullName: z.string(),
  subjectName: z.string(),
  teacherName: z.string(),
  status: AttendanceStatus.schema,
});
export type AttendanceDetailRow = z.infer<typeof AttendanceDetailRowSchema>;

export const ClassAttendanceReportSchema = z.object({
  ...DocumentBase,
  kind: z.literal('CLASS_ATTENDANCE'),
  academicYear: TimetableYearRefSchema,
  summary: AttendanceClassSummaryViewSchema,
  /** Lessons in the range that had at least one student on roll. */
  lessonCount: z.number(),
});
export type ClassAttendanceReport = z.infer<typeof ClassAttendanceReportSchema>;

export const PerformanceReportSchema = z.object({
  ...DocumentBase,
  kind: z.literal('STUDENT_PERFORMANCE'),
  academicYear: TimetableYearRefSchema,
  student: ReportStudentSchema,
  section: TimetableSectionRefSchema.nullable(),
  /** Exams whose results this viewer may see (Phase 8B visibility), oldest first. */
  exams: z.array(StudentExamResultViewSchema),
  attendance: z
    .object({ from: z.string(), to: z.string(), counts: AttendanceCountsSchema })
    .nullable(),
  /** Submitted behaviour assessments only. */
  behaviour: z.array(StudentBehaviourSchema),
  achievements: z.array(AchievementViewSchema),
});
export type PerformanceReport = z.infer<typeof PerformanceReportSchema>;

// ---------------------------------------------------------------------------
// Annual report
// ---------------------------------------------------------------------------

export const AnnualReportStatus = z.enum(['DRAFT', 'FINALIZED', 'PUBLISHED']);
export type AnnualReportStatus = z.infer<typeof AnnualReportStatus>;

export const AnnualExamSchema = z.object({
  exam: ExamRefSchema,
  /** Configured weightage (Phase 4) in percent; 0 = not part of the annual figure. */
  weightagePercent: z.number(),
  /** The Phase 8B result, or null when the exam has no result for this student. */
  result: StudentExamResultViewSchema.nullable(),
});

/** The content of an annual report: computed live while DRAFT, frozen at finalization. */
export const AnnualReportContentSchema = z.object({
  school: ReportSchoolSchema,
  academicYear: TimetableYearRefSchema.extend({ startDate: z.string(), endDate: z.string() }),
  student: ReportStudentSchema,
  section: TimetableSectionRefSchema,
  exams: z.array(AnnualExamSchema),
  annual: z.object({
    /** Σ weightage of the year's active exams (must be 100). */
    weightageTotalPercent: z.number(),
    contributions: z.array(
      z.object({
        examId: z.string(),
        examName: z.string(),
        weightagePercent: z.number(),
        percentage: z.number().nullable(),
        /** percentage × weightage ÷ 100, for display (the annual figure is computed exactly). */
        weighted: z.number().nullable(),
      }),
    ),
    /** null = cannot be calculated (see `problems`). */
    percentage: z.number().nullable(),
  }),
  attendance: z.object({ from: z.string(), to: z.string(), counts: AttendanceCountsSchema }),
  behaviour: z.array(StudentBehaviourSchema),
  achievements: z.array(AchievementViewSchema),
  /** System suggestion built from the facts above — never shown as the teacher's remark. */
  suggestedRemark: z.string(),
  /** The class teacher's / administrator's final remark. */
  finalRemark: z.string().nullable(),
  /** Why the report cannot be finalized yet (empty = ready). */
  problems: z.array(z.string()),
});
export type AnnualReportContent = z.infer<typeof AnnualReportContentSchema>;

export const AnnualReportViewSchema = z.object({
  id: z.string().nullable(),
  /** NONE = not prepared yet. */
  status: z.enum(['NONE', ...AnnualReportStatus.options]),
  revision: z.number().nullable(),
  content: AnnualReportContentSchema,
  /** True: content comes from the frozen snapshot (FINALIZED / PUBLISHED). */
  frozen: z.boolean(),
  finalized: z.object({ at: z.string(), by: z.string().nullable() }).nullable(),
  published: z.object({ at: z.string(), by: z.string().nullable() }).nullable(),
  fileName: z.string(),
  actions: z.object({
    prepare: z.boolean(),
    editRemark: z.boolean(),
    finalize: z.boolean(),
    publish: z.boolean(),
    unpublish: z.boolean(),
    reopen: z.boolean(),
  }),
});
export type AnnualReportView = z.infer<typeof AnnualReportViewSchema>;

export const AnnualReportListSchema = z.object({
  academicYear: TimetableYearRefSchema,
  section: TimetableSectionRefSchema,
  students: z.array(
    z.object({
      student: ReportStudentSchema,
      reportId: z.string().nullable(),
      status: z.enum(['NONE', ...AnnualReportStatus.options]),
      updatedAt: z.string().nullable(),
    }),
  ),
});
export type AnnualReportList = z.infer<typeof AnnualReportListSchema>;

export const MyAnnualReportsSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      academicYear: TimetableYearRefSchema,
      publishedAt: z.string(),
      fileName: z.string(),
    }),
  ),
});
export type MyAnnualReports = z.infer<typeof MyAnnualReportsSchema>;

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

const format = ReportFormat.default('json');

export const ExamReportCardQuerySchema = z.object({
  examId: IdSchema,
  /** Staff: required. Students: omitted (always their own; another id is refused). */
  studentId: IdSchema.optional(),
  format,
});
export const MarkSheetReportQuerySchema = z.object({
  examSubjectId: IdSchema,
  sectionId: IdSchema,
  format,
});
const range = {
  from: IsoDateSchema,
  to: IsoDateSchema,
};
export const StudentAttendanceReportQuerySchema = z
  .object({ studentId: IdSchema.optional(), ...range, format })
  .refine((v) => v.from <= v.to, {
    path: ['to'],
    message: 'The end date is before the start date',
  });
export const ClassAttendanceReportQuerySchema = z
  .object({ sectionId: IdSchema, ...range, format })
  .refine((v) => v.from <= v.to, {
    path: ['to'],
    message: 'The end date is before the start date',
  });
export const PerformanceReportQuerySchema = z.object({
  studentId: IdSchema.optional(),
  academicYearId: IdSchema.optional(),
  format,
});
export const AnnualReportQuerySchema = z.object({
  academicYearId: IdSchema,
  studentId: IdSchema.optional(),
  format,
});
export const AnnualReportListQuerySchema = z.object({
  academicYearId: IdSchema,
  sectionId: IdSchema,
});
export const AnnualReportPrepareSchema = z.object({
  academicYearId: IdSchema,
  studentId: IdSchema,
});
export const AnnualReportRemarkSchema = z.object({
  remark: optionalText(1000, 'Remark'),
  revision: z.number().int().min(1),
});
export type AnnualReportRemark = z.input<typeof AnnualReportRemarkSchema>;
export const AnnualReportRevisionSchema = z.object({ revision: z.number().int().min(1) });
export const AnnualReportReopenSchema = z.object({
  revision: z.number().int().min(1),
  reason: z
    .string()
    .trim()
    .min(5, { message: 'Give a reason of at least 5 characters' })
    .max(500, { message: 'Reason must be at most 500 characters' }),
});

/** Years, sections in scope and exams — the Reports page filters. */
export const ReportOptionsSchema = z.object({
  years: z.array(TimetableYearRefSchema.extend({ startDate: z.string(), endDate: z.string() })),
  academicYearId: z.string().nullable(),
  sections: z.array(TimetableSectionRefSchema),
  exams: z.array(ExamRefSchema),
  /** What the caller may produce (menus only — the server checks every request). */
  can: z.object({
    examReports: z.boolean(),
    markSheets: z.boolean(),
    classAttendance: z.boolean(),
    annualReports: z.boolean(),
    publishAnnual: z.boolean(),
  }),
});
export type ReportOptions = z.infer<typeof ReportOptionsSchema>;
