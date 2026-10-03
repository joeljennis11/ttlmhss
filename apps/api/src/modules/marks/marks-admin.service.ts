import {
  EXAM_STAGE_LABELS,
  type ExamMarksMatrixView,
  type ExamMatrixRow,
  type ExamStage,
  type SheetTeacherInput,
} from '@ttlmhss/shared';
import { ConflictError, NotFoundError, fieldConflict } from '../../core/errors/app-errors.js';
import { newId } from '../../core/utils/clock.js';
import type { Repositories } from '../../data/data-store.js';
import { CalendarResolver } from '../calendar/calendar-resolver.js';
import { enteredCount, examRef } from './mark-sheet.service.js';
import {
  MarksServiceBase,
  describeSheet,
  loadSheetContext,
  structureOf,
  structureView,
  type RequestContext,
} from './marks-context.js';

const ALLOWED: Record<ExamStage, ExamStage[]> = {
  DRAFT: ['OPEN'],
  OPEN: ['CLOSED', 'DRAFT'],
  CLOSED: ['OPEN', 'DRAFT'],
};

/**
 * Administrator side of exams (Phase 8B, `exams.manage`): the exam's marks lifecycle, the
 * exam × class × section × subject matrix, and who may enter each sheet's marks. The marking
 * settings themselves stay on the Phase 4 exam configuration (config.manage) — not duplicated.
 */
export class MarksAdminService extends MarksServiceBase {
  async matrix(ctx: RequestContext, examId: string): Promise<ExamMarksMatrixView> {
    this.authorize(ctx, 'exams.manage');
    return this.buildMatrix(this.repos, examId);
  }

  private async buildMatrix(repos: Repositories, examId: string): Promise<ExamMarksMatrixView> {
    const exam = await repos.exams.find(examId);
    if (!exam) throw new NotFoundError('That exam was not found.');
    const year = (await repos.academicYears.find(exam.academicYearId))!;
    const [examSubjects, sheets, classes, sections, subjects, teachers] = await Promise.all([
      repos.exams.listAllSubjects(examId),
      repos.marks.sheetsForExam(examId),
      repos.classes.listClasses(),
      repos.classes.listSections(),
      repos.subjects.list(),
      repos.teachers.list({
        q: null,
        subjectId: null,
        status: 'ALL',
        designation: null,
        offset: 0,
        limit: 10_000,
      }),
    ]);
    const entries = await repos.marks.entriesForSheets(sheets.map((s) => s.id));
    const teacherById = new Map(teachers.rows.map((t) => [t.id, t]));
    const subjectsOf = await repos.teacherSubjects.forTeachers(teachers.rows.map((t) => t.id));
    const teachersBySubject: ExamMarksMatrixView['teachersBySubject'] = {};
    for (const t of teachers.rows) {
      if (t.status !== 'ACTIVE') continue;
      for (const s of subjectsOf.get(t.id) ?? []) {
        (teachersBySubject[s.id] ??= []).push({
          id: t.id,
          fullName: t.fullName,
          staffCode: t.staffCode,
        });
      }
    }
    const classInfo = new Map(classes.map((c) => [c.id, c]));
    const subjectInfo = new Map(subjects.map((s, i) => [s.id, { ...s, i }]));
    const sheetByKey = new Map(sheets.map((s) => [`${s.examSubjectId}:${s.sectionId}`, s]));

    const rows: ExamMatrixRow[] = [];
    for (const es of examSubjects) {
      const live = await structureOf(repos, exam, es);
      for (const section of sections.filter((s) => s.classId === es.classId)) {
        const sheet = sheetByKey.get(`${es.id}:${section.id}`) ?? null;
        if (!sheet && section.status !== 'ACTIVE') continue;
        const structure = (sheet?.status === 'SUBMITTED' && sheet.calculation) || live;
        const teacher = sheet?.entryTeacherId ? teacherById.get(sheet.entryTeacherId) : undefined;
        let teacherProblem: string | null = null;
        if (teacher) {
          if (teacher.status !== 'ACTIVE') teacherProblem = `${teacher.fullName} is inactive.`;
          else if (!(subjectsOf.get(teacher.id) ?? []).some((s) => s.id === es.subjectId))
            teacherProblem = `${teacher.fullName} no longer teaches ${subjectInfo.get(es.subjectId)?.name ?? 'this subject'}.`;
        }
        rows.push({
          examSubjectId: es.id,
          classId: es.classId,
          className: classInfo.get(es.classId)?.name ?? '',
          sectionId: section.id,
          sectionName: section.name,
          subjectId: es.subjectId,
          subjectName: subjectInfo.get(es.subjectId)?.name ?? '',
          structure: structureView(structure),
          teacher: teacher
            ? { id: teacher.id, fullName: teacher.fullName, staffCode: teacher.staffCode }
            : null,
          teacherProblem,
          status: sheet?.status ?? null,
          entered: sheet ? enteredCount(entries, sheet.id, structure) : 0,
        });
      }
    }
    rows.sort(
      (a, b) =>
        (classInfo.get(a.classId)?.displayOrder ?? 0) -
          (classInfo.get(b.classId)?.displayOrder ?? 0) ||
        a.sectionName.localeCompare(b.sectionName) ||
        (subjectInfo.get(a.subjectId)?.i ?? 0) - (subjectInfo.get(b.subjectId)?.i ?? 0),
    );

    // Exam dates are independent of the academic calendar (D-77): a reminder, never a block.
    const calendar = await CalendarResolver.load(repos, year);
    const calendarNotes = [...new Set([exam.startDate, exam.endDate])]
      .filter((d): d is string => d !== null && !calendar.workingForAnyone(d))
      .map(
        (d) =>
          `${d} is not a working day for any class in the academic calendar. Exam dates are not changed by the calendar — check the date is intended.`,
      );

    return {
      exam: { ...examRef(exam), description: exam.description },
      academicYear: { id: year.id, label: year.label, status: year.status },
      rows,
      teachersBySubject,
      calendarNotes,
      counts: {
        sheets: rows.length,
        submitted: rows.filter((r) => r.status === 'SUBMITTED').length,
        withoutTeacher: rows.filter((r) => r.teacher === null).length,
      },
    };
  }

  /** DRAFT → OPEN → CLOSED (and back), audited. */
  async setStage(
    ctx: RequestContext,
    examId: string,
    stage: ExamStage,
  ): Promise<ExamMarksMatrixView> {
    return this.write(ctx, 'exams.manage', async ({ repos, now, audit }) => {
      const exam = await repos.exams.find(examId);
      if (!exam) throw new NotFoundError('That exam was not found.');
      if (exam.stage === stage)
        throw fieldConflict(
          'stage',
          `${exam.name} is already ${EXAM_STAGE_LABELS[stage].toLowerCase()}.`,
        );
      if (!ALLOWED[exam.stage].includes(stage)) {
        throw fieldConflict(
          'stage',
          `${exam.name} cannot go from ${EXAM_STAGE_LABELS[exam.stage]} to ${EXAM_STAGE_LABELS[stage]}.`,
        );
      }
      const year = (await repos.academicYears.find(exam.academicYearId))!;
      if (stage === 'OPEN') {
        if (exam.status !== 'ACTIVE')
          throw fieldConflict('stage', 'Make the exam active before opening it for marks.');
        if (year.status === 'CLOSED')
          throw fieldConflict('stage', `${year.label} is closed; its exams cannot be opened.`);
        if ((await repos.exams.countSubjects(examId)) === 0)
          throw fieldConflict(
            'stage',
            'Add the subjects of at least one class before opening the exam.',
          );
      }
      if (stage === 'DRAFT') {
        const sheets = await repos.marks.sheetsForExam(examId);
        const entries = await repos.marks.entriesForSheets(sheets.map((s) => s.id));
        const hasMarks = entries.some(
          (e) => e.theoryCm !== null || e.internalCm !== null || e.practicalCm !== null,
        );
        if (hasMarks || sheets.some((s) => s.status !== 'DRAFT')) {
          throw fieldConflict(
            'stage',
            'Marks have already been entered for this exam, so it cannot go back to draft. Close it instead.',
          );
        }
      }
      await repos.exams.update(examId, { stage }, now);
      await audit({
        action: 'exam.stage_changed',
        entityType: 'exam',
        entityId: examId,
        before: { stage: exam.stage },
        after: { stage, exam: exam.name, academicYear: year.label },
      });
      return this.buildMatrix(repos, examId);
    });
  }

  /**
   * Authorise ONE teacher to enter one exam subject's marks for one section (BR-SEC-01). The
   * teacher must be active and teach the subject (Teacher → Subject); the timetable is not used.
   */
  async setTeacher(
    ctx: RequestContext,
    examSubjectId: string,
    sectionId: string,
    input: SheetTeacherInput,
  ): Promise<ExamMarksMatrixView> {
    return this.write(ctx, 'exams.manage', async (scope) => {
      const { repos, actor, now } = scope;
      const c = await loadSheetContext(repos, examSubjectId, sectionId);
      if (!c) throw new NotFoundError('That exam subject and section were not found.');
      if (c.year.status === 'CLOSED')
        throw new ConflictError(`${c.year.label} is closed; its mark sheets cannot change.`);
      const before = c.sheet?.entryTeacherId
        ? await repos.teachers.find(c.sheet.entryTeacherId)
        : null;
      const teacherId = input.teacherId;
      let teacher = null;
      if (teacherId !== null) {
        teacher = await repos.teachers.find(teacherId);
        if (!teacher) throw fieldConflict('teacherId', 'That teacher was not found.');
        if (teacher.status !== 'ACTIVE')
          throw fieldConflict('teacherId', `${teacher.fullName} is inactive.`);
        if (!(await repos.teacherSubjects.exists(teacherId, c.subject.id))) {
          throw fieldConflict(
            'teacherId',
            `${teacher.fullName} does not teach ${c.subject.name}. Add the subject to the teacher first.`,
          );
        }
        if (c.sheet?.entryTeacherId === teacherId) {
          throw fieldConflict(
            'teacherId',
            `${teacher.fullName} is already authorised for ${c.subject.name} in ${c.section.label}.`,
          );
        }
      } else if (!c.sheet?.entryTeacherId) {
        throw fieldConflict('teacherId', 'No teacher is assigned to this mark sheet.');
      }

      let sheetId: string;
      if (!c.sheet) {
        sheetId = newId();
        await repos.marks.createSheet(
          {
            id: sheetId,
            academicYearId: c.year.id,
            examId: c.exam.id,
            examSubjectId: c.examSubject.id,
            classId: c.section.classId,
            sectionId: c.section.sectionId,
            subjectId: c.subject.id,
            entryTeacherId: teacherId,
            createdBy: actor.userId,
          },
          now,
        );
      } else {
        sheetId = c.sheet.id;
        await repos.marks.updateSheet(sheetId, { entryTeacherId: teacherId }, actor.userId, now);
      }
      await scope.audit({
        action: 'marks.teacher_assigned',
        entityType: 'mark_sheet',
        entityId: sheetId,
        before: { teacherId: before?.id ?? null, teacher: before?.fullName ?? null },
        after: {
          ...describeSheet(c),
          teacherId,
          teacher: teacher?.fullName ?? null,
        },
      });
      return this.buildMatrix(repos, c.exam.id);
    });
  }
}
