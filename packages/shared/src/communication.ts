import { z } from 'zod';
import {
  AnnouncementAudience,
  AnnouncementStatus,
  AttendanceStatus,
  ProfileField,
  RequestStatus,
  RequestType,
  UserRole,
} from './controlled-values.js';
import { TimetableSectionRefSchema, TimetableYearRefSchema } from './timetable.js';
import {
  IdSchema,
  IsoDateSchema,
  PaginationQuerySchema,
  optionalText,
  requiredText,
} from './validation.js';

/*
 * Phase 10 — announcements and structured student requests.
 *
 * Announcements: an informational message for a structured audience (whole school, staff, a class,
 *   a section) in an academic year. Draft → Published → Archived; optional expiry date. Not a
 *   notification or chat system.
 * Requests: a student's structured request for review (attendance issue, result clarification,
 *   profile correction). Open → In review → Resolved → Closed (reopen possible). Handling a request
 *   never changes attendance, marks or the profile: the reviewer uses the existing pages for that.
 */

const ANNOUNCEMENT_TITLE_MAX = 120;
const ANNOUNCEMENT_BODY_MAX = 4000;

// ---------------------------------------------------------------------------
// Announcements
// ---------------------------------------------------------------------------

const optionalId = IdSchema.nullish()
  .or(z.literal(''))
  .transform((v) => (v ? v : null));

export const AnnouncementInputSchema = z
  .object({
    title: requiredText(ANNOUNCEMENT_TITLE_MAX, 'Title'),
    body: requiredText(ANNOUNCEMENT_BODY_MAX, 'Message'),
    audience: AnnouncementAudience.schema,
    classId: optionalId,
    sectionId: optionalId,
    expiresOn: IsoDateSchema.nullish()
      .or(z.literal(''))
      .transform((v) => (v ? v : null)),
  })
  .superRefine((v, ctx) => {
    if (v.audience === 'CLASS' && !v.classId) {
      ctx.addIssue({ code: 'custom', path: ['classId'], message: 'Choose a class' });
    }
    if (v.audience === 'SECTION' && !v.sectionId) {
      ctx.addIssue({ code: 'custom', path: ['sectionId'], message: 'Choose a class section' });
    }
  });
export type AnnouncementInput = z.input<typeof AnnouncementInputSchema>;

/** Create: the fields plus whether to publish straight away ("publish now"). */
export const AnnouncementCreateSchema = z.object({
  announcement: AnnouncementInputSchema,
  publish: z.boolean().default(false),
});
export type AnnouncementCreate = z.input<typeof AnnouncementCreateSchema>;

export const AnnouncementListQuerySchema = PaginationQuerySchema.extend({
  academicYearId: IdSchema.optional(),
  status: z.enum([...AnnouncementStatus.values, 'ALL']).default('ALL'),
  audience: AnnouncementAudience.schema.optional(),
  q: z.string().trim().max(80).optional(),
});
export type AnnouncementListQuery = z.input<typeof AnnouncementListQuerySchema>;

export const AnnouncementFeedQuerySchema = PaginationQuerySchema;
export type AnnouncementFeedQuery = z.input<typeof AnnouncementFeedQuerySchema>;

export const AnnouncementViewSchema = z.object({
  id: z.string(),
  academicYear: TimetableYearRefSchema,
  title: z.string(),
  body: z.string(),
  audience: AnnouncementAudience.schema,
  /** "Whole school", "Teachers and staff", "Class 10", "Class 10 A". */
  audienceLabel: z.string(),
  classId: z.string().nullable(),
  sectionId: z.string().nullable(),
  status: AnnouncementStatus.schema,
  publishedAt: z.string().nullable(),
  expiresOn: z.string().nullable(),
  /** Published but past its expiry date: no longer shown to its audience. */
  expired: z.boolean(),
  author: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  canManage: z.boolean(),
});
export type AnnouncementView = z.infer<typeof AnnouncementViewSchema>;

export const AnnouncementListSchema = z.object({
  items: z.array(AnnouncementViewSchema),
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
});
export type AnnouncementList = z.infer<typeof AnnouncementListSchema>;

/** What the caller may target when writing an announcement (administrators: all; class teachers: own section). */
export const AnnouncementOptionsViewSchema = z.object({
  academicYear: TimetableYearRefSchema.nullable(),
  years: z.array(TimetableYearRefSchema),
  audiences: z.array(AnnouncementAudience.schema),
  classes: z.array(z.object({ id: z.string(), name: z.string() })),
  sections: z.array(TimetableSectionRefSchema),
});
export type AnnouncementOptionsView = z.infer<typeof AnnouncementOptionsViewSchema>;

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

const description = z
  .string({ message: 'Describe the problem' })
  .trim()
  .min(10, { message: 'Describe the problem in at least 10 characters' })
  .max(2000, { message: 'Description must be at most 2000 characters' });

const requiredId = (message: string) =>
  IdSchema.or(z.literal('')).refine((v) => v !== '', { message });

export const RequestCreateSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('ATTENDANCE_ISSUE'),
    date: IsoDateSchema,
    periodId: requiredId('Choose the period'),
    description,
  }),
  z.object({
    type: z.literal('RESULT_CLARIFICATION'),
    examId: requiredId('Choose the exam'),
    subjectId: requiredId('Choose the subject'),
    description,
  }),
  z.object({
    type: z.literal('PROFILE_CORRECTION'),
    field: ProfileField.schema,
    description,
  }),
]);
export type RequestCreate = z.input<typeof RequestCreateSchema>;

export const RequestListQuerySchema = PaginationQuerySchema.extend({
  academicYearId: IdSchema.optional(),
  /** ACTIVE = Open or In review. */
  status: z.enum([...RequestStatus.values, 'ACTIVE', 'ALL']).default('ACTIVE'),
  type: RequestType.schema.optional(),
  sectionId: IdSchema.optional(),
  /** Created on or after / on or before (dates). */
  from: IsoDateSchema.optional(),
  to: IsoDateSchema.optional(),
});
export type RequestListQuery = z.input<typeof RequestListQuerySchema>;

/** A reviewer's status change. A note is required to resolve, close without a resolution, or reopen. */
export const RequestStatusChangeSchema = z.object({
  status: RequestStatus.schema,
  note: optionalText(1000, 'Note'),
  revision: z.number().int().min(1),
});
export type RequestStatusChange = z.input<typeof RequestStatusChangeSchema>;

export const RequestAssignSchema = z.object({
  assigneeUserId: optionalId,
  revision: z.number().int().min(1),
});
export type RequestAssign = z.input<typeof RequestAssignSchema>;

const UserRef = z.object({ userId: z.string(), name: z.string() });

export const RequestViewSchema = z.object({
  id: z.string(),
  /** Short reference shown to people, e.g. "RQ-1A2B3C4D". */
  reference: z.string(),
  type: RequestType.schema,
  status: RequestStatus.schema,
  summary: z.string(),
  academicYear: TimetableYearRefSchema,
  student: z.object({
    id: z.string(),
    fullName: z.string(),
    admissionNumber: z.string(),
    rollNumber: z.string().nullable(),
  }),
  section: TimetableSectionRefSchema,
  requester: z.object({ name: z.string(), role: UserRole.schema }),
  related: z.object({
    date: z.string().nullable(),
    period: z.object({ id: z.string(), label: z.string() }).nullable(),
    subject: z.object({ id: z.string(), name: z.string() }).nullable(),
    exam: z.object({ id: z.string(), name: z.string() }).nullable(),
    field: ProfileField.schema.nullable(),
  }),
  description: z.string(),
  assignedTo: UserRef.nullable(),
  resolutionNote: z.string().nullable(),
  resolvedBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  resolvedAt: z.string().nullable(),
  closedAt: z.string().nullable(),
  revision: z.number(),
  /** What the caller may do now (staff); all false for students. */
  actions: z.object({
    startReview: z.boolean(),
    resolve: z.boolean(),
    close: z.boolean(),
    reopen: z.boolean(),
    assign: z.boolean(),
  }),
});
export type RequestView = z.infer<typeof RequestViewSchema>;

export const RequestListSchema = z.object({
  items: z.array(RequestViewSchema),
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
});
export type RequestList = z.infer<typeof RequestListSchema>;

export const RequestDetailSchema = z.object({
  request: RequestViewSchema,
  /** Readable history from the audit trail (staff only; empty for students). */
  history: z.array(
    z.object({
      at: z.string(),
      actor: z.string().nullable(),
      action: z.string(),
      summary: z.string(),
      note: z.string().nullable(),
    }),
  ),
  /** People this request may be assigned to (administrators only; empty otherwise). */
  assignees: z.array(UserRef),
});
export type RequestDetail = z.infer<typeof RequestDetailSchema>;

/** What a student may refer to when creating a request (their own data only). */
export const RequestFormOptionsSchema = z.object({
  academicYear: TimetableYearRefSchema.nullable(),
  /** The student's placement this year; null = cannot create requests. */
  section: TimetableSectionRefSchema.nullable(),
  /** Exams whose results the student may see (Phase 8B visibility), with their subjects. */
  exams: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      subjects: z.array(z.object({ id: z.string(), name: z.string() })),
    }),
  ),
  /** Earliest and latest dates an attendance issue may refer to. */
  attendanceFrom: z.string().nullable(),
  attendanceTo: z.string().nullable(),
  /** Open + in review requests the student has, and the limit. */
  activeCount: z.number(),
  activeLimit: z.number(),
});
export type RequestFormOptions = z.infer<typeof RequestFormOptionsSchema>;

/** A student's lessons on one date (calendar-aware), for choosing the period of an attendance issue. */
export const StudentDayViewSchema = z.object({
  date: z.string(),
  schoolDay: z.boolean(),
  section: TimetableSectionRefSchema.nullable(),
  lessons: z.array(
    z.object({
      period: z.object({
        id: z.string(),
        label: z.string(),
        periodNumber: z.number().nullable(),
        startTime: z.string(),
        endTime: z.string(),
      }),
      subject: z.object({ id: z.string(), name: z.string() }),
      teacherName: z.string(),
      /** '-' when not marked yet. */
      status: AttendanceStatus.schema,
    }),
  ),
});
export type StudentDayView = z.infer<typeof StudentDayViewSchema>;
