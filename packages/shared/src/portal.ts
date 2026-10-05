import { z } from 'zod';
import { BehaviourRatingSchema, RecordStatus } from './controlled-values.js';
import { ExamRefSchema } from './marks.js';
import { GENDERS, PlacementViewSchema } from './people.js';
import { TimetableSectionRefSchema, TimetableYearRefSchema } from './timetable.js';
import {
  IdSchema,
  IsoDateSchema,
  PaginationQuerySchema,
  optionalText,
  requiredText,
} from './validation.js';

/*
 * Phase 9 — Student portal, exam-based behaviour and achievements.
 *
 * Behaviour: Academic year → Exam → Section → ONE behaviour sheet (DRAFT → SUBMITTED)
 *   → one assessment per student (optional remark) → one 1–5 rating per configured category.
 * Achievements: a student's record in an academic year (configured category, title, description,
 *   date; ACTIVE or ARCHIVED).
 * The portal shows the signed-in student's OWN data only; ids are never taken from the request.
 */

// ---------------------------------------------------------------------------
// Student profile (read-only)
// ---------------------------------------------------------------------------

export const PortalProfileViewSchema = z.object({
  student: z.object({
    id: z.string(),
    fullName: z.string(),
    admissionNumber: z.string(),
    admissionDate: z.string().nullable(),
    dateOfBirth: z.string().nullable(),
    gender: z.enum(GENDERS).nullable(),
    fatherName: z.string().nullable(),
    motherName: z.string().nullable(),
    guardianName: z.string().nullable(),
    guardianRelation: z.string().nullable(),
    guardianPhone: z.string().nullable(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    address: z.string().nullable(),
    city: z.string().nullable(),
    state: z.string().nullable(),
    pincode: z.string().nullable(),
    status: RecordStatus.schema,
  }),
  account: z.object({ username: z.string(), status: RecordStatus.schema }),
  currentYear: TimetableYearRefSchema.nullable(),
  /** Placement in the current academic year, if any. */
  current: PlacementViewSchema.nullable(),
  /** Every placement, newest first (academic history, never rewritten). */
  history: z.array(PlacementViewSchema),
});
export type PortalProfileView = z.infer<typeof PortalProfileViewSchema>;

// ---------------------------------------------------------------------------
// Behaviour
// ---------------------------------------------------------------------------

export const BEHAVIOUR_REMARK_MAX = 300;

export const BehaviourSheetKeySchema = z.object({ examId: IdSchema, sectionId: IdSchema });
export type BehaviourSheetKey = z.infer<typeof BehaviourSheetKeySchema>;

const remark = optionalText(BEHAVIOUR_REMARK_MAX, 'Remark');

export const BehaviourRowInputSchema = z.object({
  studentId: IdSchema,
  ratings: z
    .array(z.object({ categoryId: IdSchema, rating: BehaviourRatingSchema.nullable() }))
    .max(50)
    .refine((list) => new Set(list.map((r) => r.categoryId)).size === list.length, {
      message: 'Each category can appear only once',
    }),
  remark,
});
export type BehaviourRowInput = z.input<typeof BehaviourRowInputSchema>;

/**
 * Save behaviour. On a DRAFT sheet this is "Save draft". On a SUBMITTED sheet it is a correction
 * and `reason` is required (≥ 5 characters); the sheet stays submitted (D-82).
 */
export const BehaviourSheetSaveSchema = BehaviourSheetKeySchema.extend({
  revision: z.number().int().min(1).nullable(),
  rows: z
    .array(BehaviourRowInputSchema)
    .max(200)
    .refine((rows) => new Set(rows.map((r) => r.studentId)).size === rows.length, {
      message: 'Each student can appear only once',
    }),
  reason: optionalText(300, 'Reason').optional(),
});
export type BehaviourSheetSave = z.input<typeof BehaviourSheetSaveSchema>;

export const BehaviourSheetSubmitSchema = BehaviourSheetKeySchema.extend({
  revision: z.number().int().min(1),
});
export type BehaviourSheetSubmit = z.input<typeof BehaviourSheetSubmitSchema>;

export const BehaviourStatus = z.enum(['DRAFT', 'SUBMITTED']);
export type BehaviourStatus = z.infer<typeof BehaviourStatus>;

const CategoryRef = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  /** Inactive categories appear only where ratings already exist; they are not required. */
  active: z.boolean(),
});
const RatingLabel = z.object({ rating: z.number(), label: z.string() });

export const BehaviourSheetViewSchema = z.object({
  academicYear: TimetableYearRefSchema,
  exam: ExamRefSchema,
  section: TimetableSectionRefSchema,
  categories: z.array(CategoryRef),
  labels: z.array(RatingLabel),
  status: BehaviourStatus,
  /** null until the sheet is first saved. */
  revision: z.number().nullable(),
  submitted: z.object({ at: z.string(), by: z.string().nullable() }).nullable(),
  updatedAt: z.string().nullable(),
  rows: z.array(
    z.object({
      studentId: z.string(),
      enrolmentId: z.string(),
      rollNumber: z.string().nullable(),
      admissionNumber: z.string(),
      fullName: z.string(),
      onRoll: z.boolean(),
      ratings: z.record(z.string(), z.number().nullable()),
      remark: z.string().nullable(),
      /** Every active category is rated. */
      complete: z.boolean(),
    }),
  ),
  counts: z.object({ complete: z.number(), total: z.number() }),
  access: z.object({
    canEdit: z.boolean(),
    canSubmit: z.boolean(),
    /** Submitted: every change is a correction and needs a reason. */
    correction: z.boolean(),
    readOnlyReason: z.string().nullable(),
  }),
});
export type BehaviourSheetView = z.infer<typeof BehaviourSheetViewSchema>;

export const BehaviourOptionsViewSchema = z.object({
  years: z.array(TimetableYearRefSchema),
  academicYearId: z.string().nullable(),
  exams: z.array(ExamRefSchema),
  sections: z.array(TimetableSectionRefSchema),
  /** What is missing in School setup before behaviour can be recorded (empty = ready). */
  setupProblems: z.array(z.string()),
});
export type BehaviourOptionsView = z.infer<typeof BehaviourOptionsViewSchema>;

/** A finalised (or, for staff, any) behaviour assessment of one student for one exam. */
export const StudentBehaviourSchema = z.object({
  academicYear: TimetableYearRefSchema,
  exam: ExamRefSchema,
  section: TimetableSectionRefSchema,
  status: BehaviourStatus,
  submittedAt: z.string().nullable(),
  ratings: z.array(
    z.object({
      categoryId: z.string(),
      categoryName: z.string(),
      rating: z.number(),
      label: z.string().nullable(),
    }),
  ),
  remark: z.string().nullable(),
});
export type StudentBehaviour = z.infer<typeof StudentBehaviourSchema>;

export const StudentBehaviourListSchema = z.object({
  assessments: z.array(StudentBehaviourSchema),
});
export type StudentBehaviourList = z.infer<typeof StudentBehaviourListSchema>;

// ---------------------------------------------------------------------------
// Achievements
// ---------------------------------------------------------------------------

export const AchievementStatus = z.enum(['ACTIVE', 'ARCHIVED']);
export type AchievementStatus = z.infer<typeof AchievementStatus>;

const achievementFields = {
  categoryId: IdSchema.or(z.literal('')).refine((v) => v !== '', {
    message: 'Choose a category',
  }),
  title: requiredText(120, 'Title'),
  description: optionalText(1000, 'Description'),
  achievedOn: IsoDateSchema,
};

export const AchievementCreateSchema = z.object({
  studentId: IdSchema.or(z.literal('')).refine((v) => v !== '', {
    message: 'Choose a student',
  }),
  academicYearId: IdSchema,
  ...achievementFields,
});
export type AchievementCreate = z.input<typeof AchievementCreateSchema>;

export const AchievementUpdateSchema = z.object(achievementFields);
export type AchievementUpdate = z.input<typeof AchievementUpdateSchema>;

export const AchievementListQuerySchema = PaginationQuerySchema.extend({
  academicYearId: IdSchema.optional(),
  sectionId: IdSchema.optional(),
  studentId: IdSchema.optional(),
  categoryId: IdSchema.optional(),
  from: IsoDateSchema.optional(),
  to: IsoDateSchema.optional(),
  q: z.string().trim().max(80).optional(),
  status: z.enum(['ACTIVE', 'ARCHIVED', 'ALL']).default('ACTIVE'),
});
export type AchievementListQuery = z.input<typeof AchievementListQuerySchema>;

export const AchievementViewSchema = z.object({
  id: z.string(),
  academicYear: TimetableYearRefSchema,
  student: z.object({
    id: z.string(),
    fullName: z.string(),
    admissionNumber: z.string(),
    rollNumber: z.string().nullable(),
  }),
  section: TimetableSectionRefSchema,
  category: z.object({ id: z.string(), name: z.string() }),
  title: z.string(),
  description: z.string().nullable(),
  achievedOn: z.string(),
  /** Reserved for a certificate/image reference; no upload exists yet (D-88). */
  hasAttachment: z.boolean(),
  status: AchievementStatus,
  createdBy: z.string().nullable(),
  updatedAt: z.string(),
  /** May the current user edit / archive it (staff only). */
  canManage: z.boolean(),
});
export type AchievementView = z.infer<typeof AchievementViewSchema>;

export const AchievementListSchema = z.object({
  items: z.array(AchievementViewSchema),
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
});
export type AchievementList = z.infer<typeof AchievementListSchema>;

export const AchievementOptionsViewSchema = z.object({
  years: z.array(TimetableYearRefSchema.extend({ startDate: z.string(), endDate: z.string() })),
  academicYearId: z.string().nullable(),
  sections: z.array(TimetableSectionRefSchema),
  categories: z.array(z.object({ id: z.string(), name: z.string(), active: z.boolean() })),
  /** Administrators may delete archived achievements permanently. */
  canDelete: z.boolean(),
});
export type AchievementOptionsView = z.infer<typeof AchievementOptionsViewSchema>;

export const PortalQuerySchema = z.object({ academicYearId: IdSchema.optional() });
