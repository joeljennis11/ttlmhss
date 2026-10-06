import {
  annualPercentBp,
  AnnualReportContentSchema,
  type AnnualReportContent,
  type AnnualReportList,
  type AnnualReportQuerySchema,
  type AnnualReportRemarkSchema,
  type AnnualReportReopenSchema,
  type AnnualReportView,
  type MyAnnualReports,
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
import { FileResponse, PDF } from '../../core/http/file-response.js';
import { newId } from '../../core/utils/clock.js';
import type { Repositories } from '../../data/data-store.js';
import type { AcademicYearRecord } from '../config/config.repository.js';
import { AchievementService } from '../achievements/achievement.service.js';
import { AttendanceViewService } from '../attendance/attendance-views.service.js';
import { BehaviourService } from '../behaviour/behaviour.service.js';
import {
  MarksServiceBase,
  type MarksServiceDeps,
  type RequestContext,
} from '../marks/marks-context.js';
import { ResultsService } from '../marks/results.service.js';
import type { AnnualReportRecord } from './annual-reports.repository.js';
import { annualReportPdf } from './render/documents.js';
import { reportFileName, reportSchool } from './report-context.js';

const NO_ACCESS = 'You do not have access to this annual report.';
const STALE =
  'This annual report was changed by someone else after you opened it. Reload it and try again.';

const fromBp = (bp: number) => bp / 100;
const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Official annual reports (Phase 11, BR-AR). One per student and academic year:
 *   DRAFT      — computed live from the source services each time; staff only.
 *   FINALIZED  — the complete display-ready content (incl. weightages, labels, grades, names and
 *                the final remark) is frozen in `snapshot_json`; later changes to marks,
 *                attendance, configuration or placement no longer affect it.
 *   PUBLISHED  — the student can see and download it.
 * Prepare, write the remark and finalize: administrators and the class teacher of the student's
 * section in that year (`reports.generate`). Publish, unpublish and reopen (with a reason):
 * administrators only. Every step is audited (entity `annual_report`).
 *
 * The annual figure is Σ (Phase 8B exam percentage × configured Phase 4 weightage) ÷ 100 — see
 * `annualPercentBp` — and requires the weightages to total 100 % and every weighted exam's result
 * to be complete for the student. Nothing else is invented (no annual grade, result or rank).
 */
export class AnnualReportService extends MarksServiceBase {
  private readonly attendance: AttendanceViewService;
  private readonly results: ResultsService;
  private readonly behaviour: BehaviourService;
  private readonly achievements: AchievementService;

  constructor(deps: MarksServiceDeps) {
    super(deps);
    this.attendance = new AttendanceViewService(deps);
    this.results = new ResultsService(deps);
    this.behaviour = new BehaviourService(deps);
    this.achievements = new AchievementService(deps);
  }

  // ---- Scope ----------------------------------------------------------------------------------

  private isClassTeacher(p: Principal, yearId: string, sectionId: string) {
    return p.classTeacherOf.some((s) => s.academicYearId === yearId && s.sectionId === sectionId);
  }

  private canStaff(p: Principal, yearId: string, sectionId: string) {
    return !p.studentId && (this.isAdmin(p) || this.isClassTeacher(p, yearId, sectionId));
  }

  private async year(repos: Repositories, id: string) {
    const year = await repos.academicYears.find(id);
    if (!year) throw new NotFoundError('That academic year was not found.');
    return year;
  }

  /** The student's placement for the year: the one in force at its end (or today), else the latest. */
  private async placement(repos: Repositories, studentId: string, year: AcademicYearRecord) {
    const today = this.today();
    const at = today < year.endDate ? today : year.endDate;
    const list = await repos.enrolments.listForStudentInYear(studentId, year.id);
    return (
      list.find((p) => p.startedOn <= at && (p.endedOn === null || p.endedOn >= at)) ??
      [...list].sort((a, b) => b.startedOn.localeCompare(a.startedOn))[0] ??
      null
    );
  }

  /** Who the report is about, checked against the caller (same refusal whether or not it exists). */
  private async subject(p: Principal, yearId: string, studentId: string) {
    const repos = this.repos;
    const year = await this.year(repos, yearId);
    const student = await repos.students.find(studentId);
    const record = await repos.annualReports.findFor(year.id, studentId);
    const placement = student ? await this.placement(repos, studentId, year) : null;
    const sectionId = record?.sectionId ?? placement?.sectionId ?? null;
    if (!student || !sectionId || !this.canStaff(p, year.id, sectionId)) {
      if (this.isAdmin(p) && !student) throw new NotFoundError('That student was not found.');
      if (this.isAdmin(p)) {
        throw new ConflictError(`This student was not placed in a class in ${year.label}.`);
      }
      throw new ForbiddenError(NO_ACCESS);
    }
    return { year, student, placement, record };
  }

  // ---- Content (live) -------------------------------------------------------------------------

  /**
   * Builds the content from the source services (run as the staff caller, so their scope applies).
   * Used for drafts and, once, at finalization (then frozen).
   */
  private async build(
    ctx: RequestContext,
    year: AcademicYearRecord,
    studentId: string,
    section: { sectionId: string; sectionName: string; classId: string; className: string },
    rollNumber: string | null,
    finalRemark: string | null,
  ): Promise<AnnualReportContent> {
    const repos = this.repos;
    const student = (await repos.students.find(studentId))!;
    const { school } = await reportSchool(repos);
    const problems: string[] = [];

    // B / F — exams with their configured weightage and the Phase 8B result for this student.
    const active = (await repos.exams.listByYear(year.id))
      .filter((e) => e.status === 'ACTIVE')
      .sort(
        (a, b) =>
          (a.startDate ?? '9999').localeCompare(b.startDate ?? '9999') ||
          a.displayOrder - b.displayOrder,
      );
    const exams: AnnualReportContent['exams'] = [];
    for (const exam of active) {
      let result: StudentExamResultView | null = null;
      if (exam.stage !== 'DRAFT') {
        try {
          result = await this.results.studentResultFor(ctx, exam.id, studentId);
        } catch (error) {
          if (!(error instanceof NotFoundError)) throw error;
        }
      }
      if (result || exam.weightageBp > 0) {
        exams.push({
          exam: {
            id: exam.id,
            name: exam.name,
            stage: exam.stage,
            status: exam.status,
            startDate: exam.startDate,
            endDate: exam.endDate,
          },
          weightagePercent: fromBp(exam.weightageBp),
          result,
        });
      }
      if (exam.weightageBp > 0) {
        if (exam.stage === 'DRAFT') problems.push(`${exam.name} is not open for marks yet.`);
        else if (!result) problems.push(`${exam.name}: no result for this student.`);
        else if (!result.complete) {
          problems.push(
            `${exam.name}: result incomplete (${result.availableCount} of ${result.requiredCount} subjects published).`,
          );
        }
      }
    }
    const totalBp = active.reduce((sum, e) => sum + e.weightageBp, 0);
    if (totalBp !== 10_000) {
      problems.push(
        `Exam weightages for ${year.label} total ${fromBp(totalBp)}%, not 100% (School setup > Exams).`,
      );
    }
    const weighted = exams.filter((e) => e.weightagePercent > 0);
    const contributions = weighted.map((e) => {
      const percentage = e.result?.summary?.percentage ?? null;
      return {
        examId: e.exam.id,
        examName: e.exam.name,
        weightagePercent: e.weightagePercent,
        percentage,
        weighted: percentage === null ? null : round2((percentage * e.weightagePercent) / 100),
      };
    });
    const complete = contributions.length > 0 && contributions.every((c) => c.percentage !== null);
    const bp = complete
      ? annualPercentBp(
          weighted.map((e) => ({
            percentBp: Math.round(e.result!.summary!.percentage * 100),
            weightBp: Math.round(e.weightagePercent * 100),
          })),
        )
      : null;
    // Exams outside the weighting (weight 0) are shown but never enter the annual figure.

    // C — attendance over the year so far (P ÷ (P + A), academic calendar).
    const today = this.today();
    const to = today < year.endDate ? today : year.endDate;
    let attendance: AnnualReportContent['attendance'];
    if (to >= year.startDate) {
      const view = await this.attendance.studentAttendance(ctx, studentId, year.startDate, to);
      attendance = { from: view.from, to: view.to, counts: view.counts };
    } else {
      attendance = {
        from: year.startDate,
        to: year.startDate,
        counts: { total: 0, marked: 0, notMarked: 0, P: 0, A: 0, L: 0, C: 0, percentage: null },
      };
    }

    // D / E — submitted behaviour and active achievements of this year (Phase 9).
    const behaviour = (await this.behaviour.forStudent(ctx, studentId)).assessments.filter(
      (a) => a.academicYear.id === year.id && a.status === 'SUBMITTED',
    );
    const achievements = (
      await this.achievements.list(ctx, {
        academicYearId: year.id,
        studentId,
        status: 'ACTIVE',
        page: 1,
        pageSize: 100,
      })
    ).items.sort((a, b) => a.achievedOn.localeCompare(b.achievedOn));

    const annualPct = bp === null ? null : bp / 100;
    return {
      school,
      academicYear: {
        id: year.id,
        label: year.label,
        status: year.status,
        startDate: year.startDate,
        endDate: year.endDate,
      },
      student: {
        id: student.id,
        fullName: student.fullName,
        admissionNumber: student.admissionNumber,
        rollNumber,
      },
      section,
      exams,
      annual: {
        weightageTotalPercent: fromBp(totalBp),
        contributions,
        percentage: annualPct,
      },
      attendance,
      behaviour,
      achievements,
      suggestedRemark: suggestRemark(
        student.fullName,
        annualPct,
        contributions.length,
        attendance.counts.percentage,
        achievements.length,
        behaviour.length,
      ),
      finalRemark,
      problems,
    };
  }

  private toView(
    p: Principal,
    record: AnnualReportRecord | null,
    content: AnnualReportContent,
  ): AnnualReportView {
    const admin = this.isAdmin(p);
    const staff = !p.studentId;
    const generate = staff && p.permissions.has('reports.generate');
    const status = record?.status ?? 'NONE';
    return {
      id: record?.id ?? null,
      status,
      revision: record?.revision ?? null,
      content: p.studentId ? { ...content, suggestedRemark: '', problems: [] } : content,
      frozen: status === 'FINALIZED' || status === 'PUBLISHED',
      finalized: record?.finalizedAt
        ? { at: record.finalizedAt, by: record.finalizedByName }
        : null,
      published: record?.publishedAt
        ? { at: record.publishedAt, by: record.publishedByName }
        : null,
      fileName: reportFileName(
        content.school.shortName,
        content.academicYear.label,
        'AnnualReport',
        [content.student.admissionNumber],
        'pdf',
      ),
      actions: {
        prepare: generate && status === 'NONE',
        editRemark: generate && status === 'DRAFT',
        finalize: generate && status === 'DRAFT' && content.problems.length === 0,
        publish: admin && status === 'FINALIZED',
        unpublish: admin && status === 'PUBLISHED',
        reopen: admin && status === 'FINALIZED',
      },
    };
  }

  private frozen(record: AnnualReportRecord): AnnualReportContent {
    return AnnualReportContentSchema.parse(JSON.parse(record.snapshotJson!));
  }

  // ---- Reading --------------------------------------------------------------------------------

  /** A section's students for a year with the state of each one's annual report. */
  async list(ctx: RequestContext, yearId: string, sectionId: string): Promise<AnnualReportList> {
    const p = this.authorize(ctx, 'reports.generate');
    const repos = this.repos;
    const year = await this.year(repos, yearId);
    if (!this.canStaff(p, year.id, sectionId)) throw new ForbiddenError(NO_ACCESS);
    const section = await repos.classes.findSection(sectionId);
    if (!section) throw new NotFoundError('That class section was not found.');
    const cls = await repos.classes.findClass(section.classId);
    const placements = await repos.attendance.placementsInSection(
      year.id,
      sectionId,
      year.startDate,
      year.endDate,
    );
    const latest = new Map<string, (typeof placements)[number]>();
    for (const pl of placements) {
      const prev = latest.get(pl.studentId);
      if (!prev || pl.startedOn > prev.startedOn) latest.set(pl.studentId, pl);
    }
    const reports = new Map(
      (await repos.annualReports.listForSection(year.id, sectionId)).map((r) => [r.studentId, r]),
    );
    const students = [...latest.values()]
      .sort(
        (a, b) =>
          (a.rollNumber ?? '').localeCompare(b.rollNumber ?? '', undefined, { numeric: true }) ||
          a.fullName.localeCompare(b.fullName),
      )
      .map((pl) => {
        const r = reports.get(pl.studentId) ?? null;
        return {
          student: {
            id: pl.studentId,
            fullName: pl.fullName,
            admissionNumber: pl.admissionNumber,
            rollNumber: pl.rollNumber,
          },
          reportId: r?.id ?? null,
          status: r?.status ?? ('NONE' as const),
          updatedAt: r?.updatedAt ?? null,
        };
      });
    return {
      academicYear: { id: year.id, label: year.label, status: year.status },
      section: {
        sectionId,
        sectionName: section.name,
        classId: section.classId,
        className: cls?.name ?? '',
      },
      students,
    };
  }

  /**
   * One annual report: staff — the draft (live) or the frozen content; students — their own, and
   * only once PUBLISHED. `format=pdf` renders the same content.
   */
  async view(
    ctx: RequestContext,
    q: z.output<typeof AnnualReportQuerySchema>,
  ): Promise<AnnualReportView | FileResponse> {
    const p = this.authorize(ctx, 'reports.view');
    const repos = this.repos;
    let view: AnnualReportView;
    if (p.studentId) {
      if (q.studentId && q.studentId !== p.studentId) throw new ForbiddenError(NO_ACCESS);
      const year = await this.year(repos, q.academicYearId);
      const record = await repos.annualReports.findFor(year.id, p.studentId);
      if (!record || record.status !== 'PUBLISHED') {
        throw new NotFoundError(`Your annual report for ${year.label} has not been published yet.`);
      }
      view = this.toView(p, record, this.frozen(record));
    } else {
      if (!q.studentId) throw fieldConflict('studentId', 'Choose a student.');
      const { year, placement, record } = await this.subject(p, q.academicYearId, q.studentId);
      if (record && record.status !== 'DRAFT') {
        view = this.toView(p, record, this.frozen(record));
      } else {
        const section = await this.sectionOf(repos, record?.sectionId ?? placement!.sectionId);
        const roll = record
          ? ((await repos.enrolments.find(record.enrolmentId))?.rollNumber ?? null)
          : (placement?.rollNumber ?? null);
        const content = await this.build(
          ctx,
          year,
          q.studentId,
          section,
          roll,
          record?.finalRemark ?? null,
        );
        view = this.toView(p, record, content);
      }
    }
    if (q.format === 'json') return view;
    if (q.format !== 'pdf') throw fieldConflict('format', 'Annual reports are available as PDF.');
    const { withLogo } = await reportSchool(repos);
    const pdf = await annualReportPdf(
      view.content,
      { status: view.status, generatedAt: this.deps.clock.now().toISOString() },
      withLogo,
    );
    return new FileResponse(pdf, PDF, view.fileName);
  }

  private async sectionOf(repos: Repositories, sectionId: string) {
    const section = (await repos.classes.findSection(sectionId))!;
    const cls = await repos.classes.findClass(section.classId);
    return {
      sectionId,
      sectionName: section.name,
      classId: section.classId,
      className: cls?.name ?? '',
    };
  }

  /** The signed-in student's published annual reports. */
  async mine(ctx: RequestContext): Promise<MyAnnualReports> {
    const p = this.authorize(ctx, 'reports.view');
    if (!p.studentId) throw new ForbiddenError('Only students have their own annual reports.');
    const repos = this.repos;
    const items: MyAnnualReports['items'] = [];
    for (const r of await repos.annualReports.listPublishedForStudent(p.studentId)) {
      const content = this.frozen(r);
      items.push({
        id: r.id,
        academicYear: {
          id: content.academicYear.id,
          label: content.academicYear.label,
          status: content.academicYear.status,
        },
        publishedAt: r.publishedAt!,
        fileName: this.toView(p, r, content).fileName,
      });
    }
    return { items };
  }

  // ---- Lifecycle ------------------------------------------------------------------------------

  private async afterWrite(
    ctx: RequestContext,
    record: { academicYearId: string; studentId: string },
  ) {
    return (await this.view(ctx, {
      academicYearId: record.academicYearId,
      studentId: record.studentId,
      format: 'json',
    })) as AnnualReportView;
  }

  async prepare(ctx: RequestContext, yearId: string, studentId: string): Promise<AnnualReportView> {
    const p = this.authorize(ctx, 'reports.generate');
    const { year, placement, record } = await this.subject(p, yearId, studentId);
    if (record)
      throw new ConflictError('An annual report for this student and year already exists.');
    if (!placement)
      throw new ConflictError(`This student was not placed in a class in ${year.label}.`);
    await this.write(ctx, 'reports.generate', async ({ repos, actor, now, audit }) => {
      const id = newId();
      await repos.annualReports.create(
        {
          id,
          academicYearId: year.id,
          studentId,
          enrolmentId: placement.enrolmentId,
          sectionId: placement.sectionId,
          createdBy: actor.userId,
        },
        now,
      );
      await audit({
        action: 'annual_report.prepared',
        entityType: 'annual_report',
        entityId: id,
        after: {
          academicYearId: year.id,
          studentId,
          sectionId: placement.sectionId,
          status: 'DRAFT',
        },
      });
    });
    return this.afterWrite(ctx, { academicYearId: year.id, studentId });
  }

  /** The record, checked against the caller's scope (same refusal if missing). */
  private async record(p: Principal, id: string) {
    const r = await this.repos.annualReports.find(id);
    if (!r || !this.canStaff(p, r.academicYearId, r.sectionId)) {
      if (!r && this.isAdmin(p)) throw new NotFoundError('That annual report was not found.');
      throw new ForbiddenError(NO_ACCESS);
    }
    return r;
  }

  async setRemark(
    ctx: RequestContext,
    id: string,
    input: z.output<typeof AnnualReportRemarkSchema>,
  ): Promise<AnnualReportView> {
    const p = this.authorize(ctx, 'reports.generate');
    const r = await this.record(p, id);
    await this.write(ctx, 'reports.generate', async ({ repos, actor, now, audit }) => {
      if (r.status !== 'DRAFT') {
        throw new ConflictError('The remark is frozen once the report is finalized.');
      }
      if (
        !(await repos.annualReports.update(
          id,
          input.revision,
          { finalRemark: input.remark },
          actor.userId,
          now,
        ))
      ) {
        throw new ConflictError(STALE);
      }
      await audit({
        action: 'annual_report.remark_changed',
        entityType: 'annual_report',
        entityId: id,
        before: { finalRemark: r.finalRemark },
        after: { finalRemark: input.remark },
      });
    });
    return this.afterWrite(ctx, r);
  }

  /** Freezes the content computed now (incl. the final remark) — the official report. */
  async finalize(ctx: RequestContext, id: string, revision: number): Promise<AnnualReportView> {
    const p = this.authorize(ctx, 'reports.generate');
    const r = await this.record(p, id);
    if (r.status !== 'DRAFT') throw new ConflictError('Only a draft can be finalized.');
    if (!r.finalRemark) {
      throw fieldConflict('remark', "Write the class teacher's final remark before finalizing.");
    }
    const year = await this.year(this.repos, r.academicYearId);
    const section = await this.sectionOf(this.repos, r.sectionId);
    const roll = (await this.repos.enrolments.find(r.enrolmentId))?.rollNumber ?? null;
    const content = await this.build(ctx, year, r.studentId, section, roll, r.finalRemark);
    if (content.problems.length > 0) {
      throw new ConflictError(
        `This annual report cannot be finalized yet: ${content.problems.join(' ')}`,
      );
    }
    await this.write(ctx, 'reports.generate', async ({ repos, actor, now, audit }) => {
      const ok = await repos.annualReports.update(
        id,
        revision,
        {
          status: 'FINALIZED',
          snapshotJson: JSON.stringify(content),
          finalizedAt: now,
          finalizedBy: actor.userId,
        },
        actor.userId,
        now,
      );
      if (!ok) throw new ConflictError(STALE);
      await audit({
        action: 'annual_report.finalized',
        entityType: 'annual_report',
        entityId: id,
        before: { status: 'DRAFT' },
        after: {
          status: 'FINALIZED',
          annualPercentage: content.annual.percentage,
          weightageTotalPercent: content.annual.weightageTotalPercent,
          contributions: content.annual.contributions,
          attendance: content.attendance.counts,
          finalRemark: content.finalRemark,
        },
      });
    });
    return this.afterWrite(ctx, r);
  }

  private async adminStep(
    ctx: RequestContext,
    id: string,
    revision: number,
    step: 'publish' | 'unpublish' | 'reopen',
    reason: string | null,
  ): Promise<AnnualReportView> {
    const p = this.authorize(ctx, 'reports.generate');
    const r = await this.record(p, id);
    if (!this.isAdmin(p))
      throw new ForbiddenError('Only administrators publish or reopen annual reports.');
    const from = { publish: 'FINALIZED', unpublish: 'PUBLISHED', reopen: 'FINALIZED' } as const;
    if (r.status !== from[step]) {
      throw new ConflictError(
        step === 'publish'
          ? 'Only a finalized report can be published.'
          : step === 'unpublish'
            ? 'Only a published report can be unpublished.'
            : 'Only a finalized (unpublished) report can be reopened; unpublish it first.',
      );
    }
    await this.write(ctx, 'reports.generate', async ({ repos, actor, now, audit }) => {
      const change =
        step === 'publish'
          ? { status: 'PUBLISHED' as const, publishedAt: now, publishedBy: actor.userId }
          : step === 'unpublish'
            ? { status: 'FINALIZED' as const, publishedAt: null, publishedBy: null }
            : {
                status: 'DRAFT' as const,
                snapshotJson: null,
                finalizedAt: null,
                finalizedBy: null,
              };
      if (!(await repos.annualReports.update(id, revision, change, actor.userId, now))) {
        throw new ConflictError(STALE);
      }
      await audit({
        action: `annual_report.${step === 'publish' ? 'published' : step === 'unpublish' ? 'unpublished' : 'reopened'}`,
        entityType: 'annual_report',
        entityId: id,
        before: { status: r.status },
        after: { status: change.status },
        reason,
      });
    });
    return this.afterWrite(ctx, r);
  }

  publish(ctx: RequestContext, id: string, revision: number) {
    return this.adminStep(ctx, id, revision, 'publish', null);
  }
  unpublish(ctx: RequestContext, id: string, revision: number) {
    return this.adminStep(ctx, id, revision, 'unpublish', null);
  }
  reopen(ctx: RequestContext, id: string, input: z.output<typeof AnnualReportReopenSchema>) {
    return this.adminStep(ctx, id, input.revision, 'reopen', input.reason);
  }
}

/**
 * A deterministic, factual suggestion (D-106) — never presented as the teacher's remark and never
 * printed on an official report. No judgement bands are invented.
 */
export function suggestRemark(
  name: string,
  annualPercent: number | null,
  weightedExams: number,
  attendancePercent: number | null,
  achievements: number,
  assessments: number,
): string {
  const parts = [
    annualPercent !== null
      ? `${name} achieved an annual percentage of ${annualPercent}% across ${weightedExams} weighted exam${weightedExams === 1 ? '' : 's'}.`
      : `${name}'s annual percentage is not available yet.`,
    attendancePercent !== null
      ? `Attendance for the year was ${attendancePercent}%.`
      : 'No attendance has been measured for the year.',
    achievements > 0
      ? `${achievements} achievement${achievements === 1 ? ' was' : 's were'} recorded.`
      : 'No achievements were recorded.',
    assessments > 0
      ? `Behaviour was assessed in ${assessments} exam${assessments === 1 ? '' : 's'}.`
      : 'Behaviour has not been assessed.',
  ];
  return parts.join(' ');
}
