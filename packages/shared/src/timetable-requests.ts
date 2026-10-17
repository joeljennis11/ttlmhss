import { z } from 'zod';
import { Weekday, controlledValues } from './controlled-values.js';
import { IdSchema, requiredText } from './validation.js';

/**
 * Timetable change requests (Phase 12C). A class teacher who may not edit the draft asks for a
 * change to ONE lesson slot of their own section; an administrator approves (the change is applied
 * to the year's draft through the normal validated editor — never to the published timetable) or
 * declines. Publishing stays a separate administrator action.
 *
 * PENDING → APPROVED (applied to the draft) | DECLINED (reason) | WITHDRAWN (by the requester).
 */
export const TimetableRequestStatus = controlledValues([
  'PENDING',
  'APPROVED',
  'DECLINED',
  'WITHDRAWN',
]);
export type TimetableRequestStatus = (typeof TimetableRequestStatus.values)[number];

/** ADD: an empty slot gets a lesson; CHANGE: another subject/teacher; REMOVE: the slot is freed. */
export const TimetableRequestKind = controlledValues(['ADD', 'CHANGE', 'REMOVE']);
export type TimetableRequestKind = (typeof TimetableRequestKind.values)[number];

export const TIMETABLE_REQUEST_REASON_MAX = 500;
/** Open requests one person may have at a time (stops accidental floods). */
export const TIMETABLE_REQUEST_ACTIVE_LIMIT = 20;

export const TimetableRequestCreateSchema = z
  .object({
    academicYearId: IdSchema,
    sectionId: IdSchema,
    day: z.enum(Weekday.values, { message: 'Choose a day' }),
    periodId: IdSchema,
    kind: z.enum(TimetableRequestKind.values, { message: 'Choose what should change' }),
    subjectId: IdSchema.nullable().default(null),
    teacherId: IdSchema.nullable().default(null),
    reason: requiredText(TIMETABLE_REQUEST_REASON_MAX, 'Reason'),
  })
  .superRefine((v, ctx) => {
    if (v.kind !== 'REMOVE') {
      if (!v.subjectId)
        ctx.addIssue({ code: 'custom', path: ['subjectId'], message: 'Choose a subject' });
      if (!v.teacherId)
        ctx.addIssue({ code: 'custom', path: ['teacherId'], message: 'Choose a teacher' });
    }
  });
export type TimetableRequestCreate = z.input<typeof TimetableRequestCreateSchema>;

export const TimetableRequestReviewSchema = z.object({
  revision: z.number().int().min(1),
  note: z
    .string()
    .trim()
    .max(TIMETABLE_REQUEST_REASON_MAX)
    .nullish()
    .transform((v) => (v ? v : null)),
});
export const TimetableRequestDeclineSchema = TimetableRequestReviewSchema.extend({
  note: requiredText(TIMETABLE_REQUEST_REASON_MAX, 'Reason for declining'),
});
export const TimetableRequestWithdrawSchema = z.object({ revision: z.number().int().min(1) });

export const TimetableRequestListQuerySchema = z.object({
  academicYearId: IdSchema.optional(),
  status: z.enum([...TimetableRequestStatus.values, 'ALL']).default('ALL'),
});

const Named = z.object({ id: z.string(), name: z.string() });
const Lesson = z.object({ subject: Named, teacher: Named }).nullable();

export const TimetableRequestViewSchema = z.object({
  id: z.string(),
  academicYearId: z.string(),
  section: z.object({ id: z.string(), label: z.string() }),
  day: z.enum(Weekday.values),
  period: z.object({ id: z.string(), label: z.string() }),
  kind: z.enum(TimetableRequestKind.values),
  /** The lesson in the slot when the request was made (published timetable). */
  current: Lesson,
  /** What the requester asks for (null for REMOVE). */
  proposed: Lesson,
  reason: z.string(),
  status: z.enum(TimetableRequestStatus.values),
  requestedBy: z.string(),
  requestedAt: z.string(),
  reviewNote: z.string().nullable(),
  reviewedBy: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  revision: z.number(),
  /** What the caller may do now (UX only; the server re-checks). */
  canReview: z.boolean(),
  canWithdraw: z.boolean(),
});
export type TimetableRequestView = z.infer<typeof TimetableRequestViewSchema>;

export const TimetableRequestListSchema = z.object({
  items: z.array(TimetableRequestViewSchema),
  pending: z.number(),
});
export type TimetableRequestList = z.infer<typeof TimetableRequestListSchema>;

export const TimetableRequestOptionsSchema = z.object({
  academicYear: z.object({ id: z.string(), label: z.string() }).nullable(),
  /** Sections the caller may request changes for (their own class). Empty for administrators. */
  sections: z.array(z.object({ id: z.string(), label: z.string() })),
  days: z.array(z.enum(Weekday.values)),
  periods: z.array(z.object({ id: z.string(), label: z.string() })),
  subjects: z.array(Named),
  /** Active teachers with the subjects they can teach (Teacher → Subject). */
  teachers: z.array(Named.extend({ subjectIds: z.array(z.string()) })),
  activeCount: z.number(),
  activeLimit: z.number(),
});
export type TimetableRequestOptions = z.infer<typeof TimetableRequestOptionsSchema>;

/** Administrator dashboard: requests waiting for review. */
export const TimetableRequestSummarySchema = z.object({
  pending: z.number(),
  items: z.array(
    z.object({
      id: z.string(),
      section: z.string(),
      day: z.enum(Weekday.values),
      period: z.string(),
      kind: z.enum(TimetableRequestKind.values),
      reason: z.string(),
      requestedBy: z.string(),
      requestedAt: z.string(),
    }),
  ),
});
export type TimetableRequestSummary = z.infer<typeof TimetableRequestSummarySchema>;
