import { z } from 'zod';
import { PermissionSchema } from './auth.js';
import {
  AcademicYearStatus,
  ExamStage,
  PeriodKind,
  RecordStatus,
  Weekday,
} from './controlled-values.js';
import { CONFIGURABLE_ROLES } from './permission-info.js';
import { IsoDateSchema, TimeOfDaySchema, optionalText, requiredText } from './validation.js';

/*
 * School configuration contract (Phase 4): the shapes the Admin configuration API accepts and
 * returns. The API validates every request with these schemas and then applies cross-record rules
 * (uniqueness, overlaps, totals) in its services. The web app reuses them for form feedback only.
 */

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

const displayOrder = z
  .number({ message: 'Display order must be a number' })
  .int({ message: 'Display order must be a whole number' })
  .min(0, { message: 'Display order cannot be negative' })
  .max(999, { message: 'Display order must be at most 999' });

/** A percentage 0–100 with at most two decimal places (stored exactly as hundredths). */
export function percentSchema(label: string) {
  return z
    .number({ message: `${label} must be a number` })
    .min(0, { message: `${label} cannot be below 0` })
    .max(100, { message: `${label} cannot be above 100` })
    .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, {
      message: `${label} can have at most two decimal places`,
    });
}

function marks(label: string, { min = 0 } = {}) {
  return z
    .number({ message: `${label} must be a number` })
    .int({ message: `${label} must be a whole number` })
    .min(min, { message: `${label} must be at least ${min}` })
    .max(1000, { message: `${label} must be at most 1000` });
}

/** Optional text that must also match a pattern when present. */
function optionalPattern(max: number, label: string, pattern: RegExp, message: string) {
  return optionalText(max, label).refine((v) => v === null || pattern.test(v), { message });
}

export const StatusUpdateSchema = z.object({ status: RecordStatus.schema });

// ---------------------------------------------------------------------------
// School settings
// ---------------------------------------------------------------------------

/** Logo must be a file served by the app under /brand/ (no external URLs). */
export const LOGO_PATH_PATTERN = /^\/brand\/[A-Za-z0-9._-]+\.(webp|png|jpe?g|svg)$/;

export const SchoolSettingsUpdateSchema = z.object({
  fullName: requiredText(150, 'School name'),
  shortName: requiredText(20, 'Short name'),
  motto: optionalText(150, 'Motto'),
  address: optionalText(500, 'Address'),
  phone: optionalPattern(
    60,
    'Phone',
    /^[0-9+()\-\s,/]{6,60}$/,
    'Use digits, spaces and + ( ) - , / only',
  ),
  email: optionalText(120, 'Email').refine((v) => v === null || z.email().safeParse(v).success, {
    message: 'Enter a valid email address',
  }),
  website: optionalText(200, 'Website').refine(
    (v) => v === null || /^https?:\/\/[^\s/$.?#][^\s]*$/i.test(v),
    { message: 'Enter a full web address starting with http:// or https://' },
  ),
  principalName: optionalText(100, 'Principal name'),
  logoUrl: optionalPattern(
    200,
    'Logo',
    LOGO_PATH_PATTERN,
    'Use a logo file from /brand/ (for example /brand/ttlmhss-logo.webp)',
  ),
});
export type SchoolSettingsUpdate = z.input<typeof SchoolSettingsUpdateSchema>;

export const SchoolSettingsViewSchema = z.object({
  fullName: z.string(),
  shortName: z.string(),
  motto: z.string().nullable(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  website: z.string().nullable(),
  principalName: z.string().nullable(),
  logoUrl: z.string().nullable(),
  primaryColor: z.string(),
  updatedAt: z.string(),
  currentAcademicYear: z.object({ id: z.string(), label: z.string() }).nullable(),
});
export type SchoolSettingsView = z.infer<typeof SchoolSettingsViewSchema>;

// ---------------------------------------------------------------------------
// Academic years
// ---------------------------------------------------------------------------

const yearFields = {
  label: requiredText(20, 'Name').regex(/^[0-9A-Za-z][0-9A-Za-z \-–/]*$/, {
    message: 'Use letters, digits, spaces, - – or / (for example 2026-27)',
  }),
  startDate: IsoDateSchema,
  endDate: IsoDateSchema,
};

export const AcademicYearCreateSchema = z
  .object(yearFields)
  .refine((v) => v.startDate < v.endDate, {
    path: ['endDate'],
    message: 'End date must be after the start date',
  });
export type AcademicYearCreate = z.input<typeof AcademicYearCreateSchema>;

export const AcademicYearUpdateSchema = z
  .object(yearFields)
  .partial()
  .refine((v) => !v.startDate || !v.endDate || v.startDate < v.endDate, {
    path: ['endDate'],
    message: 'End date must be after the start date',
  });
export type AcademicYearUpdate = z.input<typeof AcademicYearUpdateSchema>;

export const AcademicYearViewSchema = z.object({
  id: z.string(),
  label: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  status: AcademicYearStatus.schema,
  workingDays: z.array(Weekday.schema).nullable(),
  /** True when other records belong to this year (it can then never be deleted). */
  inUse: z.boolean(),
  updatedAt: z.string(),
});
export type AcademicYearView = z.infer<typeof AcademicYearViewSchema>;

export const WorkingDaysUpdateSchema = z.object({
  workingDays: z
    .array(Weekday.schema)
    .min(1, { message: 'Choose at least one working day' })
    .refine((days) => new Set(days).size === days.length, { message: 'Days must not repeat' }),
});

// ---------------------------------------------------------------------------
// Classes & sections
// ---------------------------------------------------------------------------

export const ClassCreateSchema = z.object({
  name: requiredText(30, 'Class name'),
  displayOrder,
});
export const ClassUpdateSchema = ClassCreateSchema.partial().extend({
  status: RecordStatus.schema.optional(),
});
export type ClassCreate = z.input<typeof ClassCreateSchema>;
export type ClassUpdate = z.input<typeof ClassUpdateSchema>;

export const SectionCreateSchema = z.object({ name: requiredText(10, 'Section name') });
export const SectionUpdateSchema = SectionCreateSchema.partial().extend({
  status: RecordStatus.schema.optional(),
});

export const SectionViewSchema = z.object({
  id: z.string(),
  classId: z.string(),
  name: z.string(),
  status: RecordStatus.schema,
});
export const ClassViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  displayOrder: z.number(),
  status: RecordStatus.schema,
  sections: z.array(SectionViewSchema),
});
export type SectionView = z.infer<typeof SectionViewSchema>;
export type ClassView = z.infer<typeof ClassViewSchema>;

// ---------------------------------------------------------------------------
// Subjects
// ---------------------------------------------------------------------------

export const SubjectCreateSchema = z.object({
  name: requiredText(80, 'Subject name'),
  code: optionalPattern(12, 'Code', /^[A-Za-z0-9-]+$/, 'Use letters, digits or - only').transform(
    (v) => (v === null ? null : v.toUpperCase()),
  ),
  displayOrder,
});
export const SubjectUpdateSchema = SubjectCreateSchema.partial().extend({
  status: RecordStatus.schema.optional(),
});
export type SubjectCreate = z.input<typeof SubjectCreateSchema>;
export type SubjectUpdate = z.input<typeof SubjectUpdateSchema>;

export const SubjectViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string().nullable(),
  displayOrder: z.number(),
  status: RecordStatus.schema,
});
export type SubjectView = z.infer<typeof SubjectViewSchema>;

// ---------------------------------------------------------------------------
// Periods & breaks (the day structure of an academic year)
// ---------------------------------------------------------------------------

const slotFields = {
  kind: PeriodKind.schema,
  /** Required for teaching periods (P1, P2…); breaks have none. */
  periodNumber: z
    .number({ message: 'Period number must be a number' })
    .int({ message: 'Period number must be a whole number' })
    .min(1, { message: 'Period number must be at least 1' })
    .max(20, { message: 'Period number must be at most 20' })
    .nullable()
    .optional(),
  label: requiredText(40, 'Name'),
  startTime: TimeOfDaySchema,
  endTime: TimeOfDaySchema,
};

export const PeriodCreateSchema = z.object(slotFields).superRefine((v, ctx) => {
  if (v.startTime >= v.endTime) {
    ctx.addIssue({
      code: 'custom',
      path: ['endTime'],
      message: 'End time must be after the start time',
    });
  }
  if (v.kind === 'LESSON' && (v.periodNumber === null || v.periodNumber === undefined)) {
    ctx.addIssue({ code: 'custom', path: ['periodNumber'], message: 'Enter the period number' });
  }
  if (v.kind === 'BREAK' && v.periodNumber !== null && v.periodNumber !== undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['periodNumber'],
      message: 'Breaks do not have a period number',
    });
  }
});
export const PeriodUpdateSchema = z.object({
  periodNumber: slotFields.periodNumber,
  label: slotFields.label.optional(),
  startTime: TimeOfDaySchema.optional(),
  endTime: TimeOfDaySchema.optional(),
  status: RecordStatus.schema.optional(),
});
export type PeriodCreate = z.input<typeof PeriodCreateSchema>;
export type PeriodUpdate = z.input<typeof PeriodUpdateSchema>;

export const PeriodViewSchema = z.object({
  id: z.string(),
  academicYearId: z.string(),
  kind: PeriodKind.schema,
  periodNumber: z.number().nullable(),
  label: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  status: RecordStatus.schema,
});
export type PeriodView = z.infer<typeof PeriodViewSchema>;

export const DayStructureViewSchema = z.object({
  academicYear: AcademicYearViewSchema,
  slots: z.array(PeriodViewSchema),
});
export type DayStructureView = z.infer<typeof DayStructureViewSchema>;

export const CopyDayStructureSchema = z.object({ fromAcademicYearId: z.string().min(1) });

// ---------------------------------------------------------------------------
// Attendance locking policy
// ---------------------------------------------------------------------------

export const ATTENDANCE_LOCK_MODES = ['MONTHLY_CUTOFF', 'NO_LOCK'] as const;
export type AttendanceLockMode = (typeof ATTENDANCE_LOCK_MODES)[number];

export const AttendancePolicyUpdateSchema = z.object({
  mode: z.enum(ATTENDANCE_LOCK_MODES),
  /** Attendance for a month stays editable until this day of the following month (inclusive). */
  cutoffDay: z
    .number({ message: 'Cutoff day must be a number' })
    .int({ message: 'Cutoff day must be a whole number' })
    .min(1, { message: 'Cutoff day must be between 1 and 28' })
    .max(28, { message: 'Cutoff day must be between 1 and 28' }),
});
export type AttendancePolicyUpdate = z.input<typeof AttendancePolicyUpdateSchema>;
export const AttendancePolicyViewSchema = AttendancePolicyUpdateSchema.extend({
  updatedAt: z.string(),
});
export type AttendancePolicyView = z.infer<typeof AttendancePolicyViewSchema>;

/**
 * The first date (YYYY-MM-DD) on which attendance of the given month is locked, or null when the
 * policy never locks. Example: cutoff day 7 → September 2026 locks on 2026-10-08.
 * Shared so the Admin preview and the Phase 7 attendance rules use one calculation.
 */
export function attendanceLockDate(
  policy: Pick<AttendancePolicyView, 'mode' | 'cutoffDay'>,
  year: number,
  month: number,
): string | null {
  if (policy.mode === 'NO_LOCK') return null;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const day = policy.cutoffDay + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Is attendance taken on `attendanceDate` locked on `today`? (Both YYYY-MM-DD.) */
export function isAttendanceLocked(
  policy: Pick<AttendancePolicyView, 'mode' | 'cutoffDay'>,
  attendanceDate: string,
  today: string,
): boolean {
  const [y, m] = attendanceDate.split('-').map(Number) as [number, number];
  const lockDate = attendanceLockDate(policy, y, m);
  return lockDate !== null && today >= lockDate;
}

// ---------------------------------------------------------------------------
// Grade scales
// ---------------------------------------------------------------------------

export const GradeBandInputSchema = z.object({
  label: requiredText(10, 'Grade'),
  /** Lowest percentage that earns this grade (inclusive). The band runs up to the next grade. */
  minPercent: percentSchema('Minimum percentage'),
  remark: optionalText(60, 'Remark'),
});

export const GradeSchemeInputSchema = z
  .object({
    name: requiredText(60, 'Scale name'),
    status: RecordStatus.schema.optional(),
    bands: z
      .array(GradeBandInputSchema)
      .min(2, { message: 'Add at least two grades' })
      .max(20, { message: 'A scale can have at most 20 grades' }),
  })
  .superRefine((v, ctx) => {
    const labels = new Set<string>();
    const mins = new Set<number>();
    v.bands.forEach((band, i) => {
      const key = band.label.toLowerCase();
      if (labels.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['bands', i, 'label'],
          message: 'Each grade must have a different name',
        });
      }
      labels.add(key);
      if (mins.has(band.minPercent)) {
        ctx.addIssue({
          code: 'custom',
          path: ['bands', i, 'minPercent'],
          message: 'Two grades cannot start at the same percentage',
        });
      }
      mins.add(band.minPercent);
    });
    if (!mins.has(0)) {
      ctx.addIssue({
        code: 'custom',
        path: ['bands'],
        message: 'The lowest grade must start at 0% so every mark gets a grade',
      });
    }
  });
export type GradeSchemeInput = z.input<typeof GradeSchemeInputSchema>;

export const GradeBandViewSchema = z.object({
  label: z.string(),
  minPercent: z.number(),
  /** Upper limit: exclusive (the next grade's minimum), or 100 inclusive for the top grade. */
  maxPercent: z.number(),
  remark: z.string().nullable(),
});
export const GradeSchemeViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: RecordStatus.schema,
  bands: z.array(GradeBandViewSchema),
  inUse: z.boolean(),
  updatedAt: z.string(),
});
export type GradeBandView = z.infer<typeof GradeBandViewSchema>;
export type GradeSchemeView = z.infer<typeof GradeSchemeViewSchema>;

/** Bands ordered from the highest grade down, each with its derived upper limit. */
export function orderGradeBands(
  bands: readonly { label: string; minPercent: number; remark: string | null }[],
): GradeBandView[] {
  const sorted = [...bands].sort((a, b) => b.minPercent - a.minPercent);
  return sorted.map((band, i) => ({
    ...band,
    maxPercent: i === 0 ? 100 : sorted[i - 1]!.minPercent,
  }));
}

/** The grade for a percentage under a scale (used by results in Phase 8). */
export function gradeFor(
  bands: readonly { label: string; minPercent: number }[],
  percent: number,
): string | null {
  const match = [...bands]
    .sort((a, b) => b.minPercent - a.minPercent)
    .find((b) => percent >= b.minPercent);
  return match?.label ?? null;
}

// ---------------------------------------------------------------------------
// Exams
// ---------------------------------------------------------------------------

export const RANK_SCOPES = ['SECTION', 'CLASS'] as const;
export type RankScope = (typeof RANK_SCOPES)[number];

const examFields = {
  academicYearId: z.string().min(1, { message: 'Choose an academic year' }),
  name: requiredText(60, 'Exam name'),
  startDate: IsoDateSchema.nullable().optional(),
  endDate: IsoDateSchema.nullable().optional(),
  /** Share of the annual result (BR-EX-03). 0 = not counted in the annual result. */
  weightagePercent: percentSchema('Weightage'),
  gradeSchemeId: z.string().min(1).nullable().optional(),
  rankScope: z.enum(RANK_SCOPES).default('SECTION'),
  displayOrder,
  /** Optional note shown with the exam (Phase 8B). */
  description: optionalText(300, 'Description'),
};

function datesInOrder(v: { startDate?: string | null; endDate?: string | null }) {
  return !v.startDate || !v.endDate || v.startDate <= v.endDate;
}

export const ExamCreateSchema = z
  .object(examFields)
  .refine(datesInOrder, { path: ['endDate'], message: 'End date cannot be before the start date' });
export const ExamUpdateSchema = z
  .object({
    name: examFields.name.optional(),
    startDate: examFields.startDate,
    endDate: examFields.endDate,
    weightagePercent: examFields.weightagePercent.optional(),
    gradeSchemeId: examFields.gradeSchemeId,
    rankScope: z.enum(RANK_SCOPES).optional(),
    displayOrder: displayOrder.optional(),
    status: RecordStatus.schema.optional(),
    description: examFields.description.optional(),
  })
  .refine(datesInOrder, { path: ['endDate'], message: 'End date cannot be before the start date' });
export type ExamCreate = z.input<typeof ExamCreateSchema>;
export type ExamUpdate = z.input<typeof ExamUpdateSchema>;

export const ExamViewSchema = z.object({
  id: z.string(),
  academicYearId: z.string(),
  name: z.string(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  weightagePercent: z.number(),
  gradeSchemeId: z.string().nullable(),
  rankScope: z.enum(RANK_SCOPES),
  displayOrder: z.number(),
  status: RecordStatus.schema,
  /** Phase 8B marks lifecycle: DRAFT → OPEN → CLOSED. */
  stage: ExamStage.schema,
  description: z.string().nullable(),
  /** Number of class × subject rows configured for this exam. */
  subjectCount: z.number(),
});
export type ExamView = z.infer<typeof ExamViewSchema>;

export const ExamListViewSchema = z.object({
  exams: z.array(ExamViewSchema),
  /** Sum of weightage of ACTIVE exams in the year. Annual results need exactly 100. */
  totalWeightagePercent: z.number(),
  weightageComplete: z.boolean(),
});
export type ExamListView = z.infer<typeof ExamListViewSchema>;

export const ExamSubjectInputSchema = z
  .object({
    subjectId: z.string().min(1),
    /** Written/theory component. */
    theoryMax: marks('Theory maximum'),
    internalMax: marks('Internal maximum').nullable().optional(),
    practicalMax: marks('Practical maximum').nullable().optional(),
    passMarks: marks('Pass marks'),
    /** When set, the total is scaled to this maximum (e.g. 42/50 → 84/100). Original marks are kept. */
    normalizedMax: marks('Convert to', { min: 1 }).nullable().optional(),
    includeInResult: z.boolean().default(true),
    gradeSchemeId: z.string().min(1).nullable().optional(),
  })
  .superRefine((v, ctx) => {
    const total = v.theoryMax + (v.internalMax ?? 0) + (v.practicalMax ?? 0);
    if (total <= 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['theoryMax'],
        message: 'Maximum marks must add up to more than 0',
      });
    }
    if (v.passMarks > total) {
      ctx.addIssue({
        code: 'custom',
        path: ['passMarks'],
        message: `Pass marks cannot exceed the total of ${total}`,
      });
    }
  });
export const ExamSubjectsUpdateSchema = z
  .object({ subjects: z.array(ExamSubjectInputSchema).max(40) })
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    v.subjects.forEach((s, i) => {
      if (seen.has(s.subjectId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['subjects', i, 'subjectId'],
          message: 'A subject can be added only once',
        });
      }
      seen.add(s.subjectId);
    });
  });
export type ExamSubjectInput = z.input<typeof ExamSubjectInputSchema>;

export const ExamSubjectViewSchema = z.object({
  id: z.string(),
  subjectId: z.string(),
  subjectName: z.string(),
  theoryMax: z.number(),
  internalMax: z.number().nullable(),
  practicalMax: z.number().nullable(),
  totalMax: z.number(),
  passMarks: z.number(),
  normalizedMax: z.number().nullable(),
  includeInResult: z.boolean(),
  gradeSchemeId: z.string().nullable(),
  /** Mark sheets of this subject already hold marks (Phase 8B): it cannot be removed. */
  hasMarks: z.boolean(),
  /** A mark sheet is submitted: the marking settings cannot change until it is unlocked. */
  locked: z.boolean(),
});
export type ExamSubjectView = z.infer<typeof ExamSubjectViewSchema>;

/** Scale an obtained total to the normalized maximum (no rounding — see D-10). */
export function normalizeMarks(
  obtained: number,
  totalMax: number,
  normalizedMax: number | null,
): number {
  return normalizedMax === null || totalMax === 0
    ? obtained
    : (obtained / totalMax) * normalizedMax;
}

// ---------------------------------------------------------------------------
// Behaviour & achievements
// ---------------------------------------------------------------------------

export const CategoryCreateSchema = z.object({
  name: requiredText(60, 'Name'),
  description: optionalText(200, 'Description'),
  displayOrder,
});
export const CategoryUpdateSchema = CategoryCreateSchema.partial().extend({
  status: RecordStatus.schema.optional(),
});
export type CategoryCreate = z.input<typeof CategoryCreateSchema>;
export type CategoryUpdate = z.input<typeof CategoryUpdateSchema>;

export const CategoryViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  displayOrder: z.number(),
  status: RecordStatus.schema,
});
export type CategoryView = z.infer<typeof CategoryViewSchema>;

export const RATING_VALUES = [1, 2, 3, 4, 5] as const;

export const RatingLabelsUpdateSchema = z
  .object({
    labels: z
      .array(
        z.object({
          rating: z.number().int().min(1).max(5),
          label: requiredText(40, 'Label'),
          description: optionalText(150, 'Description'),
        }),
      )
      .length(5, { message: 'Provide a label for each rating from 1 to 5' }),
  })
  .refine((v) => new Set(v.labels.map((l) => l.rating)).size === 5, {
    path: ['labels'],
    message: 'Each rating from 1 to 5 must appear once',
  });
export type RatingLabelsUpdate = z.input<typeof RatingLabelsUpdateSchema>;

export const RatingLabelViewSchema = z.object({
  rating: z.number(),
  label: z.string().nullable(),
  description: z.string().nullable(),
});
export type RatingLabelView = z.infer<typeof RatingLabelViewSchema>;
export const BehaviourConfigViewSchema = z.object({
  categories: z.array(CategoryViewSchema),
  ratingLabels: z.array(RatingLabelViewSchema),
});
export type BehaviourConfigView = z.infer<typeof BehaviourConfigViewSchema>;

/**
 * Starting points an administrator may CHOOSE to add (never inserted automatically).
 * They are the examples from the specification, not decided school values.
 */
export const SUGGESTED_BEHAVIOUR_CATEGORIES = [
  'Discipline',
  'Participation',
  'Punctuality',
  'Cooperation',
  'Overall Behaviour',
] as const;
export const SUGGESTED_RATING_LABELS = [
  'Needs Improvement',
  'Below Expectations',
  'Satisfactory',
  'Good',
  'Excellent',
] as const;
export const SUGGESTED_ACHIEVEMENT_CATEGORIES = [
  'Academic',
  'Sports',
  'Cultural',
  'Competitions',
  'Certifications',
  'Other',
] as const;

// ---------------------------------------------------------------------------
// Role permissions
// ---------------------------------------------------------------------------

export const ConfigurableRoleSchema = z.enum(CONFIGURABLE_ROLES);

export const RolePermissionsUpdateSchema = z.object({
  permissions: z.array(PermissionSchema).refine((list) => new Set(list).size === list.length, {
    message: 'Permissions must not repeat',
  }),
});
export type RolePermissionsUpdate = z.input<typeof RolePermissionsUpdateSchema>;

export const RolePermissionsViewSchema = z.object({
  role: ConfigurableRoleSchema,
  /** Built-in defaults for the role. */
  defaults: z.array(PermissionSchema),
  /** What the role holds now (defaults adjusted by the administrator). */
  effective: z.array(PermissionSchema),
  /** The ceiling: everything this role may ever hold. */
  grantable: z.array(PermissionSchema),
});
export const PermissionsViewSchema = z.object({
  admin: z.array(PermissionSchema),
  roles: z.array(RolePermissionsViewSchema),
});
export type RolePermissionsView = z.infer<typeof RolePermissionsViewSchema>;
export type PermissionsView = z.infer<typeof PermissionsViewSchema>;
