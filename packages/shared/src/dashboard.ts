import { z } from 'zod';
import { TimetableRequestSummarySchema } from './timetable-requests.js';
import { AttendanceCountsSchema, AttendanceLessonsViewSchema } from './attendance.js';
import {
  AnnouncementViewSchema,
  RequestViewSchema,
  StudentDayViewSchema,
} from './communication.js';
import { ExamRefSchema, ExamSummaryViewSchema } from './marks.js';
import { AchievementViewSchema, BehaviourStatus, StudentBehaviourSchema } from './portal.js';
import { TimetableSectionRefSchema, TimetableYearRefSchema } from './timetable.js';

/*
 * Phase 10 — role dashboards ("what do I need to do today?").
 *
 * ONE aggregated response per user. Every block is built by calling the existing source-of-truth
 * service (attendance views, the timetable + academic calendar, marks home, results, behaviour,
 * achievements, announcements, requests) with the caller's own identity, so a dashboard number
 * can never disagree with the page it links to. A block the caller may not see is null/empty.
 */

/** Where a mark sheet stands for its entry teacher (derived from the Phase 8B sheet state). */
export const MarkTaskState = z.enum([
  'NOT_STARTED',
  'DRAFT',
  'READY_TO_SUBMIT',
  'SUBMITTED',
  'NEEDS_CORRECTION',
]);
export type MarkTaskState = z.infer<typeof MarkTaskState>;

export const MARK_TASK_STATE_LABELS: Readonly<Record<MarkTaskState, string>> = Object.freeze({
  NOT_STARTED: 'Not started',
  DRAFT: 'Draft',
  READY_TO_SUBMIT: 'Ready to submit',
  SUBMITTED: 'Submitted',
  NEEDS_CORRECTION: 'Needs correction',
});

const SheetCounts = z.object({
  /** Sheets that should exist (exam subject × section). */
  total: z.number(),
  notStarted: z.number(),
  draft: z.number(),
  submitted: z.number(),
  unlocked: z.number(),
});

/** One section's attendance today (from the attendance class-day logic). */
const SectionAttendanceToday = z.object({
  section: TimetableSectionRefSchema,
  lessons: z.number(),
  taken: z.number(),
  counts: AttendanceCountsSchema,
});

export const AdminDashboardSchema = z.object({
  counts: z.object({
    activeStudents: z.number(),
    activeTeachers: z.number(),
    activeClasses: z.number(),
    activeSections: z.number(),
  }),
  today: z.object({
    /** Some class works today (academic calendar). */
    schoolDay: z.boolean(),
    /** Calendar entries that apply today (holiday or special working day), e.g. "Holiday: Diwali". */
    notes: z.array(z.string()),
    attendance: z.object({
      lessons: z.number(),
      taken: z.number(),
      counts: AttendanceCountsSchema,
      /** Sections with registers not yet taken today. */
      pending: z.array(SectionAttendanceToday),
      workingSections: z.number(),
    }),
  }),
  exams: z.array(ExamRefSchema.extend({ sheets: SheetCounts })),
  /** Phase 12C: timetable change requests waiting for an administrator. */
  timetableRequests: TimetableRequestSummarySchema,
});
export type AdminDashboard = z.infer<typeof AdminDashboardSchema>;

export const MarkTaskSchema = z.object({
  exam: ExamRefSchema,
  examSubjectId: z.string(),
  sectionId: z.string(),
  className: z.string(),
  sectionName: z.string(),
  subjectName: z.string(),
  state: MarkTaskState,
  entered: z.number(),
  /** Students on the sheet; null when the sheet has not been started. */
  total: z.number().nullable(),
});
export type MarkTask = z.infer<typeof MarkTaskSchema>;

export const TeachingDashboardSchema = z.object({
  lessons: AttendanceLessonsViewSchema,
  markTasks: z.array(MarkTaskSchema),
});
export type TeachingDashboard = z.infer<typeof TeachingDashboardSchema>;

export const ClassDashboardSchema = z.object({
  section: TimetableSectionRefSchema,
  academicYearId: z.string(),
  studentCount: z.number(),
  attendance: z
    .object({
      schoolDay: z.boolean(),
      lessons: z.number(),
      taken: z.number(),
      counts: AttendanceCountsSchema,
      /** Today's lessons whose register has not been taken. */
      notTaken: z.array(
        z.object({
          periodId: z.string(),
          periodLabel: z.string(),
          startTime: z.string(),
          subjectName: z.string(),
          teacherName: z.string(),
        }),
      ),
      /** Students marked absent in at least one lesson today. */
      absentStudents: z.number(),
    })
    .nullable(),
  exams: z.array(
    z.object({
      exam: ExamRefSchema,
      subjectsSubmitted: z.number(),
      subjectsTotal: z.number(),
      /** Behaviour sheet state for this exam and section; null = not started. */
      behaviour: BehaviourStatus.nullable(),
    }),
  ),
  achievements: z.array(AchievementViewSchema),
});
export type ClassDashboard = z.infer<typeof ClassDashboardSchema>;

export const StudentDashboardSchema = z.object({
  student: z.object({
    fullName: z.string(),
    admissionNumber: z.string(),
    rollNumber: z.string().nullable(),
  }),
  section: TimetableSectionRefSchema.nullable(),
  today: StudentDayViewSchema.nullable(),
  /** Same calculation and default range as the My attendance page. */
  attendance: z
    .object({ from: z.string(), to: z.string(), counts: AttendanceCountsSchema })
    .nullable(),
  latestResult: z
    .object({
      exam: ExamRefSchema,
      availableCount: z.number(),
      requiredCount: z.number(),
      complete: z.boolean(),
      summary: ExamSummaryViewSchema.nullable(),
    })
    .nullable(),
  behaviour: StudentBehaviourSchema.nullable(),
  achievements: z.array(AchievementViewSchema),
});
export type StudentDashboard = z.infer<typeof StudentDashboardSchema>;

export const DashboardViewSchema = z.object({
  date: z.string(),
  academicYear: TimetableYearRefSchema.nullable(),
  admin: AdminDashboardSchema.nullable(),
  teaching: TeachingDashboardSchema.nullable(),
  classes: z.array(ClassDashboardSchema),
  student: StudentDashboardSchema.nullable(),
  announcements: z.object({ items: z.array(AnnouncementViewSchema), total: z.number() }).nullable(),
  requests: z.object({ items: z.array(RequestViewSchema), active: z.number() }).nullable(),
});
export type DashboardView = z.infer<typeof DashboardViewSchema>;
