import { TimetableChangeRequestService } from '../timetable/change-request.service.js';
import {
  type AdminDashboard,
  type ClassDashboard,
  type DashboardView,
  type MarkTask,
  type MarkTaskState,
  type StudentDashboard,
  type TeachingDashboard,
} from '@ttlmhss/shared';
import { AppError } from '../../core/errors/app-errors.js';
import type { AcademicYearRecord } from '../config/config.repository.js';
import { AchievementService } from '../achievements/achievement.service.js';
import { AnnouncementService } from '../announcements/announcement.service.js';
import { addDays } from '../attendance/attendance-service.js';
import { AttendanceViewService } from '../attendance/attendance-views.service.js';
import { BehaviourService } from '../behaviour/behaviour.service.js';
import { loadFrame } from '../timetable/timetable-service.js';
import { MarkSheetService } from '../marks/mark-sheet.service.js';
import {
  MarksServiceBase,
  type MarksServiceDeps,
  type RequestContext,
} from '../marks/marks-context.js';
import { ResultsService } from '../marks/results.service.js';
import { PortalService } from '../portal/portal.service.js';
import { RequestService } from '../requests/request.service.js';

/** A sheet with no marks at all yet (not created, or created by the teacher assignment). */
const notStarted = (s: { status: string | null; entered: number }) =>
  s.status === null || (s.status === 'DRAFT' && s.entered === 0);

/** The My attendance page's default window (today and the 27 days before it). */
const ATTENDANCE_WINDOW_DAYS = 27;
const TASK_ORDER: MarkTaskState[] = [
  'NEEDS_CORRECTION',
  'READY_TO_SUBMIT',
  'DRAFT',
  'NOT_STARTED',
  'SUBMITTED',
];

/**
 * Role dashboards (Phase 10). THIS SERVICE CALCULATES NOTHING OF ITS OWN: every block calls the
 * existing source-of-truth service with the caller's own identity, so permissions, scope, the
 * academic calendar and visibility rules apply exactly as on the page each card links to.
 *
 *   admin     counts (student/teacher list totals, configured classes), today's calendar and
 *             attendance (AttendanceViewService.schoolDay → the class-day lesson logic), exam
 *             mark-sheet states (MarkSheetService.home)
 *   teaching  today's lessons with register state (AttendanceViewService.lessons) and the sheets
 *             the teacher enters (MarkSheetService.home / sheet)
 *   classes   per own section: AttendanceViewService.classDay, marks home, BehaviourService.sheet,
 *             AchievementService.list
 *   student   PortalService.profile, AttendanceViewService.myDay / myAttendance (P ÷ (P + A)),
 *             ResultsService (Phase 8B visibility), BehaviourService.mine, AchievementService.mine
 *   shared    AnnouncementService.feed, RequestService.list / mine / activeCount
 *
 * A block the caller is not allowed to see (permission adjusted by an administrator, no
 * placement, no current year) is simply left out — the dashboard never widens access.
 */
export class DashboardService extends MarksServiceBase {
  private readonly attendance: AttendanceViewService;
  private readonly marks: MarkSheetService;
  private readonly results: ResultsService;
  private readonly behaviour: BehaviourService;
  private readonly achievements: AchievementService;
  private readonly announcements: AnnouncementService;
  private readonly requests: RequestService;
  private readonly portal: PortalService;
  private readonly timetableRequests: TimetableChangeRequestService;

  constructor(deps: MarksServiceDeps) {
    super(deps);
    this.attendance = new AttendanceViewService(deps);
    this.marks = new MarkSheetService(deps);
    this.results = new ResultsService(deps);
    this.behaviour = new BehaviourService(deps);
    this.achievements = new AchievementService(deps);
    this.announcements = new AnnouncementService(deps);
    this.requests = new RequestService(deps);
    this.portal = new PortalService(deps);
    this.timetableRequests = new TimetableChangeRequestService(deps);
  }

  /** Runs one block; a refusal or "not applicable" from the underlying service leaves it out. */
  private async safe<T>(work: () => Promise<T>): Promise<T | null> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof AppError && error.statusCode < 500) return null;
      throw error;
    }
  }

  async view(ctx: RequestContext): Promise<DashboardView> {
    const p = ctx.principal;
    if (!p) throw new Error('Dashboard requires a signed-in user.');
    const repos = this.repos;
    const today = this.today();
    const year = await repos.academicYears.findCurrent();
    const admin = this.isAdmin(p) ? await this.safe(() => this.admin(ctx, today, year)) : null;
    const teaching = p.teacherId ? await this.safe(() => this.teaching(ctx, today, year)) : null;
    const classes: ClassDashboard[] = [];
    if (year && !p.studentId) {
      for (const s of p.classTeacherOf.filter((c) => c.academicYearId === year.id)) {
        const block = await this.safe(() => this.classBlock(ctx, today, year, s.sectionId));
        if (block) classes.push(block);
      }
    }
    const student = p.studentId ? await this.safe(() => this.student(ctx, today, year)) : null;
    const announcements = p.permissions.has('announcements.view')
      ? await this.safe(async () => {
          const feed = await this.announcements.feed(ctx, { page: 1, pageSize: 5 });
          return { items: feed.items, total: feed.total };
        })
      : null;
    const requests = p.permissions.has('requests.view')
      ? await this.safe(async () => {
          const query = { page: 1, pageSize: 5, status: 'ACTIVE' as const };
          const list = p.studentId
            ? await this.requests.mine(ctx, query)
            : await this.requests.list(ctx, query);
          return { items: list.items, active: list.total };
        })
      : null;
    return {
      date: today,
      academicYear: year ? { id: year.id, label: year.label, status: year.status } : null,
      admin,
      teaching,
      classes,
      student,
      announcements,
      requests,
    };
  }

  // ---- Administrator --------------------------------------------------------------------------

  private async admin(
    ctx: RequestContext,
    today: string,
    year: AcademicYearRecord | null,
  ): Promise<AdminDashboard> {
    const repos = this.repos;
    const [students, teachers, classes, sections] = await Promise.all([
      repos.students.list({
        q: null,
        academicYearId: null,
        classId: null,
        sectionIds: null,
        status: 'ACTIVE',
        sort: 'name',
        offset: 0,
        limit: 1,
      }),
      repos.teachers.list({
        q: null,
        subjectId: null,
        status: 'ACTIVE',
        designation: null,
        offset: 0,
        limit: 1,
      }),
      repos.classes.listClasses(),
      repos.classes.listSections(),
    ]);
    const activeClassIds = new Set(classes.filter((c) => c.status === 'ACTIVE').map((c) => c.id));
    const day = await this.attendance.schoolDay(ctx, today);
    const notes: string[] = [];
    if (year) {
      const entries = (await repos.calendar.listByYear(year.id)).filter((e) => e.date === today);
      const frame = await loadFrame(repos, year);
      for (const e of entries) {
        const kind = e.status === 'HOLIDAY' ? 'Holiday' : 'Special working day';
        const scope = e.scope === 'SCHOOL' ? 'whole school' : 'some classes';
        notes.push(`${kind}: ${e.reason} (${scope})`);
      }
      if (entries.length === 0 && !frame.calendar.workingForAnyone(today)) {
        notes.push('Not a working day in the weekly pattern.');
      }
    } else {
      notes.push('There is no current academic year.');
    }
    const lessons = day.sections.reduce((n, s) => n + s.lessons, 0);
    const taken = day.sections.reduce((n, s) => n + s.taken, 0);
    const home = await this.marks.home(ctx, year?.id);
    // Phase 12C: timetable change requests waiting for review (the same list the review page shows).
    const timetableRequests = ctx.principal!.permissions.has('timetable.publish')
      ? await this.timetableRequests.summary(ctx)
      : { pending: 0, items: [] };
    return {
      timetableRequests,
      counts: {
        activeStudents: students.total,
        activeTeachers: teachers.total,
        activeClasses: activeClassIds.size,
        activeSections: sections.filter(
          (s) => s.status === 'ACTIVE' && activeClassIds.has(s.classId),
        ).length,
      },
      today: {
        schoolDay: day.schoolDay,
        notes,
        attendance: {
          lessons,
          taken,
          counts: day.counts,
          pending: day.sections.filter((s) => s.taken < s.lessons),
          workingSections: day.workingSections,
        },
      },
      exams: home.exams
        .filter((e) => e.stage !== 'CLOSED')
        .map(({ sheets, ...exam }) => ({
          ...exam,
          sheets: {
            total: sheets.length,
            // "Not started": no sheet yet, or a draft without a single student's marks.
            notStarted: sheets.filter((s) => notStarted(s)).length,
            draft: sheets.filter((s) => s.status === 'DRAFT' && !notStarted(s)).length,
            submitted: sheets.filter((s) => s.status === 'SUBMITTED').length,
            unlocked: sheets.filter((s) => s.status === 'UNLOCKED').length,
          },
        })),
    };
  }

  // ---- Teacher --------------------------------------------------------------------------------

  private async teaching(
    ctx: RequestContext,
    today: string,
    year: AcademicYearRecord | null,
  ): Promise<TeachingDashboard> {
    const lessons = await this.attendance.lessons(ctx, today);
    const markTasks: MarkTask[] = [];
    const home = await this.safe(() => this.marks.home(ctx, year?.id));
    for (const exam of home?.exams ?? []) {
      if (exam.stage !== 'OPEN') continue;
      const { sheets, ...ref } = exam;
      for (const s of sheets.filter((x) => x.role === 'ENTRY_TEACHER')) {
        let state: MarkTaskState;
        let total: number | null = null;
        let entered = s.entered;
        if (notStarted(s)) state = 'NOT_STARTED';
        else if (s.status === 'SUBMITTED') state = 'SUBMITTED';
        else {
          // Draft or unlocked: the sheet itself says how many students it has.
          const sheet = await this.marks.sheet(ctx, {
            examSubjectId: s.examSubjectId,
            sectionId: s.sectionId,
          });
          total = sheet.counts.total;
          entered = sheet.counts.entered;
          state =
            s.status === 'UNLOCKED'
              ? 'NEEDS_CORRECTION'
              : total > 0 && entered === total
                ? 'READY_TO_SUBMIT'
                : 'DRAFT';
        }
        markTasks.push({
          exam: ref,
          examSubjectId: s.examSubjectId,
          sectionId: s.sectionId,
          className: s.className,
          sectionName: s.sectionName,
          subjectName: s.subjectName,
          state,
          entered,
          total,
        });
      }
    }
    markTasks.sort((a, b) => TASK_ORDER.indexOf(a.state) - TASK_ORDER.indexOf(b.state));
    return { lessons, markTasks };
  }

  // ---- Class teacher --------------------------------------------------------------------------

  private async classBlock(
    ctx: RequestContext,
    today: string,
    year: AcademicYearRecord,
    sectionId: string,
  ): Promise<ClassDashboard> {
    const repos = this.repos;
    const roster = await repos.enrolments.listActiveInSection(year.id, sectionId);
    const first = roster[0];
    const sectionRecord = await repos.classes.findSection(sectionId);
    const classRecord = sectionRecord ? await repos.classes.findClass(sectionRecord.classId) : null;
    const section = {
      sectionId,
      sectionName: first?.sectionName ?? sectionRecord?.name ?? '',
      classId: first?.classId ?? sectionRecord?.classId ?? '',
      className: first?.className ?? classRecord?.name ?? '',
    };
    const day = await this.safe(() => this.attendance.classDay(ctx, sectionId, today));
    const attendance = day
      ? {
          schoolDay: day.schoolDay,
          lessons: day.periods.length,
          taken: day.periods.filter((x) => x.attendance.taken).length,
          counts: day.counts,
          notTaken: day.periods
            .filter((x) => !x.attendance.taken)
            .map((x) => ({
              periodId: x.period.id,
              periodLabel: x.period.label,
              startTime: x.period.startTime,
              subjectName: x.subject.name,
              teacherName: x.teacher.fullName,
            })),
          absentStudents: day.students.filter((st) => st.counts.A > 0).length,
        }
      : null;
    const home = await this.safe(() => this.marks.home(ctx, year.id));
    const exams: ClassDashboard['exams'] = [];
    for (const exam of home?.exams ?? []) {
      if (exam.stage === 'DRAFT') continue;
      const { sheets, ...ref } = exam;
      const own = sheets.filter((s) => s.sectionId === sectionId);
      if (own.length === 0) continue;
      const behaviour = await this.safe(() =>
        this.behaviour.sheet(ctx, { examId: ref.id, sectionId }),
      );
      exams.push({
        exam: ref,
        subjectsSubmitted: own.filter((s) => s.status === 'SUBMITTED').length,
        subjectsTotal: own.length,
        behaviour: behaviour && behaviour.revision !== null ? behaviour.status : null,
      });
    }
    const achievements = await this.safe(() =>
      this.achievements.list(ctx, {
        page: 1,
        pageSize: 3,
        academicYearId: year.id,
        sectionId,
        status: 'ACTIVE',
      }),
    );
    return {
      section,
      academicYearId: year.id,
      studentCount: roster.length,
      attendance,
      exams,
      achievements: achievements?.items ?? [],
    };
  }

  // ---- Student --------------------------------------------------------------------------------

  private async student(
    ctx: RequestContext,
    today: string,
    year: AcademicYearRecord | null,
  ): Promise<StudentDashboard> {
    const profile = await this.portal.profile(ctx);
    const current = profile.current;
    const todayView = await this.safe(() => this.attendance.myDay(ctx, today));
    let attendance: StudentDashboard['attendance'] = null;
    if (year && today >= year.startDate && today <= year.endDate) {
      const start = addDays(today, -ATTENDANCE_WINDOW_DAYS);
      const from = start < year.startDate ? year.startDate : start;
      const view = await this.safe(() => this.attendance.myAttendance(ctx, from, today));
      if (view) attendance = { from: view.from, to: view.to, counts: view.counts };
    }
    let latestResult: StudentDashboard['latestResult'] = null;
    const exams = await this.safe(() => this.results.myExams(ctx, year?.id));
    const newestFirst = [...(exams?.exams ?? [])].sort((a, b) =>
      (b.startDate ?? '').localeCompare(a.startDate ?? ''),
    );
    for (const exam of newestFirst) {
      const result = await this.safe(() => this.results.myResult(ctx, exam.id));
      if (result && result.availableCount > 0) {
        latestResult = {
          exam: result.exam,
          availableCount: result.availableCount,
          requiredCount: result.requiredCount,
          complete: result.complete,
          summary: result.summary,
        };
        break;
      }
    }
    const behaviour = await this.safe(() => this.behaviour.mine(ctx, year?.id));
    const achievements = await this.safe(() => this.achievements.mine(ctx));
    return {
      student: {
        fullName: profile.student.fullName,
        admissionNumber: profile.student.admissionNumber,
        rollNumber: current?.rollNumber ?? null,
      },
      section: current
        ? {
            sectionId: current.sectionId,
            sectionName: current.sectionName,
            classId: current.classId,
            className: current.className,
          }
        : null,
      today: current ? todayView : null,
      attendance,
      latestResult,
      behaviour: behaviour?.assessments[0] ?? null,
      achievements: (achievements?.items ?? []).slice(0, 3),
    };
  }
}
