import {
  type ClassAttendanceReport,
  type ClassAttendanceReportQuerySchema,
  type ExamReportCard,
  type ExamReportCardQuerySchema,
  type MarkSheetReport,
  type MarkSheetReportQuerySchema,
  type PerformanceReport,
  type PerformanceReportQuerySchema,
  type ReportOptions,
  type StudentAttendanceReport,
  type StudentAttendanceReportQuerySchema,
  type StudentExamResultView,
} from '@ttlmhss/shared';
import type { z } from 'zod';
import type { Principal } from '../../core/auth/access.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  fieldConflict,
} from '../../core/errors/app-errors.js';
import { FileResponse, PDF, XLSX } from '../../core/http/file-response.js';
import type { Repositories } from '../../data/data-store.js';
import { AchievementService } from '../achievements/achievement.service.js';
import { AttendanceViewService } from '../attendance/attendance-views.service.js';
import { BehaviourService } from '../behaviour/behaviour.service.js';
import { MarkSheetService } from '../marks/mark-sheet.service.js';
import {
  MarksServiceBase,
  type MarksServiceDeps,
  type RequestContext,
} from '../marks/marks-context.js';
import { ResultsService } from '../marks/results.service.js';
import { classAttendanceXlsx } from './render/attendance-xlsx.js';
import {
  classAttendancePdf,
  examReportCardPdf,
  markSheetPdf,
  performancePdf,
  studentAttendancePdf,
} from './render/documents.js';
import { reportFileName, reportSchool } from './report-context.js';

type Q<S extends z.ZodType> = z.output<S>;
const NO_REPORT = 'You do not have access to this report.';

/**
 * Reports (Phase 11). Every report is COMPOSED from the existing source-of-truth services, called
 * with the caller's own identity — so their permission and scope checks apply unchanged:
 *   exam report card   ← ResultsService (Phase 8B visibility, completeness, rank)
 *   mark sheet         ← MarkSheetService.sheet (Phase 8B authorisation; stored derived values)
 *   attendance         ← AttendanceViewService.studentAttendance / classRegister (P ÷ (P + A),
 *                        academic calendar)
 *   performance        ← results + attendance + BehaviourService + AchievementService
 * The JSON document is what the preview shows and what the PDF/XLSX renders: one composition.
 */
export class ReportService extends MarksServiceBase {
  private readonly attendance: AttendanceViewService;
  private readonly marks: MarkSheetService;
  private readonly results: ResultsService;
  private readonly behaviour: BehaviourService;
  private readonly achievements: AchievementService;

  constructor(deps: MarksServiceDeps) {
    super(deps);
    this.attendance = new AttendanceViewService(deps);
    this.marks = new MarkSheetService(deps);
    this.results = new ResultsService(deps);
    this.behaviour = new BehaviourService(deps);
    this.achievements = new AchievementService(deps);
  }

  private now() {
    return this.deps.clock.now().toISOString();
  }

  /** A student account always means "myself"; another id is refused like a missing one. */
  private subjectStudent(p: Principal, requested: string | undefined): string {
    if (p.studentId) {
      if (requested && requested !== p.studentId) throw new ForbiddenError(NO_REPORT);
      return p.studentId;
    }
    if (!requested) throw fieldConflict('studentId', 'Choose a student.');
    return requested;
  }

  private async yearFor(repos: Repositories, date: string) {
    const years = (await repos.academicYears.list()).filter(
      (y) => y.startDate <= date && date <= y.endDate,
    );
    const year = years.find((y) => y.status === 'CURRENT') ?? years[0];
    if (!year) throw fieldConflict('from', 'Choose dates within an academic year.');
    return year;
  }

  /** The student's placement in a year covering `date` (else their latest one that year). */
  private async placementIn(repos: Repositories, studentId: string, yearId: string, date: string) {
    const list = await repos.enrolments.listForStudentInYear(studentId, yearId);
    return (
      list.find((p) => p.startedOn <= date && (p.endedOn === null || p.endedOn >= date)) ??
      [...list].sort((a, b) => b.startedOn.localeCompare(a.startedOn))[0] ??
      null
    );
  }

  // ---- Options --------------------------------------------------------------------------------

  async options(ctx: RequestContext, academicYearId?: string): Promise<ReportOptions> {
    const p = this.authorize(ctx, 'reports.view');
    const repos = this.repos;
    const allYears = await repos.academicYears.list();
    const years = allYears.map((y) => ({
      id: y.id,
      label: y.label,
      status: y.status,
      startDate: y.startDate,
      endDate: y.endDate,
    }));
    const year =
      years.find((y) => y.id === academicYearId) ??
      years.find((y) => y.status === 'CURRENT') ??
      years[0] ??
      null;
    const admin = this.isAdmin(p);
    const own = p.classTeacherOf
      .filter((s) => s.academicYearId === year?.id)
      .map((s) => s.sectionId);
    const [classes, sections] = await Promise.all([
      repos.classes.listClasses(),
      repos.classes.listSections(),
    ]);
    const classOf = new Map(classes.map((c) => [c.id, c]));
    const exams = year
      ? (await repos.exams.listByYear(year.id)).filter(
          (e) => e.status === 'ACTIVE' && (admin || e.stage !== 'DRAFT'),
        )
      : [];
    const staffScope = admin || own.length > 0;
    return {
      years,
      academicYearId: year?.id ?? null,
      sections: p.studentId
        ? []
        : sections
            .filter((s) => (admin ? s.status === 'ACTIVE' : own.includes(s.id)))
            .sort(
              (a, b) =>
                (classOf.get(a.classId)?.displayOrder ?? 0) -
                  (classOf.get(b.classId)?.displayOrder ?? 0) || a.name.localeCompare(b.name),
            )
            .map((s) => ({
              sectionId: s.id,
              sectionName: s.name,
              classId: s.classId,
              className: classOf.get(s.classId)?.name ?? '',
            })),
      exams: exams.map((e) => ({
        id: e.id,
        name: e.name,
        stage: e.stage,
        status: e.status,
        startDate: e.startDate,
        endDate: e.endDate,
      })),
      can: {
        examReports: staffScope && p.permissions.has('results.view'),
        markSheets: !p.studentId && p.permissions.has('marks.view'),
        classAttendance: staffScope && (admin || p.permissions.has('attendance.manage')),
        annualReports: staffScope && p.permissions.has('reports.generate'),
        publishAnnual: admin,
      },
    };
  }

  // ---- Exam report card -----------------------------------------------------------------------

  async examReportCard(
    ctx: RequestContext,
    q: Q<typeof ExamReportCardQuerySchema>,
  ): Promise<ExamReportCard | FileResponse> {
    const p = this.authorize(ctx, 'reports.view');
    const studentId = this.subjectStudent(p, q.studentId);
    const result = p.studentId
      ? await this.results.myResult(ctx, q.examId)
      : await this.results.studentResultFor(ctx, q.examId, studentId);
    const { school, withLogo } = await reportSchool(this.repos);
    const doc: ExamReportCard = {
      kind: 'EXAM_REPORT_CARD',
      school,
      generatedAt: this.now(),
      fileName: reportFileName(
        school.shortName,
        result.academicYear.label,
        'ExamReport',
        [result.student.admissionNumber, result.exam.name],
        'pdf',
      ),
      result,
      official: result.complete,
    };
    if (q.format === 'json') return doc;
    if (q.format !== 'pdf') throw fieldConflict('format', 'Report cards are available as PDF.');
    // Phase 8B: a full report card only once every subject that counts is finalised.
    if (!doc.official) {
      throw new ConflictError(
        `This result is incomplete (${result.availableCount} of ${result.requiredCount} subjects published). The official report card is available once every subject is submitted.`,
      );
    }
    return new FileResponse(await examReportCardPdf(doc, withLogo), PDF, doc.fileName);
  }

  // ---- Mark sheet -----------------------------------------------------------------------------

  async markSheet(
    ctx: RequestContext,
    q: Q<typeof MarkSheetReportQuerySchema>,
  ): Promise<MarkSheetReport | FileResponse> {
    const p = this.authorize(ctx, 'reports.view');
    if (p.studentId) throw new ForbiddenError(NO_REPORT);
    const sheet = await this.marks.sheet(ctx, {
      examSubjectId: q.examSubjectId,
      sectionId: q.sectionId,
    });
    const { school, withLogo } = await reportSchool(this.repos);
    const doc: MarkSheetReport = {
      kind: 'MARK_SHEET',
      school,
      generatedAt: this.now(),
      fileName: reportFileName(
        school.shortName,
        sheet.academicYear.label,
        'MarkSheet',
        [
          sheet.exam.name,
          `${sheet.section.className}${sheet.section.sectionName}`,
          sheet.subject.name,
        ],
        'pdf',
      ),
      sheet,
    };
    if (q.format === 'json') return doc;
    if (q.format !== 'pdf') throw fieldConflict('format', 'Mark sheets are available as PDF.');
    return new FileResponse(await markSheetPdf(doc, withLogo), PDF, doc.fileName);
  }

  // ---- Attendance -----------------------------------------------------------------------------

  async studentAttendance(
    ctx: RequestContext,
    q: Q<typeof StudentAttendanceReportQuerySchema>,
  ): Promise<StudentAttendanceReport | FileResponse> {
    const p = this.authorize(ctx, 'reports.view');
    const studentId = this.subjectStudent(p, q.studentId);
    // The attendance service decides access (self, class teacher of the placement, admin).
    const attendance = await this.attendance.studentAttendance(ctx, studentId, q.from, q.to);
    const repos = this.repos;
    const year = await this.yearFor(repos, q.from);
    const student = (await repos.students.find(studentId))!;
    const placement = await this.placementIn(repos, studentId, year.id, attendance.to);
    const { school, withLogo } = await reportSchool(repos);
    const doc: StudentAttendanceReport = {
      kind: 'STUDENT_ATTENDANCE',
      school,
      generatedAt: this.now(),
      fileName: reportFileName(
        school.shortName,
        year.label,
        'Attendance',
        [student.admissionNumber, `${attendance.from}_${attendance.to}`],
        'pdf',
      ),
      academicYear: { id: year.id, label: year.label, status: year.status },
      student: {
        id: student.id,
        fullName: student.fullName,
        admissionNumber: student.admissionNumber,
        rollNumber: placement?.rollNumber ?? null,
      },
      section: placement
        ? {
            sectionId: placement.sectionId,
            sectionName: placement.sectionName,
            classId: placement.classId,
            className: placement.className,
          }
        : null,
      attendance,
    };
    if (q.format === 'json') return doc;
    if (q.format !== 'pdf') throw fieldConflict('format', 'This report is available as PDF.');
    return new FileResponse(await studentAttendancePdf(doc, withLogo), PDF, doc.fileName);
  }

  async classAttendance(
    ctx: RequestContext,
    q: Q<typeof ClassAttendanceReportQuerySchema>,
  ): Promise<ClassAttendanceReport | FileResponse> {
    const p = this.authorize(ctx, 'reports.view');
    if (p.studentId) throw new ForbiddenError(NO_REPORT);
    // Scope (administrator / class teacher of the section) is the attendance service's.
    const register = await this.attendance.classRegister(ctx, q.sectionId, q.from, q.to);
    const { school, withLogo } = await reportSchool(this.repos);
    const s = register.summary.section;
    const doc: ClassAttendanceReport = {
      kind: 'CLASS_ATTENDANCE',
      school,
      generatedAt: this.now(),
      fileName: reportFileName(
        school.shortName,
        register.academicYear.label,
        'ClassAttendance',
        [`${s.className}${s.sectionName}`, `${register.summary.from}_${register.summary.to}`],
        q.format === 'xlsx' ? 'xlsx' : 'pdf',
      ),
      academicYear: register.academicYear,
      summary: register.summary,
      lessonCount: register.lessonCount,
    };
    if (q.format === 'json') return doc;
    if (q.format === 'xlsx') {
      return new FileResponse(await classAttendanceXlsx(doc, register.rows), XLSX, doc.fileName);
    }
    return new FileResponse(await classAttendancePdf(doc, withLogo), PDF, doc.fileName);
  }

  // ---- Student performance --------------------------------------------------------------------

  async performance(
    ctx: RequestContext,
    q: Q<typeof PerformanceReportQuerySchema>,
  ): Promise<PerformanceReport | FileResponse> {
    const p = this.authorize(ctx, 'reports.view');
    const studentId = this.subjectStudent(p, q.studentId);
    const repos = this.repos;
    // Scope first, the same refusal whether or not the student exists.
    if (!(await this.deps.authorization.canAccessStudent(p, studentId))) {
      throw new ForbiddenError(NO_REPORT);
    }
    const student = await repos.students.find(studentId);
    if (!student) throw new NotFoundError('That student was not found.');
    const year = q.academicYearId
      ? await repos.academicYears.find(q.academicYearId)
      : await repos.academicYears.findCurrent();
    if (!year) throw fieldConflict('academicYearId', 'Choose an academic year.');
    const today = this.today();
    const placement = await this.placementIn(
      repos,
      studentId,
      year.id,
      today < year.endDate ? today : year.endDate,
    );
    if (!placement)
      throw new ConflictError(`${student.fullName} was not placed in a class in ${year.label}.`);

    // Exams: the Phase 8B results this viewer may see (students: own visible results only).
    const examList = p.studentId
      ? (await this.results.myExams(ctx, year.id)).exams
      : (await this.results.options(ctx, year.id)).exams;
    const exams: StudentExamResultView[] = [];
    for (const exam of [...examList].sort((a, b) =>
      (a.startDate ?? '').localeCompare(b.startDate ?? ''),
    )) {
      try {
        exams.push(
          p.studentId
            ? await this.results.myResult(ctx, exam.id)
            : await this.results.studentResultFor(ctx, exam.id, studentId),
        );
      } catch (error) {
        // Not placed in a class that took this exam.
        if (!(error instanceof NotFoundError)) throw error;
      }
    }
    const to = today < year.endDate ? today : year.endDate;
    let attendance: PerformanceReport['attendance'] = null;
    if (to >= year.startDate) {
      const view = await this.attendance.studentAttendance(ctx, studentId, year.startDate, to);
      attendance = { from: view.from, to: view.to, counts: view.counts };
    }
    const behaviour = (
      p.studentId
        ? (await this.behaviour.mine(ctx, year.id)).assessments
        : (await this.behaviour.forStudent(ctx, studentId)).assessments
    ).filter((a) => a.academicYear.id === year.id && a.status === 'SUBMITTED');
    const achievements = p.studentId
      ? (await this.achievements.mine(ctx, year.id)).items
      : (
          await this.achievements.list(ctx, {
            academicYearId: year.id,
            studentId,
            status: 'ACTIVE',
            page: 1,
            pageSize: 100,
          })
        ).items;
    const { school, withLogo } = await reportSchool(repos);
    const doc: PerformanceReport = {
      kind: 'STUDENT_PERFORMANCE',
      school,
      generatedAt: this.now(),
      fileName: reportFileName(
        school.shortName,
        year.label,
        'Performance',
        [student.admissionNumber],
        'pdf',
      ),
      academicYear: { id: year.id, label: year.label, status: year.status },
      student: {
        id: student.id,
        fullName: student.fullName,
        admissionNumber: student.admissionNumber,
        rollNumber: placement.rollNumber,
      },
      section: {
        sectionId: placement.sectionId,
        sectionName: placement.sectionName,
        classId: placement.classId,
        className: placement.className,
      },
      exams,
      attendance,
      behaviour,
      achievements: [...achievements].sort((a, b) => a.achievedOn.localeCompare(b.achievedOn)),
    };
    if (q.format === 'json') return doc;
    if (q.format !== 'pdf') throw fieldConflict('format', 'This report is available as PDF.');
    return new FileResponse(await performancePdf(doc, withLogo), PDF, doc.fileName);
  }
}
