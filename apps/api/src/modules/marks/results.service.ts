import {
  competitionRanks,
  componentsOf,
  fromHundredths,
  summarizeExam,
  totalMaxOf,
  type ClassResultView,
  type ExamSummaryView,
  type ResultExamsView,
  type StudentExamResultView,
  type SubjectResultView,
} from '@ttlmhss/shared';
import type { Principal } from '../../core/auth/access.js';
import { ForbiddenError, NotFoundError } from '../../core/errors/app-errors.js';
import type { Repositories } from '../../data/data-store.js';
import { placementOn } from '../attendance/attendance-service.js';
import type { ExamRecord, ExamSubjectRecord } from '../config/config.repository.js';
import { sectionRef } from '../timetable/timetable-service.js';
import { examRef } from './mark-sheet.service.js';
import { MarksServiceBase, rawOf, rosterDate, type RequestContext } from './marks-context.js';
import type { MarkEntryRecord, MarkSheetRecord } from './marks.repository.js';

const NO_RESULT = 'That result is not available.';
const NO_CLASS_ACCESS = 'You do not have access to the results of this class.';

/** A subject finalised for one student: the values stored when its sheet was submitted. */
interface Finalised {
  sheet: MarkSheetRecord;
  entry: MarkEntryRecord;
  finalCm: number;
  finalMax: number;
  passed: boolean;
}

function finalised(sheet: MarkSheetRecord | undefined, entry: MarkEntryRecord | undefined) {
  // BR-RESULT-01: only SUBMITTED sheets count — drafts and sheets unlocked for correction do not.
  if (!sheet || sheet.status !== 'SUBMITTED' || !sheet.calculation) return null;
  if (!entry || entry.totalCm === null || entry.passed === null) return null;
  const calc = sheet.calculation;
  return {
    sheet,
    entry,
    finalCm: entry.normalizedCm ?? entry.totalCm,
    finalMax: calc.normalizedMax ?? totalMaxOf(calc),
    passed: entry.passed,
  } satisfies Finalised;
}

interface Population {
  /** Counting subjects of the class (BR-RESULT-03 "required"). */
  required: ExamSubjectRecord[];
  all: ExamSubjectRecord[];
  sheets: MarkSheetRecord[];
  entries: MarkEntryRecord[];
  /** Students with a complete result in the rank population, with their totals. */
  complete: Map<
    string,
    { sectionId: string; totalCm: number; maxMarks: number; percentBp: number; passed: boolean }
  >;
  ranks: Map<string, number>;
}

/**
 * Who is ranked (BR-RESULT-05, D-73): students of the same academic year, exam and class/section
 * (or the whole class when the exam's Phase 4 rank scope is CLASS) whose every counting subject is
 * submitted in their section. Standard competition ranking on the total.
 */
async function population(
  repos: Repositories,
  exam: ExamRecord,
  classId: string,
  sectionIds: string[],
): Promise<Population> {
  const all = await repos.exams.listSubjects(exam.id, classId);
  const required = all.filter((s) => s.includeInResult);
  const sheets = (await repos.marks.sheetsForExam(exam.id)).filter(
    (s) => s.classId === classId && sectionIds.includes(s.sectionId),
  );
  const entries = await repos.marks.entriesForSheets(sheets.map((s) => s.id));
  const sheetOf = new Map(sheets.map((s) => [`${s.examSubjectId}:${s.sectionId}`, s]));
  const entryOf = new Map(entries.map((e) => [`${e.markSheetId}:${e.studentId}`, e]));
  const complete: Population['complete'] = new Map();
  if (required.length > 0) {
    const candidates = new Map(entries.map((e) => [e.studentId, e.sectionId]));
    for (const [studentId, sectionId] of candidates) {
      const parts: Finalised[] = [];
      for (const es of required) {
        const sheet = sheetOf.get(`${es.id}:${sectionId}`);
        const f = finalised(sheet, sheet ? entryOf.get(`${sheet.id}:${studentId}`) : undefined);
        if (!f) break;
        parts.push(f);
      }
      if (parts.length !== required.length) continue;
      const summary = summarizeExam(parts)!;
      complete.set(studentId, {
        sectionId,
        totalCm: summary.totalCm,
        maxMarks: summary.maxMarks,
        percentBp: summary.percentBp,
        passed: summary.passed,
      });
    }
  }
  const ranks = competitionRanks([...complete].map(([key, v]) => ({ key, totalCm: v.totalCm })));
  return { required, all, sheets, entries, complete, ranks };
}

function summaryView(pop: Population, studentId: string, exam: ExamRecord): ExamSummaryView | null {
  const c = pop.complete.get(studentId);
  if (!c) return null;
  return {
    total: fromHundredths(c.totalCm),
    max: c.maxMarks,
    percentage: c.percentBp / 100,
    result: c.passed ? 'PASS' : 'FAIL',
    rank: pop.ranks.get(studentId) ?? null,
    rankedOf: pop.complete.size,
    rankScope: exam.rankScope,
  };
}

/**
 * Results (Phase 8B). Students see only their own results, and only subjects whose sheet is
 * SUBMITTED; staff see a class's results within scope (administrator: all; class teacher: own
 * section in that year). Results always use the placement the student had for that exam — never
 * the current class.
 */
export class ResultsService extends MarksServiceBase {
  // ---- Students -------------------------------------------------------------------------------

  async myExams(ctx: RequestContext, academicYearId?: string): Promise<ResultExamsView> {
    const p = this.authorize(ctx, 'results.view');
    if (!p.studentId) throw new ForbiddenError('Only students have personal results.');
    const placements = await this.repos.enrolments.listForStudent(p.studentId);
    const years = new Map<string, ResultExamsView['years'][number]>();
    for (const pl of placements) {
      const y = await this.repos.academicYears.find(pl.academicYearId);
      if (y) years.set(y.id, { id: y.id, label: y.label, status: y.status });
    }
    const list = [...years.values()];
    const year =
      list.find((y) => y.id === academicYearId) ??
      list.find((y) => y.status === 'CURRENT') ??
      list[0] ??
      null;
    const exams = year ? await this.visibleExams(year.id) : [];
    return {
      years: list,
      academicYearId: year?.id ?? null,
      exams: exams.map(examRef),
      sections: [],
    };
  }

  private async visibleExams(yearId: string) {
    return (await this.repos.exams.listByYear(yearId)).filter(
      (e) => e.status === 'ACTIVE' && e.stage !== 'DRAFT',
    );
  }

  async myResult(ctx: RequestContext, examId: string): Promise<StudentExamResultView> {
    const p = this.authorize(ctx, 'results.view');
    if (!p.studentId) throw new ForbiddenError('Only students have personal results.');
    return this.studentResult(this.repos, p.studentId, examId, () => true);
  }

  /** A student's result for staff: administrator, or the class teacher of the student's section. */
  async studentResultFor(
    ctx: RequestContext,
    examId: string,
    studentId: string,
  ): Promise<StudentExamResultView> {
    const p = this.authorize(ctx, 'results.view');
    if (p.studentId) {
      // A student account only ever reaches its own result, whatever id is sent.
      if (p.studentId !== studentId) throw new ForbiddenError(NO_RESULT);
      return this.studentResult(this.repos, studentId, examId, () => true);
    }
    const admin = this.isAdmin(p);
    try {
      return await this.studentResult(
        this.repos,
        studentId,
        examId,
        (yearId, sectionId) => admin || this.isClassTeacher(p, yearId, sectionId),
      );
    } catch (error) {
      if (!admin && error instanceof NotFoundError) throw new ForbiddenError(NO_RESULT);
      throw error;
    }
  }

  private isClassTeacher(p: Principal, yearId: string, sectionId: string) {
    return p.classTeacherOf.some((s) => s.academicYearId === yearId && s.sectionId === sectionId);
  }

  private async studentResult(
    repos: Repositories,
    studentId: string,
    examId: string,
    allowed: (yearId: string, sectionId: string) => boolean,
  ): Promise<StudentExamResultView> {
    const exam = await repos.exams.find(examId);
    if (!exam || exam.status !== 'ACTIVE' || exam.stage === 'DRAFT')
      throw new NotFoundError(NO_RESULT);
    const student = await repos.students.find(studentId);
    if (!student) throw new NotFoundError(NO_RESULT);
    const year = (await repos.academicYears.find(exam.academicYearId))!;

    // The placement for THIS exam: where the student has marks in it, else where they were placed
    // on the exam's roster date (D-76). Never today's class.
    const own = await repos.marks.entriesForStudent(studentId);
    const examSheets = await repos.marks.sheetsForExam(exam.id);
    const examSheetIds = new Set(examSheets.map((s) => s.id));
    const mine = own.filter((e) => examSheetIds.has(e.markSheetId));
    let sectionId = mine[0]?.sectionId ?? null;
    let enrolmentId = mine[0]?.enrolmentId ?? null;
    if (!sectionId) {
      const date = rosterDate(exam, year, this.today());
      const placements = await repos.attendance.placementsOfStudents(
        [studentId],
        year.id,
        date,
        date,
      );
      const placed = placementOn(placements, studentId, date);
      sectionId = placed?.sectionId ?? null;
      enrolmentId = placed?.enrolmentId ?? null;
    }
    if (!sectionId) throw new NotFoundError(NO_RESULT);
    if (!allowed(year.id, sectionId)) throw new ForbiddenError(NO_RESULT);
    const section = await sectionRef(repos, sectionId);
    const placement = enrolmentId ? await repos.enrolments.find(enrolmentId) : null;

    const scopeSections =
      exam.rankScope === 'CLASS'
        ? (await repos.classes.listSections())
            .filter((s) => s.classId === section.classId)
            .map((s) => s.id)
        : [sectionId];
    const pop = await population(repos, exam, section.classId, scopeSections);
    const subjects = await this.subjectNames(repos);
    const sheetOf = new Map(pop.sheets.map((s) => [`${s.examSubjectId}:${s.sectionId}`, s]));
    const entryOf = new Map(pop.entries.map((e) => [`${e.markSheetId}:${e.studentId}`, e]));

    const rows: SubjectResultView[] = [...pop.all]
      .sort((a, b) => (subjects.get(a.subjectId)?.i ?? 0) - (subjects.get(b.subjectId)?.i ?? 0))
      .map((es) => {
        const sheet = sheetOf.get(`${es.id}:${sectionId}`);
        const f = finalised(sheet, sheet ? entryOf.get(`${sheet.id}:${studentId}`) : undefined);
        const totalMax = totalMaxOf(f?.sheet.calculation ?? es);
        const normalizedMax = (f?.sheet.calculation ?? es).normalizedMax;
        const base = {
          subjectId: es.subjectId,
          subjectName: subjects.get(es.subjectId)?.name ?? '',
          countsInResult: es.includeInResult,
          totalMax,
          normalizedMax,
          finalMax: normalizedMax ?? totalMax,
        };
        if (!f) {
          return {
            ...base,
            available: false,
            components: null,
            obtained: null,
            normalized: null,
            final: null,
            percent: null,
            grade: null,
            result: null,
          };
        }
        const raw = rawOf(f.entry);
        return {
          ...base,
          countsInResult: f.sheet.calculation!.includeInResult,
          available: true,
          components: componentsOf(f.sheet.calculation!).map((c) => ({
            ...c,
            obtained: fromHundredths(raw[c.key] ?? 0),
          })),
          obtained: fromHundredths(f.entry.totalCm!),
          normalized: f.entry.normalizedCm === null ? null : fromHundredths(f.entry.normalizedCm),
          final: fromHundredths(f.finalCm),
          percent: f.entry.percentBp === null ? null : f.entry.percentBp / 100,
          grade: f.entry.grade,
          result: f.passed ? 'PASS' : 'FAIL',
        };
      });
    const requiredRows = rows.filter((r) => r.countsInResult);
    const summary = summaryView(pop, studentId, exam);
    return {
      academicYear: { id: year.id, label: year.label, status: year.status },
      exam: examRef(exam),
      student: {
        id: student.id,
        fullName: student.fullName,
        admissionNumber: student.admissionNumber,
        rollNumber: placement?.rollNumber ?? null,
      },
      section: {
        sectionId: section.sectionId,
        sectionName: section.sectionName,
        classId: section.classId,
        className: section.className,
      },
      subjects: rows,
      complete: summary !== null,
      availableCount: rows.filter((r) => r.available).length,
      requiredCount: requiredRows.length,
      summary,
    };
  }

  private async subjectNames(repos: Repositories) {
    return new Map((await repos.subjects.list()).map((s, i) => [s.id, { name: s.name, i }]));
  }

  // ---- Staff ----------------------------------------------------------------------------------

  /** Years, exams and the sections whose class results this user may open. */
  async options(ctx: RequestContext, academicYearId?: string): Promise<ResultExamsView> {
    const p = this.authorize(ctx, 'results.view');
    if (p.studentId) throw new ForbiddenError('Students see their own results under My results.');
    const repos = this.repos;
    const years = (await repos.academicYears.list()).map((y) => ({
      id: y.id,
      label: y.label,
      status: y.status,
    }));
    const year =
      years.find((y) => y.id === academicYearId) ??
      years.find((y) => y.status === 'CURRENT') ??
      years[0] ??
      null;
    if (!year) return { years, academicYearId: null, exams: [], sections: [] };
    const admin = this.isAdmin(p);
    const own = new Set(
      p.classTeacherOf.filter((s) => s.academicYearId === year.id).map((s) => s.sectionId),
    );
    const [classes, sections] = await Promise.all([
      repos.classes.listClasses(),
      repos.classes.listSections(),
    ]);
    const classOf = new Map(classes.map((c) => [c.id, c]));
    const visible = sections
      .filter((s) => (admin ? s.status === 'ACTIVE' : own.has(s.id)))
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
      }));
    return {
      years,
      academicYearId: year.id,
      exams: (await this.visibleExams(year.id)).map(examRef),
      sections: visible,
    };
  }

  /** A class/section's results: administrator, or its class teacher in the exam's year. */
  async classResult(
    ctx: RequestContext,
    examId: string,
    sectionId: string,
  ): Promise<ClassResultView> {
    const p = this.authorize(ctx, 'results.view');
    const repos = this.repos;
    const admin = this.isAdmin(p);
    const exam = await repos.exams.find(examId);
    const sectionRecord = await repos.classes.findSection(sectionId);
    if (!exam || !sectionRecord) {
      if (admin) throw new NotFoundError('That exam or class was not found.');
      throw new ForbiddenError(NO_CLASS_ACCESS);
    }
    if (!admin && !this.isClassTeacher(p, exam.academicYearId, sectionId))
      throw new ForbiddenError(NO_CLASS_ACCESS);
    const year = (await repos.academicYears.find(exam.academicYearId))!;
    const section = await sectionRef(repos, sectionId);
    const scopeSections =
      exam.rankScope === 'CLASS'
        ? (await repos.classes.listSections())
            .filter((s) => s.classId === section.classId)
            .map((s) => s.id)
        : [sectionId];
    const pop = await population(repos, exam, section.classId, scopeSections);
    const subjects = await this.subjectNames(repos);
    const ordered = [...pop.all].sort(
      (a, b) => (subjects.get(a.subjectId)?.i ?? 0) - (subjects.get(b.subjectId)?.i ?? 0),
    );
    const sheetOf = new Map(pop.sheets.map((s) => [`${s.examSubjectId}:${s.sectionId}`, s]));
    const entryOf = new Map(pop.entries.map((e) => [`${e.markSheetId}:${e.studentId}`, e]));

    // Students: placed in the section on the roster date, plus anyone with marks in it.
    const date = rosterDate(exam, year, this.today());
    const listed = new Map<string, { rollNumber: string | null }>();
    const placements = await repos.attendance.placementsInSection(year.id, sectionId, date, date);
    const everyPlacement = await repos.attendance.placementsOfStudents(
      [...new Set(placements.map((x) => x.studentId))],
      year.id,
      date,
      date,
    );
    for (const pl of placements) {
      const on = placementOn(everyPlacement, pl.studentId, date);
      if (on && on.sectionId === sectionId) listed.set(pl.studentId, { rollNumber: on.rollNumber });
    }
    for (const e of pop.entries.filter((x) => x.sectionId === sectionId)) {
      if (!listed.has(e.studentId)) {
        listed.set(e.studentId, {
          rollNumber: (await repos.enrolments.find(e.enrolmentId))?.rollNumber ?? null,
        });
      }
    }
    const students: ClassResultView['students'] = [];
    for (const [studentId, info] of listed) {
      const student = await repos.students.find(studentId);
      if (!student) continue;
      const cells = ordered.map((es) => {
        const sheet = sheetOf.get(`${es.id}:${sectionId}`);
        const f = finalised(sheet, sheet ? entryOf.get(`${sheet.id}:${studentId}`) : undefined);
        return {
          subjectId: es.subjectId,
          final: f ? fromHundredths(f.finalCm) : null,
          grade: f?.entry.grade ?? null,
          result: f ? (f.passed ? ('PASS' as const) : ('FAIL' as const)) : null,
        };
      });
      const summary = summaryView(pop, studentId, exam);
      students.push({
        studentId,
        rollNumber: info.rollNumber,
        admissionNumber: student.admissionNumber,
        fullName: student.fullName,
        cells,
        complete: summary !== null,
        summary,
      });
    }
    students.sort((a, b) => {
      if (a.rollNumber && b.rollNumber && a.rollNumber !== b.rollNumber)
        return a.rollNumber.localeCompare(b.rollNumber, undefined, { numeric: true });
      if (a.rollNumber && !b.rollNumber) return -1;
      if (!a.rollNumber && b.rollNumber) return 1;
      return a.fullName.localeCompare(b.fullName);
    });
    return {
      academicYear: { id: year.id, label: year.label, status: year.status },
      exam: examRef(exam),
      section: {
        sectionId: section.sectionId,
        sectionName: section.sectionName,
        classId: section.classId,
        className: section.className,
      },
      rankScope: exam.rankScope,
      subjects: ordered.map((es) => {
        const sheet = sheetOf.get(`${es.id}:${sectionId}`);
        const calc = (sheet?.status === 'SUBMITTED' && sheet.calculation) || es;
        return {
          subjectId: es.subjectId,
          subjectName: subjects.get(es.subjectId)?.name ?? '',
          countsInResult: es.includeInResult,
          finalMax: calc.normalizedMax ?? totalMaxOf(calc),
          status: sheet?.status ?? null,
        };
      }),
      students,
      rankedOf: pop.complete.size,
    };
  }
}
