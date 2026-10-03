import { z } from 'zod';
import { ExamStage, MarkSheetStatus, RecordStatus } from './controlled-values.js';
import { RANK_SCOPES } from './config.js';
import { TimetableSectionRefSchema, TimetableYearRefSchema } from './timetable.js';
import { IdSchema, requiredText } from './validation.js';

/*
 * Phase 8B — Exams, marks and results.
 *
 *   Academic year → Exam → Exam subject (exam × class × subject, Phase 4) → Section
 *     → ONE mark sheet (explicitly authorised teacher, DRAFT / SUBMITTED / UNLOCKED)
 *     → one mark entry per student (raw marks per component; "-" = not entered, 0 = zero).
 *
 * All arithmetic is done in exact integers:
 *   marks in hundredths of a mark ("cm": 42.5 → 4250), percentages in hundredths of a percent
 *   ("bp": 84.25 % → 8425). Rounding is ALWAYS "half up to 2 decimals" (D-68), applied once:
 *   - normalised mark  = total × convertTo ÷ totalMax          (e.g. 42/50 → 84/100)
 *   - subject %        = total ÷ totalMax × 100                (raw marks; normalising never
 *                                                                changes the ratio)
 *   - exam %           = Σ final marks ÷ Σ final maximums × 100 (never an average of percentages)
 * where a subject's "final" mark/maximum is the normalised one when "convert to" is set, else
 * the raw total.
 */

// ---------------------------------------------------------------------------
// Exact arithmetic
// ---------------------------------------------------------------------------

/** Most marks a single component can have (Phase 4 maximum is 1000). */
export const MARK_LIMIT = 1000;

/** round(numerator ÷ denominator) half up, for non-negative integers. */
export function halfUpDiv(numerator: number, denominator: number): number {
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

/** 42.5 → 4250. Callers validate first (≤ 2 decimals). */
export const toHundredths = (marks: number): number => Math.round(marks * 100);
/** 4250 → 42.5 */
export const fromHundredths = (hundredths: number): number => hundredths / 100;

/** At most two decimal places (42, 42.5, 42.25). */
export function hasAtMostTwoDecimals(value: number): boolean {
  return Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;
}

// ---------------------------------------------------------------------------
// Components and subject scores
// ---------------------------------------------------------------------------

export const MARK_COMPONENTS = ['theory', 'internal', 'practical'] as const;
export type MarkComponent = (typeof MARK_COMPONENTS)[number];
export const MARK_COMPONENT_LABELS: Readonly<Record<MarkComponent, string>> = Object.freeze({
  theory: 'Theory',
  internal: 'Internal',
  practical: 'Practical',
});

/** How one exam subject is marked (Phase 4 configuration + the grade bands that apply). */
export interface MarkStructure {
  theoryMax: number;
  internalMax: number | null;
  practicalMax: number | null;
  passMarks: number;
  normalizedMax: number | null;
  includeInResult: boolean;
  gradeScale: { id: string; name: string; bands: { label: string; minPercent: number }[] } | null;
}

export interface ComponentInfo {
  key: MarkComponent;
  label: string;
  max: number;
}

/** The components a student is marked on: those with a maximum above 0 (D-67). */
export function componentsOf(structure: Pick<MarkStructure, `${MarkComponent}Max`>) {
  return MARK_COMPONENTS.map((key) => ({
    key,
    label: MARK_COMPONENT_LABELS[key],
    max: structure[`${key}Max`] ?? 0,
  })).filter((c) => c.max > 0) as ComponentInfo[];
}

export function totalMaxOf(structure: Pick<MarkStructure, `${MarkComponent}Max`>): number {
  return structure.theoryMax + (structure.internalMax ?? 0) + (structure.practicalMax ?? 0);
}

/** Raw marks in hundredths; null = "-" (not entered). */
export type RawMarks = Record<MarkComponent, number | null>;

export interface SubjectScore {
  /** Raw total in hundredths and the raw maximum (whole marks). */
  totalCm: number;
  totalMax: number;
  /** Normalised mark (hundredths) when "convert to" is configured. */
  normalizedCm: number | null;
  /** The mark/maximum used in exam totals: normalised when configured, else raw. */
  finalCm: number;
  finalMax: number;
  /** Subject percentage in hundredths of a percent (raw total ÷ raw maximum). */
  percentBp: number;
  grade: string | null;
  passed: boolean;
}

/** Has the student a mark for every component of the subject? */
export function isComplete(structure: MarkStructure, raw: RawMarks): boolean {
  return componentsOf(structure).every((c) => raw[c.key] !== null);
}

/** The grade whose band contains the percentage (bands: lowest percentage of each grade). */
export function gradeForBp(
  bands: readonly { label: string; minPercent: number }[],
  percentBp: number,
): string | null {
  const match = [...bands]
    .sort((a, b) => b.minPercent - a.minPercent)
    .find((b) => percentBp >= Math.round(b.minPercent * 100));
  return match?.label ?? null;
}

/**
 * A complete subject result, or null while any component is "-" (a missing mark is never 0).
 * Pass = raw total ≥ the configured pass marks (Phase 4 has one pass mark against the total; no
 * per-component pass rule exists, D-70).
 */
export function scoreSubject(structure: MarkStructure, raw: RawMarks): SubjectScore | null {
  if (!isComplete(structure, raw)) return null;
  const totalCm = componentsOf(structure).reduce((sum, c) => sum + (raw[c.key] ?? 0), 0);
  const totalMax = totalMaxOf(structure);
  const normalizedCm =
    structure.normalizedMax === null
      ? null
      : halfUpDiv(totalCm * structure.normalizedMax, totalMax);
  const percentBp = halfUpDiv(totalCm * 100, totalMax);
  return {
    totalCm,
    totalMax,
    normalizedCm,
    finalCm: normalizedCm ?? totalCm,
    finalMax: structure.normalizedMax ?? totalMax,
    percentBp,
    grade: structure.gradeScale ? gradeForBp(structure.gradeScale.bands, percentBp) : null,
    passed: totalCm >= structure.passMarks * 100,
  };
}

// ---------------------------------------------------------------------------
// Exam totals and rank
// ---------------------------------------------------------------------------

export interface ExamSummary {
  totalCm: number;
  maxMarks: number;
  percentBp: number;
  passed: boolean;
}

/**
 * The complete exam result from the subjects that count in the result (each with its final mark
 * and maximum). Total obtained ÷ total maximum × 100; overall pass only when every counted subject
 * is passed.
 */
export function summarizeExam(
  subjects: readonly { finalCm: number; finalMax: number; passed: boolean }[],
): ExamSummary | null {
  if (subjects.length === 0) return null;
  const totalCm = subjects.reduce((sum, s) => sum + s.finalCm, 0);
  const maxMarks = subjects.reduce((sum, s) => sum + s.finalMax, 0);
  return {
    totalCm,
    maxMarks,
    percentBp: maxMarks === 0 ? 0 : halfUpDiv(totalCm * 100, maxMarks),
    passed: subjects.every((s) => s.passed),
  };
}

/**
 * Standard competition ranking (1, 2, 2, 4) by total obtained, highest first (D-73). Everyone in
 * one population has the same subjects and maximums, so total order = percentage order. Equal
 * totals share a rank; there is no other tie-break.
 */
export function competitionRanks<K>(items: readonly { key: K; totalCm: number }[]): Map<K, number> {
  const sorted = [...items].sort((a, b) => b.totalCm - a.totalCm);
  const ranks = new Map<K, number>();
  sorted.forEach((item, i) => {
    const previous = sorted[i - 1];
    ranks.set(
      item.key,
      previous && previous.totalCm === item.totalCm ? ranks.get(previous.key)! : i + 1,
    );
  });
  return ranks;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export const EXAM_STAGE_LABELS: Readonly<Record<ExamStage, string>> = Object.freeze({
  DRAFT: 'Draft',
  OPEN: 'Open for marks',
  CLOSED: 'Closed',
});

export const MARK_SHEET_STATUS_LABELS: Readonly<Record<MarkSheetStatus, string>> = Object.freeze({
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted (locked)',
  UNLOCKED: 'Unlocked for correction',
});

export const ExamStageChangeSchema = z.object({ stage: ExamStage.schema });
export type ExamStageChange = z.input<typeof ExamStageChangeSchema>;

/** Which sheet: one exam subject (exam × class × subject) in one section. */
export const MarkSheetKeySchema = z.object({ examSubjectId: IdSchema, sectionId: IdSchema });
export type MarkSheetKey = z.infer<typeof MarkSheetKeySchema>;

export const SheetTeacherInputSchema = z.object({ teacherId: IdSchema.nullable() });
export type SheetTeacherInput = z.input<typeof SheetTeacherInputSchema>;

/** One mark as typed: null = "-" (not entered); 0 is a real zero. */
export const MarkValueSchema = z
  .number({ message: 'Enter a number' })
  .min(0, { message: 'Marks cannot be negative' })
  .max(MARK_LIMIT, { message: `Marks cannot exceed ${MARK_LIMIT}` })
  .refine(hasAtMostTwoDecimals, { message: 'Use at most two decimal places' })
  .nullable();

export const MarkRowInputSchema = z.object({
  studentId: IdSchema,
  theory: MarkValueSchema,
  internal: MarkValueSchema,
  practical: MarkValueSchema,
});
export type MarkRowInput = z.input<typeof MarkRowInputSchema>;

/** Optimistic locking: `revision` is the sheet revision the editor loaded (null: no sheet yet). */
const revision = z.number().int().min(1).nullable();

export const MarkSheetSaveSchema = MarkSheetKeySchema.extend({
  revision,
  marks: z
    .array(MarkRowInputSchema)
    .max(200)
    .refine((rows) => new Set(rows.map((r) => r.studentId)).size === rows.length, {
      message: 'Each student can appear only once',
    }),
});
export type MarkSheetSave = z.input<typeof MarkSheetSaveSchema>;

export const MarkSheetSubmitSchema = MarkSheetKeySchema.extend({
  revision: z.number().int().min(1),
});
export type MarkSheetSubmit = z.input<typeof MarkSheetSubmitSchema>;

export const MarkSheetUnlockSchema = MarkSheetKeySchema.extend({
  revision: z.number().int().min(1),
  reason: requiredText(300, 'Reason').refine((v) => v.length >= 5, {
    message: 'Give a reason of at least 5 characters',
  }),
});
export type MarkSheetUnlock = z.input<typeof MarkSheetUnlockSchema>;

export const ResultExamQuerySchema = z.object({ academicYearId: IdSchema.optional() });

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

const PersonRef = z.object({ id: z.string(), fullName: z.string(), staffCode: z.string() });
export const ExamRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  stage: ExamStage.schema,
  status: RecordStatus.schema,
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
});
export type ExamRef = z.infer<typeof ExamRefSchema>;
const SubjectRef = z.object({ id: z.string(), name: z.string(), code: z.string().nullable() });

export const ComponentInfoSchema = z.object({
  key: z.enum(MARK_COMPONENTS),
  label: z.string(),
  max: z.number(),
});

const GradeScaleView = z.object({
  name: z.string(),
  bands: z.array(z.object({ label: z.string(), minPercent: z.number(), maxPercent: z.number() })),
});

export const MarkStructureViewSchema = z.object({
  components: z.array(ComponentInfoSchema),
  totalMax: z.number(),
  passMarks: z.number(),
  normalizedMax: z.number().nullable(),
  includeInResult: z.boolean(),
  gradeScale: GradeScaleView.nullable(),
});
export type MarkStructureView = z.infer<typeof MarkStructureViewSchema>;

const ResultValue = z.enum(['PASS', 'FAIL']);
export type ResultValue = z.infer<typeof ResultValue>;

const ComponentMarks = z.object({
  theory: z.number().nullable(),
  internal: z.number().nullable(),
  practical: z.number().nullable(),
});

export const MarkSheetRowViewSchema = z.object({
  studentId: z.string(),
  enrolmentId: z.string(),
  rollNumber: z.string().nullable(),
  admissionNumber: z.string(),
  fullName: z.string(),
  /** False: has marks here but is no longer placed in this section (history; read-only). */
  onRoll: z.boolean(),
  marks: ComponentMarks,
  complete: z.boolean(),
  total: z.number().nullable(),
  normalized: z.number().nullable(),
  percent: z.number().nullable(),
  grade: z.string().nullable(),
  result: ResultValue.nullable(),
  updatedAt: z.string().nullable(),
  updatedBy: z.string().nullable(),
});
export type MarkSheetRowView = z.infer<typeof MarkSheetRowViewSchema>;

export const MarkSheetViewSchema = z.object({
  examSubjectId: z.string(),
  sectionId: z.string(),
  academicYear: TimetableYearRefSchema,
  exam: ExamRefSchema,
  section: TimetableSectionRefSchema,
  subject: SubjectRef,
  structure: MarkStructureViewSchema,
  teacher: PersonRef.nullable(),
  status: MarkSheetStatus.schema,
  /** null until the sheet is first saved (or a teacher is assigned). */
  revision: z.number().nullable(),
  submitted: z.object({ at: z.string(), by: z.string().nullable() }).nullable(),
  unlocked: z.object({ at: z.string(), by: z.string().nullable(), reason: z.string() }).nullable(),
  updatedAt: z.string().nullable(),
  rows: z.array(MarkSheetRowViewSchema),
  counts: z.object({ entered: z.number(), total: z.number() }),
  access: z.object({
    canEdit: z.boolean(),
    canSubmit: z.boolean(),
    canUnlock: z.boolean(),
    readOnlyReason: z.string().nullable(),
  }),
});
export type MarkSheetView = z.infer<typeof MarkSheetViewSchema>;

export const MarkSheetSummarySchema = z.object({
  examSubjectId: z.string(),
  sectionId: z.string(),
  classId: z.string(),
  className: z.string(),
  sectionName: z.string(),
  subjectId: z.string(),
  subjectName: z.string(),
  status: MarkSheetStatus.schema.nullable(),
  /** Students with every component entered. */
  entered: z.number(),
  /** Why this user sees the sheet. */
  role: z.enum(['ENTRY_TEACHER', 'CLASS_TEACHER', 'ADMIN']),
});
export type MarkSheetSummary = z.infer<typeof MarkSheetSummarySchema>;

export const MarksHomeViewSchema = z.object({
  years: z.array(TimetableYearRefSchema),
  academicYearId: z.string().nullable(),
  exams: z.array(ExamRefSchema.extend({ sheets: z.array(MarkSheetSummarySchema) })),
});
export type MarksHomeView = z.infer<typeof MarksHomeViewSchema>;

export const MarkHistoryEntrySchema = z.object({
  at: z.string(),
  actor: z.string().nullable(),
  action: z.string(),
  summary: z.string(),
  reason: z.string().nullable(),
});
export type MarkHistoryEntry = z.infer<typeof MarkHistoryEntrySchema>;

export const ExamMatrixRowSchema = z.object({
  examSubjectId: z.string(),
  classId: z.string(),
  className: z.string(),
  sectionId: z.string(),
  sectionName: z.string(),
  subjectId: z.string(),
  subjectName: z.string(),
  structure: MarkStructureViewSchema,
  teacher: PersonRef.nullable(),
  /** The assigned teacher no longer teaches the subject or is inactive. */
  teacherProblem: z.string().nullable(),
  status: MarkSheetStatus.schema.nullable(),
  entered: z.number(),
});
export type ExamMatrixRow = z.infer<typeof ExamMatrixRowSchema>;

export const ExamMarksMatrixViewSchema = z.object({
  exam: ExamRefSchema.extend({ description: z.string().nullable() }),
  academicYear: TimetableYearRefSchema,
  rows: z.array(ExamMatrixRowSchema),
  /** Teachers who may be assigned, per subject (Teacher → Subject, active teachers only). */
  teachersBySubject: z.record(z.string(), z.array(PersonRef)),
  /** Warnings only: exam dates on days the academic calendar marks as closed for everyone. */
  calendarNotes: z.array(z.string()),
  counts: z.object({ sheets: z.number(), submitted: z.number(), withoutTeacher: z.number() }),
});
export type ExamMarksMatrixView = z.infer<typeof ExamMarksMatrixViewSchema>;

// ---- Results ---------------------------------------------------------------------------------

export const SubjectResultViewSchema = z.object({
  subjectId: z.string(),
  subjectName: z.string(),
  countsInResult: z.boolean(),
  /** Submitted (finalised) subject: the marks below are shown. Otherwise "not yet available". */
  available: z.boolean(),
  components: z.array(ComponentInfoSchema.extend({ obtained: z.number() })).nullable(),
  totalMax: z.number(),
  obtained: z.number().nullable(),
  normalizedMax: z.number().nullable(),
  normalized: z.number().nullable(),
  /** Maximum and mark used in the exam total (normalised when configured). */
  finalMax: z.number(),
  final: z.number().nullable(),
  percent: z.number().nullable(),
  grade: z.string().nullable(),
  result: ResultValue.nullable(),
});
export type SubjectResultView = z.infer<typeof SubjectResultViewSchema>;

export const ExamSummaryViewSchema = z.object({
  total: z.number(),
  max: z.number(),
  percentage: z.number(),
  result: ResultValue,
  rank: z.number().nullable(),
  rankedOf: z.number().nullable(),
  rankScope: z.enum(RANK_SCOPES),
});
export type ExamSummaryView = z.infer<typeof ExamSummaryViewSchema>;

export const StudentExamResultViewSchema = z.object({
  academicYear: TimetableYearRefSchema,
  exam: ExamRefSchema,
  student: z.object({
    id: z.string(),
    fullName: z.string(),
    admissionNumber: z.string(),
    rollNumber: z.string().nullable(),
  }),
  section: TimetableSectionRefSchema,
  subjects: z.array(SubjectResultViewSchema),
  /** Every subject that counts in the result is finalised for this student. */
  complete: z.boolean(),
  availableCount: z.number(),
  requiredCount: z.number(),
  summary: ExamSummaryViewSchema.nullable(),
});
export type StudentExamResultView = z.infer<typeof StudentExamResultViewSchema>;

export const ResultExamsViewSchema = z.object({
  years: z.array(TimetableYearRefSchema),
  academicYearId: z.string().nullable(),
  exams: z.array(ExamRefSchema),
  /** Sections the user may see class results for (staff only; empty for students). */
  sections: z.array(TimetableSectionRefSchema),
});
export type ResultExamsView = z.infer<typeof ResultExamsViewSchema>;

export const ClassResultViewSchema = z.object({
  academicYear: TimetableYearRefSchema,
  exam: ExamRefSchema,
  section: TimetableSectionRefSchema,
  rankScope: z.enum(RANK_SCOPES),
  subjects: z.array(
    z.object({
      subjectId: z.string(),
      subjectName: z.string(),
      countsInResult: z.boolean(),
      finalMax: z.number(),
      status: MarkSheetStatus.schema.nullable(),
    }),
  ),
  students: z.array(
    z.object({
      studentId: z.string(),
      rollNumber: z.string().nullable(),
      admissionNumber: z.string(),
      fullName: z.string(),
      cells: z.array(
        z.object({
          subjectId: z.string(),
          final: z.number().nullable(),
          grade: z.string().nullable(),
          result: ResultValue.nullable(),
        }),
      ),
      complete: z.boolean(),
      summary: ExamSummaryViewSchema.nullable(),
    }),
  ),
  /** Students with a complete result (the rank denominator). */
  rankedOf: z.number(),
});
export type ClassResultView = z.infer<typeof ClassResultViewSchema>;
