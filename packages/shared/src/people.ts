import { z } from 'zod';
import { EnrolmentStatus, PromotionOutcome, RecordStatus } from './controlled-values.js';
import { IsoDateSchema, optionalText, requiredText } from './validation.js';

/*
 * Phase 5 — Student & teacher management contracts. Shared by the API (authoritative validation)
 * and the web app (instant form feedback).
 *
 * Identifiers:
 *  - `id` (UUID)            internal, permanent database identity — never shown as a school number.
 *  - admission number        the school's permanent student identifier; set at admission, then fixed.
 *  - roll number             belongs to an ENROLMENT (year + section); changes on promotion/transfer.
 *  - staff code              the school's teacher identifier; set when the teacher is added, then fixed.
 */

export const GENDERS = ['MALE', 'FEMALE', 'OTHER'] as const;
export type Gender = (typeof GENDERS)[number];
export const GENDER_LABELS: Record<Gender, string> = {
  MALE: 'Male',
  FEMALE: 'Female',
  OTHER: 'Other',
};

/** Why a student is no longer on roll (set by the Transferred / Left promotion outcomes). */
export const EXIT_REASONS = ['TRANSFERRED', 'LEFT'] as const;
export type ExitReason = (typeof EXIT_REASONS)[number];

const optionalPattern = (max: number, label: string, pattern: RegExp, message: string) =>
  optionalText(max, label).refine((v) => v === null || pattern.test(v), { message });

const phone = (label: string) =>
  optionalPattern(30, label, /^[0-9+()\-\s]{6,30}$/, 'Use digits, spaces and + ( ) - only');
const email = (label: string) =>
  optionalText(120, label).refine((v) => v === null || z.email().safeParse(v).success, {
    message: 'Enter a valid email address',
  });
const optionalDate = IsoDateSchema.nullable()
  .optional()
  .transform((v) => v ?? null);
const gender = z
  .enum(GENDERS, { message: 'Choose a gender' })
  .nullable()
  .optional()
  .transform((v) => v ?? null);

/** School identifiers: letters, digits and / - . (no spaces); stored as entered, unique ignoring case. */
const schoolIdentifier = (label: string) =>
  requiredText(30, label).regex(/^[A-Za-z0-9][A-Za-z0-9/.-]*$/, {
    message: 'Use letters, digits and / - . only (no spaces)',
  });

export const RollNumberSchema = optionalPattern(
  10,
  'Roll number',
  /^[A-Za-z0-9-]+$/,
  'Use letters, digits or - only',
);

/** Optional sign-in name; when empty the API derives it from the school identifier. */
export const OptionalUsernameSchema = optionalPattern(
  64,
  'Username',
  /^[a-z0-9._@-]{3,64}$/,
  'Use 3–64 lowercase letters, digits or . _ @ -',
);

/** Turn a school identifier into a valid username (lowercase; other characters become "-"). */
export function usernameFromIdentifier(identifier: string): string {
  const base = identifier
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._@-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base.length >= 3 ? base.slice(0, 64) : `user-${base}`.slice(0, 64);
}

// ---------------------------------------------------------------------------
// Students
// ---------------------------------------------------------------------------

/** Fields an administrator may edit after admission (identifiers and placement are separate). */
export const StudentDetailsSchema = z.object({
  // Personal
  fullName: requiredText(120, 'Name'),
  dateOfBirth: optionalDate,
  gender,
  // Parent / guardian
  fatherName: optionalText(120, 'Father’s name'),
  motherName: optionalText(120, 'Mother’s name'),
  guardianName: optionalText(120, 'Guardian’s name'),
  guardianRelation: optionalText(40, 'Relationship'),
  guardianPhone: phone('Guardian’s phone'),
  // Contact
  phone: phone('Phone'),
  email: email('Email'),
  emergencyPhone: phone('Emergency phone'),
  // Address
  address: optionalText(300, 'Address'),
  city: optionalText(80, 'City / town'),
  state: optionalText(80, 'State'),
  pincode: optionalPattern(6, 'PIN code', /^[0-9]{6}$/, 'PIN code is 6 digits'),
});
export type StudentDetails = z.output<typeof StudentDetailsSchema>;
export type StudentDetailsInput = z.input<typeof StudentDetailsSchema>;

export const StudentAdmissionSchema = StudentDetailsSchema.extend({
  admissionNumber: schoolIdentifier('Admission number'),
  admissionDate: IsoDateSchema,
  academicYearId: z.string().min(1, { message: 'Choose an academic year' }),
  sectionId: z.string().min(1, { message: 'Choose a class and section' }),
  rollNumber: RollNumberSchema,
  username: OptionalUsernameSchema,
}).refine((v) => !v.dateOfBirth || v.dateOfBirth < v.admissionDate, {
  path: ['dateOfBirth'],
  message: 'Date of birth must be before the admission date',
});
export type StudentAdmissionInput = z.input<typeof StudentAdmissionSchema>;

export const StudentSortSchema = z.enum(['name', 'admission', 'roll', 'class']);
/** "LEFT_SCHOOL" = transferred out or left; "UNPLACED" = on roll but not placed in the chosen year. */
export const StudentListStatusSchema = z.enum([
  'ACTIVE',
  'INACTIVE',
  'LEFT_SCHOOL',
  'UNPLACED',
  'ALL',
]);

export const StudentListQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  academicYearId: z.string().optional(),
  classId: z.string().optional(),
  sectionId: z.string().optional(),
  status: StudentListStatusSchema.default('ACTIVE'),
  sort: StudentSortSchema.default('class'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(25),
});
export type StudentListQuery = z.input<typeof StudentListQuerySchema>;

export const AccountStatusViewSchema = z.object({
  userId: z.string(),
  username: z.string(),
  status: RecordStatus.schema,
  /** True while the person still has to replace a temporary password. */
  mustChangePassword: z.boolean(),
  lastLoginAt: z.string().nullable(),
});
export type AccountStatusView = z.infer<typeof AccountStatusViewSchema>;

export const PlacementViewSchema = z.object({
  enrolmentId: z.string(),
  academicYearId: z.string(),
  academicYearLabel: z.string(),
  classId: z.string(),
  className: z.string(),
  sectionId: z.string(),
  sectionName: z.string(),
  rollNumber: z.string().nullable(),
  status: EnrolmentStatus.schema,
  startedOn: z.string(),
  endedOn: z.string().nullable(),
});
export type PlacementView = z.infer<typeof PlacementViewSchema>;

export const StudentListItemSchema = z.object({
  id: z.string(),
  admissionNumber: z.string(),
  fullName: z.string(),
  status: RecordStatus.schema,
  exitReason: z.enum(EXIT_REASONS).nullable(),
  placement: PlacementViewSchema.nullable(),
});
export type StudentListItem = z.infer<typeof StudentListItemSchema>;

export const StudentListSchema = z.object({
  items: z.array(StudentListItemSchema),
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
  /** The academic year the placement column refers to (null when no year exists). */
  academicYearId: z.string().nullable(),
});
export type StudentList = z.infer<typeof StudentListSchema>;

export const StudentViewSchema = StudentDetailsSchema.extend({
  id: z.string(),
  admissionNumber: z.string(),
  admissionDate: z.string().nullable(),
  photoPath: z.string().nullable(),
  status: RecordStatus.schema,
  exitReason: z.enum(EXIT_REASONS).nullable(),
  exitDate: z.string().nullable(),
  /** Placement in the current academic year, if any. */
  current: PlacementViewSchema.nullable(),
  /** Every enrolment, newest first. Never rewritten. */
  history: z.array(PlacementViewSchema),
  account: AccountStatusViewSchema.nullable(),
  /** True only for a record created by mistake and never used (see BR-ST-10). */
  deletable: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type StudentView = z.infer<typeof StudentViewSchema>;

/** Mid-year move within the same academic year (BR-ST-07). */
export const StudentTransferSchema = z.object({
  /** Year of the placement being changed (default: the current academic year). */
  academicYearId: z.string().min(1).optional(),
  targetSectionId: z.string().min(1, { message: 'Choose the new class and section' }),
  rollNumber: RollNumberSchema,
  effectiveDate: IsoDateSchema,
  note: optionalText(200, 'Reason'),
});
export type StudentTransferInput = z.input<typeof StudentTransferSchema>;

/** Place a student who has no class in a year (re-admission, or a year they were not promoted into). */
export const StudentPlacementSchema = z.object({
  academicYearId: z.string().min(1, { message: 'Choose an academic year' }),
  sectionId: z.string().min(1, { message: 'Choose a class and section' }),
  rollNumber: RollNumberSchema,
  startedOn: IsoDateSchema,
});
export type StudentPlacementInput = z.input<typeof StudentPlacementSchema>;

export const StatusChangeSchema = z.object({
  status: RecordStatus.schema,
  note: optionalText(200, 'Reason'),
});

export const PromotionCandidatesQuerySchema = z.object({
  sourceAcademicYearId: z.string().min(1),
  sourceSectionId: z.string().min(1),
  targetAcademicYearId: z.string().min(1).optional(),
});

// ---------------------------------------------------------------------------
// Promotion
// ---------------------------------------------------------------------------

export const PROMOTION_OUTCOME_LABELS: Record<PromotionOutcome, string> = {
  PROMOTED: 'Promoted',
  NOT_PROMOTED: 'Not promoted',
  TRANSFERRED: 'Transferred out',
  LEFT: 'Left school',
};
/** Outcomes that continue in the target year (and therefore need a target section). */
export const CONTINUING_OUTCOMES: readonly PromotionOutcome[] = ['PROMOTED', 'NOT_PROMOTED'];

export const PromotionDecisionSchema = z
  .object({
    studentId: z.string().min(1),
    outcome: PromotionOutcome.schema,
    targetSectionId: z
      .string()
      .min(1)
      .nullable()
      .optional()
      .transform((v) => v ?? null),
    rollNumber: RollNumberSchema,
  })
  .superRefine((v, ctx) => {
    const continues = CONTINUING_OUTCOMES.includes(v.outcome);
    if (continues && !v.targetSectionId) {
      ctx.addIssue({
        code: 'custom',
        path: ['targetSectionId'],
        message: 'Choose the class and section for next year',
      });
    }
    if (!continues && (v.targetSectionId || v.rollNumber)) {
      ctx.addIssue({
        code: 'custom',
        path: ['targetSectionId'],
        message: 'A student who leaves has no next class',
      });
    }
  });

export const PromotionRequestSchema = z
  .object({
    sourceAcademicYearId: z.string().min(1, { message: 'Choose the year to promote from' }),
    sourceSectionId: z.string().min(1, { message: 'Choose the class and section' }),
    /** Needed when any student continues (Promoted / Not promoted). Leavers need no next year. */
    targetAcademicYearId: z
      .string()
      .min(1)
      .nullable()
      .optional()
      .transform((v) => v ?? null),
    decisions: z
      .array(PromotionDecisionSchema)
      .min(1, { message: 'Choose at least one student' })
      .max(200),
  })
  .superRefine((v, ctx) => {
    const continuing = v.decisions.some((d) => CONTINUING_OUTCOMES.includes(d.outcome));
    if (continuing && !v.targetAcademicYearId) {
      ctx.addIssue({
        code: 'custom',
        path: ['targetAcademicYearId'],
        message: 'Choose the year to promote into',
      });
    }
    if (v.targetAcademicYearId && v.sourceAcademicYearId === v.targetAcademicYearId) {
      ctx.addIssue({
        code: 'custom',
        path: ['targetAcademicYearId'],
        message: 'Promote into a different academic year',
      });
    }
    const seen = new Set<string>();
    v.decisions.forEach((d, i) => {
      if (seen.has(d.studentId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['decisions', i, 'studentId'],
          message: 'A student can appear only once',
        });
      }
      seen.add(d.studentId);
    });
  });
export type PromotionRequestInput = z.input<typeof PromotionRequestSchema>;

export const PromotionCandidateSchema = z.object({
  studentId: z.string(),
  admissionNumber: z.string(),
  fullName: z.string(),
  rollNumber: z.string().nullable(),
  /** Already placed in the chosen target year (cannot be promoted again). */
  targetPlacement: PlacementViewSchema.nullable(),
});
export type PromotionCandidate = z.infer<typeof PromotionCandidateSchema>;

export const PromotionResultSchema = z.object({
  promoted: z.number(),
  notPromoted: z.number(),
  transferred: z.number(),
  left: z.number(),
});
export type PromotionResult = z.infer<typeof PromotionResultSchema>;

// ---------------------------------------------------------------------------
// Teachers
// ---------------------------------------------------------------------------

export const TeacherDetailsSchema = z.object({
  fullName: requiredText(120, 'Name'),
  gender,
  dateOfBirth: optionalDate,
  phone: phone('Phone'),
  email: email('Email'),
  address: optionalText(300, 'Address'),
  designation: optionalText(80, 'Designation'),
  qualification: optionalText(120, 'Qualification'),
  joiningDate: optionalDate,
});
export type TeacherDetailsInput = z.input<typeof TeacherDetailsSchema>;

export const TeacherCreateSchema = TeacherDetailsSchema.extend({
  staffCode: schoolIdentifier('Staff ID'),
  username: OptionalUsernameSchema,
});
export type TeacherCreateInput = z.input<typeof TeacherCreateSchema>;

export const TeacherListQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  subjectId: z.string().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'ALL']).default('ACTIVE'),
  designation: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(25),
});
export type TeacherListQuery = z.input<typeof TeacherListQuerySchema>;

export const SubjectRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string().nullable(),
  status: RecordStatus.schema,
});

export const ClassTeacherAssignmentViewSchema = z.object({
  id: z.string(),
  teacherId: z.string(),
  teacherName: z.string(),
  staffCode: z.string(),
  academicYearId: z.string(),
  academicYearLabel: z.string(),
  classId: z.string(),
  className: z.string(),
  sectionId: z.string(),
  sectionName: z.string(),
  status: RecordStatus.schema,
  assignedOn: z.string(),
  endedOn: z.string().nullable(),
});
export type ClassTeacherAssignmentView = z.infer<typeof ClassTeacherAssignmentViewSchema>;

export const TeacherListItemSchema = z.object({
  id: z.string(),
  staffCode: z.string(),
  fullName: z.string(),
  designation: z.string().nullable(),
  status: RecordStatus.schema,
  subjects: z.array(SubjectRefSchema),
  /** Active class-teacher assignments in the current academic year. */
  classTeacherOf: z.array(ClassTeacherAssignmentViewSchema),
});
export type TeacherListItem = z.infer<typeof TeacherListItemSchema>;

export const TeacherListSchema = z.object({
  items: z.array(TeacherListItemSchema),
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
});
export type TeacherList = z.infer<typeof TeacherListSchema>;

export const TeacherViewSchema = TeacherDetailsSchema.extend({
  id: z.string(),
  staffCode: z.string(),
  status: RecordStatus.schema,
  subjects: z.array(SubjectRefSchema),
  /** All class-teacher assignments, newest first (history kept). */
  classTeacherAssignments: z.array(ClassTeacherAssignmentViewSchema),
  account: AccountStatusViewSchema.nullable(),
  deletable: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TeacherView = z.infer<typeof TeacherViewSchema>;

export const TeacherSubjectAssignSchema = z.object({
  subjectId: z.string().min(1, { message: 'Choose a subject' }),
});

// ---------------------------------------------------------------------------
// Class teachers
// ---------------------------------------------------------------------------

export const ClassTeacherAssignSchema = z.object({
  academicYearId: z.string().min(1, { message: 'Choose an academic year' }),
  sectionId: z.string().min(1, { message: 'Choose a class and section' }),
  teacherId: z.string().min(1, { message: 'Choose a teacher' }),
  /** Required to replace a section's current class teacher (deliberate reassignment). */
  replace: z.boolean().default(false),
});
export type ClassTeacherAssignInput = z.input<typeof ClassTeacherAssignSchema>;

export const ClassTeacherBoardRowSchema = z.object({
  classId: z.string(),
  className: z.string(),
  sectionId: z.string(),
  sectionName: z.string(),
  assignment: ClassTeacherAssignmentViewSchema.nullable(),
});
export const ClassTeacherBoardSchema = z.object({
  academicYearId: z.string(),
  rows: z.array(ClassTeacherBoardRowSchema),
});
export type ClassTeacherBoard = z.infer<typeof ClassTeacherBoardSchema>;

/** One-time credential shown to the administrator; never stored or logged in plain text. */
export const TemporaryCredentialViewSchema = z.object({
  username: z.string(),
  temporaryPassword: z.string(),
});
export type TemporaryCredentialView = z.infer<typeof TemporaryCredentialViewSchema>;
