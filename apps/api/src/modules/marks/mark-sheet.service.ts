import {
  MARK_COMPONENT_LABELS,
  MARK_SHEET_STATUS_LABELS,
  componentsOf,
  fromHundredths,
  isComplete,
  scoreSubject,
  toHundredths,
  type MarkComponent,
  type MarkHistoryEntry,
  type MarkSheetKey,
  type MarkSheetSave,
  type MarkSheetSubmit,
  type MarkSheetSummary,
  type MarkSheetUnlock,
  type MarkSheetView,
  type MarkStructure,
  type MarksHomeView,
} from '@ttlmhss/shared';
import type { Principal } from '../../core/auth/access.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  fieldConflict,
} from '../../core/errors/app-errors.js';
import { newId } from '../../core/utils/clock.js';
import type { Repositories } from '../../data/data-store.js';
import type { ExamRecord } from '../config/config.repository.js';
import {
  MarksServiceBase,
  NO_SHEET_ACCESS,
  describeSheet,
  loadSheetContext,
  rawOf,
  sheetRow,
  sheetStudents,
  structureOf,
  structureView,
  type RequestContext,
  type SheetContext,
  type WriteScope,
} from './marks-context.js';
import type { MarkEntryRecord, MarkSheetRecord } from './marks.repository.js';

const STALE =
  'These marks were changed by someone else after you opened them. Reload the sheet to see the latest marks, then make your change again.';

interface Access {
  canView: boolean;
  canEdit: boolean;
  canSubmit: boolean;
  canUnlock: boolean;
  /** Why marks cannot change right now (exam/year state, lock), or null. */
  blocked: string | null;
  role: MarkSheetSummary['role'] | null;
  readOnlyReason: string | null;
}

/** Nothing here can change: inactive exam, closed year, exam not open. */
export function blockedReason(exam: ExamRecord, yearStatus: string): string | null {
  if (exam.status !== 'ACTIVE') return 'This exam is inactive; its marks are read-only.';
  if (yearStatus === 'CLOSED') return 'This academic year is closed; its marks are read-only.';
  if (exam.stage === 'DRAFT') return 'This exam is not open for marks yet.';
  if (exam.stage === 'CLOSED') return 'This exam is closed; its marks can no longer change.';
  return null;
}

/**
 * Mark sheets (Phase 8B): who may see and change them, Save draft, Submit (locks), Unlock with a
 * reason, and the sheet's history. Authorisation is decided ONLY from the stored sheet:
 *   - the teacher the administrator assigned to this exam subject + section, who must still teach
 *     the subject (Teacher → Subject) and be active (BR-SEC-01) — the timetable is never consulted
 *     (BR-SEC-02);
 *   - the class teacher of the section (this academic year): views the sheet; with `marks.edit`
 *     unlocks it and corrects an unlocked sheet (never enters a fresh draft for another teacher);
 *   - administrators: everything.
 */
export class MarkSheetService extends MarksServiceBase {
  /** Is the stored entry teacher still allowed (active and teaching the subject)? */
  private async entryTeacherValid(repos: Repositories, teacherId: string, subjectId: string) {
    const teacher = await repos.teachers.find(teacherId);
    return (
      teacher?.status === 'ACTIVE' && (await repos.teacherSubjects.exists(teacherId, subjectId))
    );
  }

  private isClassTeacher(p: Principal, yearId: string, sectionId: string) {
    return p.classTeacherOf.some((s) => s.sectionId === sectionId && s.academicYearId === yearId);
  }

  private async access(repos: Repositories, p: Principal, c: SheetContext): Promise<Access> {
    const admin = this.isAdmin(p);
    const entry =
      !!p.teacherId &&
      c.sheet?.entryTeacherId === p.teacherId &&
      (await this.entryTeacherValid(repos, p.teacherId, c.subject.id));
    const classTeacher = this.isClassTeacher(p, c.year.id, c.section.sectionId);
    const has = (perm: Parameters<typeof p.permissions.has>[0]) => p.permissions.has(perm);
    const canView = admin || (has('marks.view') && (entry || classTeacher));
    const status = c.sheet?.status ?? 'DRAFT';
    const blocked = blockedReason(c.exam, c.year.status);
    const correcting = status === 'UNLOCKED' && classTeacher && has('marks.edit');
    const canEdit =
      canView &&
      !blocked &&
      status !== 'SUBMITTED' &&
      (admin || (entry && has('marks.enter')) || correcting);
    const canSubmit = canEdit && (admin || has('marks.submit'));
    const canUnlock =
      canView &&
      !blocked &&
      status === 'SUBMITTED' &&
      (admin || (classTeacher && has('marks.edit')));
    return {
      canView,
      canEdit,
      canSubmit,
      canUnlock,
      blocked,
      role: admin ? 'ADMIN' : entry ? 'ENTRY_TEACHER' : classTeacher ? 'CLASS_TEACHER' : null,
      readOnlyReason: canEdit
        ? null
        : (blocked ??
          (status === 'SUBMITTED'
            ? 'Submitted and locked. An administrator or the class teacher can unlock it for correction.'
            : 'You can view these marks but not change them.')),
    };
  }

  /** The sheet in the caller's scope, or the same refusal whether it exists or not. */
  private async context(repos: Repositories, p: Principal, key: MarkSheetKey) {
    const c = await loadSheetContext(repos, key.examSubjectId, key.sectionId);
    if (!c) {
      if (this.isAdmin(p)) throw new NotFoundError('That mark sheet was not found.');
      throw new ForbiddenError(NO_SHEET_ACCESS);
    }
    const access = await this.access(repos, p, c);
    if (!access.canView) throw new ForbiddenError(NO_SHEET_ACCESS);
    return { c, access };
  }

  // ---- Reading --------------------------------------------------------------------------------

  async sheet(ctx: RequestContext, key: MarkSheetKey): Promise<MarkSheetView> {
    const p = this.authorize(ctx, 'marks.view');
    const { c, access } = await this.context(this.repos, p, key);
    return this.view(this.repos, c, access);
  }

  private async view(repos: Repositories, c: SheetContext, access: Access): Promise<MarkSheetView> {
    const entries = c.sheet ? await repos.marks.entriesForSheets([c.sheet.id]) : [];
    const byStudent = new Map(entries.map((e) => [e.studentId, e]));
    const students = await sheetStudents(repos, c, entries, this.today());
    const submitted = c.sheet?.status === 'SUBMITTED';
    const structure = (submitted && c.sheet?.calculation) || c.structure;
    const rows = students.map((s) => sheetRow(s, byStudent.get(s.studentId), structure, submitted));
    const onRoll = rows.filter((r) => r.onRoll);
    const teacher = c.sheet?.entryTeacherId
      ? await repos.teachers.find(c.sheet.entryTeacherId)
      : null;
    return {
      examSubjectId: c.examSubject.id,
      sectionId: c.section.sectionId,
      academicYear: { id: c.year.id, label: c.year.label, status: c.year.status },
      exam: examRef(c.exam),
      section: {
        sectionId: c.section.sectionId,
        sectionName: c.section.sectionName,
        classId: c.section.classId,
        className: c.section.className,
      },
      subject: { id: c.subject.id, name: c.subject.name, code: c.subject.code },
      structure: structureView(structure),
      teacher: teacher
        ? { id: teacher.id, fullName: teacher.fullName, staffCode: teacher.staffCode }
        : null,
      status: c.sheet?.status ?? 'DRAFT',
      revision: c.sheet?.revision ?? null,
      submitted:
        c.sheet?.submittedAt && c.sheet.status === 'SUBMITTED'
          ? { at: c.sheet.submittedAt, by: c.sheet.submittedByName }
          : null,
      unlocked:
        c.sheet?.status === 'UNLOCKED' && c.sheet.unlockedAt && c.sheet.unlockReason
          ? { at: c.sheet.unlockedAt, by: c.sheet.unlockedByName, reason: c.sheet.unlockReason }
          : null,
      updatedAt: c.sheet?.updatedAt ?? null,
      rows,
      counts: { entered: onRoll.filter((r) => r.complete).length, total: onRoll.length },
      access: {
        canEdit: access.canEdit,
        canSubmit: access.canSubmit,
        canUnlock: access.canUnlock,
        readOnlyReason: access.readOnlyReason,
      },
    };
  }

  /** The Marks page: exams of a year and the sheets this user may open in each. */
  async home(ctx: RequestContext, academicYearId?: string): Promise<MarksHomeView> {
    const p = this.authorize(ctx, 'marks.view');
    const repos = this.repos;
    const admin = this.isAdmin(p);
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
    if (!year) return { years, academicYearId: null, exams: [] };

    const exams = (await repos.exams.listByYear(year.id)).filter(
      (e) => e.status === 'ACTIVE' && (admin || e.stage !== 'DRAFT'),
    );
    const ownSections = new Set(
      p.classTeacherOf.filter((s) => s.academicYearId === year.id).map((s) => s.sectionId),
    );
    const [classes, sections, subjects] = await Promise.all([
      repos.classes.listClasses(),
      repos.classes.listSections(),
      repos.subjects.list(),
    ]);
    const className = new Map(classes.map((x) => [x.id, x.name]));
    const classOrder = new Map(classes.map((x) => [x.id, x.displayOrder]));
    const subjectInfo = new Map(subjects.map((x, i) => [x.id, { name: x.name, i }]));
    const validEntry = new Map<string, boolean>();

    const out: MarksHomeView['exams'] = [];
    for (const exam of exams) {
      const examSubjects = await repos.exams.listAllSubjects(exam.id);
      const sheets = await repos.marks.sheetsForExam(exam.id);
      const entries = await repos.marks.entriesForSheets(sheets.map((s) => s.id));
      const sheetByKey = new Map(sheets.map((s) => [`${s.examSubjectId}:${s.sectionId}`, s]));
      const items: MarkSheetSummary[] = [];
      for (const es of examSubjects) {
        const structure = await structureOf(repos, exam, es);
        for (const section of sections.filter((s) => s.classId === es.classId)) {
          const sheet = sheetByKey.get(`${es.id}:${section.id}`) ?? null;
          if (!sheet && section.status !== 'ACTIVE') continue;
          let role: MarkSheetSummary['role'] | null = null;
          if (admin) role = 'ADMIN';
          else if (sheet?.entryTeacherId && sheet.entryTeacherId === p.teacherId) {
            const k = `${sheet.entryTeacherId}:${es.subjectId}`;
            if (!validEntry.has(k))
              validEntry.set(k, await this.entryTeacherValid(repos, p.teacherId, es.subjectId));
            if (validEntry.get(k)) role = 'ENTRY_TEACHER';
          }
          if (!role && ownSections.has(section.id)) role = 'CLASS_TEACHER';
          if (!role) continue;
          const calc = (sheet?.status === 'SUBMITTED' && sheet.calculation) || structure;
          items.push({
            examSubjectId: es.id,
            sectionId: section.id,
            classId: es.classId,
            className: className.get(es.classId) ?? '',
            sectionName: section.name,
            subjectId: es.subjectId,
            subjectName: subjectInfo.get(es.subjectId)?.name ?? '',
            status: sheet?.status ?? null,
            entered: sheet ? enteredCount(entries, sheet.id, calc) : 0,
            role,
          });
        }
      }
      if (items.length === 0) continue;
      items.sort(
        (a, b) =>
          (classOrder.get(a.classId) ?? 0) - (classOrder.get(b.classId) ?? 0) ||
          a.sectionName.localeCompare(b.sectionName) ||
          (subjectInfo.get(a.subjectId)?.i ?? 0) - (subjectInfo.get(b.subjectId)?.i ?? 0),
      );
      out.push({ ...examRef(exam), sheets: items });
    }
    return { years, academicYearId: year.id, exams: out };
  }

  /** Readable history of one sheet (from the audit trail). Staff with access only. */
  async history(ctx: RequestContext, key: MarkSheetKey): Promise<MarkHistoryEntry[]> {
    const p = this.authorize(ctx, 'marks.view');
    const { c } = await this.context(this.repos, p, key);
    if (!c.sheet) return [];
    const records = await this.repos.auditLogs.listForEntity('mark_sheet', c.sheet.id, 500);
    const names = new Map<string, string | null>();
    const out: MarkHistoryEntry[] = [];
    for (const r of records) {
      if (r.actorUserId && !names.has(r.actorUserId)) {
        names.set(
          r.actorUserId,
          (await this.repos.userAccounts.findById(r.actorUserId))?.displayName ?? null,
        );
      }
      out.push({
        at: r.occurredAt,
        actor: r.actorUserId ? (names.get(r.actorUserId) ?? null) : null,
        action: r.action,
        summary: summarize(r.action, r.after),
        reason: r.reason,
      });
    }
    return out.sort((a, b) => b.at.localeCompare(a.at));
  }

  // ---- Changing -------------------------------------------------------------------------------

  /** Refuse with the most useful message when the caller may view but not change. */
  private refuseChange(access: Access, status: string): never {
    if (access.blocked) throw new ConflictError(access.blocked);
    if (status === 'SUBMITTED') {
      throw new ConflictError(
        'These marks are submitted and locked. An administrator or the class teacher must unlock them first.',
      );
    }
    throw new ForbiddenError('You can view these marks but not change them.');
  }

  /** Save Draft: one transaction, only changed students, revision-checked (D-55 style). */
  async save(ctx: RequestContext, input: MarkSheetSave): Promise<MarkSheetView> {
    return this.write(ctx, 'marks.view', async (scope) => {
      const { repos, actor, now } = scope;
      const { c, access } = await this.context(repos, actor, input);
      if (!access.canEdit) this.refuseChange(access, c.sheet?.status ?? 'DRAFT');

      const entries = c.sheet ? await repos.marks.entriesForSheets([c.sheet.id]) : [];
      const byStudent = new Map(entries.map((e) => [e.studentId, e]));
      const students = new Map(
        (await sheetStudents(repos, c, entries, this.today())).map((s) => [s.studentId, s]),
      );
      const components = componentsOf(c.structure);
      const applicable = new Set(components.map((x) => x.key));
      const changes: {
        studentId: string;
        before: MarkEntryRecord | undefined;
        values: Record<MarkComponent, number | null>;
      }[] = [];
      for (const [i, row] of input.marks.entries()) {
        const student = students.get(row.studentId);
        if (!student || !student.onRoll) {
          throw fieldConflict(
            `marks.${i}.studentId`,
            `That student is not in ${c.section.label} for ${c.exam.name}.`,
          );
        }
        const values = {} as Record<MarkComponent, number | null>;
        for (const key of ['theory', 'internal', 'practical'] as const) {
          const v = row[key];
          if (v !== null && !applicable.has(key)) {
            throw fieldConflict(
              `marks.${i}.${key}`,
              `${c.subject.name} has no ${MARK_COMPONENT_LABELS[key].toLowerCase()} marks in ${c.exam.name}.`,
            );
          }
          const max = components.find((x) => x.key === key)?.max ?? 0;
          if (v !== null && v > max) {
            throw fieldConflict(
              `marks.${i}.${key}`,
              `${student.fullName}: ${MARK_COMPONENT_LABELS[key]} cannot be more than ${max}.`,
            );
          }
          values[key] = v === null ? null : toHundredths(v);
        }
        const before = byStudent.get(row.studentId);
        const raw = rawOf(before);
        if (
          raw.theory === values.theory &&
          raw.internal === values.internal &&
          raw.practical === values.practical
        )
          continue;
        changes.push({ studentId: row.studentId, before, values });
      }

      let sheet = c.sheet;
      if (!sheet) {
        if (input.revision !== null) throw new ConflictError(STALE);
        if (changes.length === 0) return this.view(repos, c, access);
        sheet = await this.createSheet(scope, c, null);
      } else {
        if (input.revision === null || input.revision !== sheet.revision)
          throw new ConflictError(STALE);
        if (changes.length === 0) return this.view(repos, c, access);
        if (!(await repos.marks.claimRevision(sheet.id, input.revision, actor.userId, now)))
          throw new ConflictError(STALE);
      }

      const where = describeSheet(c);
      const correction = sheet.status === 'UNLOCKED';
      for (const ch of changes) {
        const student = students.get(ch.studentId)!;
        const values = {
          theoryCm: ch.values.theory,
          internalCm: ch.values.internal,
          practicalCm: ch.values.practical,
        };
        if (ch.before) {
          await repos.marks.updateEntryValues(ch.before.id, values, actor.userId, now);
        } else {
          await repos.marks.insertEntry(
            {
              id: newId(),
              markSheetId: sheet.id,
              academicYearId: c.year.id,
              sectionId: c.section.sectionId,
              enrolmentId: student.enrolmentId,
              studentId: student.studentId,
              ...values,
              createdBy: actor.userId,
            },
            now,
          );
        }
        const raw = rawOf(ch.before);
        await scope.audit({
          action: correction ? 'marks.corrected' : 'marks.entered',
          entityType: 'mark_sheet',
          entityId: sheet.id,
          before: { status: sheet.status },
          after: {
            ...where,
            studentId: student.studentId,
            student: student.fullName,
            admissionNumber: student.admissionNumber,
            rollNumber: student.rollNumber,
            enrolmentId: student.enrolmentId,
            changes: components
              .filter((x) => raw[x.key] !== ch.values[x.key])
              .map((x) => ({
                component: x.label,
                from: display(raw[x.key]),
                to: display(ch.values[x.key]),
              })),
            correction,
          },
          reason: correction ? sheet.unlockReason : null,
        });
      }
      const fresh = (await loadSheetContext(repos, input.examSubjectId, input.sectionId))!;
      return this.view(repos, fresh, await this.access(repos, actor, fresh));
    });
  }

  private async createSheet(scope: WriteScope, c: SheetContext, teacherId: string | null) {
    const id = newId();
    await scope.repos.marks.createSheet(
      {
        id,
        academicYearId: c.year.id,
        examId: c.exam.id,
        examSubjectId: c.examSubject.id,
        classId: c.section.classId,
        sectionId: c.section.sectionId,
        subjectId: c.subject.id,
        entryTeacherId: teacherId,
        createdBy: scope.actor.userId,
      },
      scope.now,
    );
    return (await scope.repos.marks.findSheet(c.examSubject.id, c.section.sectionId))!;
  }

  /**
   * Submit (BR-MARK-04): every student on the roll needs every component (a blank is never 0);
   * the results are calculated and stored with the settings used; the sheet locks. All or nothing.
   */
  async submit(ctx: RequestContext, input: MarkSheetSubmit): Promise<MarkSheetView> {
    return this.write(ctx, 'marks.view', async (scope) => {
      const { repos, actor, now } = scope;
      const { c, access } = await this.context(repos, actor, input);
      if (!access.canSubmit) {
        if (access.canEdit)
          throw new ForbiddenError('You can enter these marks but not submit them.');
        this.refuseChange(access, c.sheet?.status ?? 'DRAFT');
      }
      const sheet = c.sheet;
      if (!sheet) throw new ConflictError('No marks have been saved on this sheet yet.');
      if (input.revision !== sheet.revision) throw new ConflictError(STALE);

      const entries = await repos.marks.entriesForSheets([sheet.id]);
      const byStudent = new Map(entries.map((e) => [e.studentId, e]));
      const students = await sheetStudents(repos, c, entries, this.today());
      const onRoll = students.filter((s) => s.onRoll);
      if (onRoll.length === 0)
        throw new ConflictError(`There are no students in ${c.section.label} to submit marks for.`);
      const missing = onRoll.filter(
        (s) => !isComplete(c.structure, rawOf(byStudent.get(s.studentId))),
      );
      if (missing.length > 0) {
        const names = missing
          .slice(0, 5)
          .map((s) => (s.rollNumber ? `${s.rollNumber} ${s.fullName}` : s.fullName))
          .join(', ');
        throw new ConflictError(
          `Marks are missing for ${missing.length} of ${onRoll.length} students (${names}${missing.length > 5 ? ', …' : ''}). Enter every mark — 0 for a real zero — before submitting.`,
        );
      }
      // Re-check every stored value against today's maximums (configuration may have changed).
      const components = componentsOf(c.structure);
      for (const e of entries) {
        const raw = rawOf(e);
        for (const key of ['theory', 'internal', 'practical'] as const) {
          const max = components.find((x) => x.key === key)?.max ?? 0;
          if (raw[key] !== null && raw[key]! > max * 100) {
            throw new ConflictError(
              `A ${MARK_COMPONENT_LABELS[key].toLowerCase()} mark is above the maximum of ${max}. Correct it before submitting.`,
            );
          }
        }
      }
      if (!(await repos.marks.claimRevision(sheet.id, input.revision, actor.userId, now)))
        throw new ConflictError(STALE);

      let passed = 0;
      for (const e of entries) {
        const score = scoreSubject(c.structure, rawOf(e));
        if (!score) continue; // an off-roll student's incomplete marks stay without a result
        if (score.passed) passed += 1;
        await repos.marks.setEntryDerived(e.id, {
          totalCm: score.totalCm,
          normalizedCm: score.normalizedCm,
          percentBp: score.percentBp,
          grade: score.grade,
          passed: score.passed,
        });
      }
      await repos.marks.updateSheet(
        sheet.id,
        {
          status: 'SUBMITTED',
          calculation: c.structure,
          submittedAt: now,
          submittedBy: actor.userId,
        },
        actor.userId,
        now,
      );
      await scope.audit({
        action: sheet.status === 'UNLOCKED' ? 'marks.resubmitted' : 'marks.submitted',
        entityType: 'mark_sheet',
        entityId: sheet.id,
        before: { status: sheet.status },
        after: {
          ...describeSheet(c),
          status: 'SUBMITTED',
          students: onRoll.length,
          passed,
          calculation: c.structure,
        },
      });
      const fresh = (await loadSheetContext(repos, input.examSubjectId, input.sectionId))!;
      return this.view(repos, fresh, await this.access(repos, actor, fresh));
    });
  }

  /** Unlock for correction (BR-MARK-05): administrator or class teacher with marks.edit; reason. */
  async unlock(ctx: RequestContext, input: MarkSheetUnlock): Promise<MarkSheetView> {
    return this.write(ctx, 'marks.view', async (scope) => {
      const { repos, actor, now } = scope;
      const { c, access } = await this.context(repos, actor, input);
      const sheet = c.sheet;
      if (!sheet || sheet.status !== 'SUBMITTED')
        throw new ConflictError('Only submitted marks can be unlocked.');
      if (!access.canUnlock) {
        if (access.blocked) throw new ConflictError(access.blocked);
        throw new ForbiddenError(
          'Only an administrator or the class teacher of this class can unlock submitted marks.',
        );
      }
      if (input.revision !== sheet.revision) throw new ConflictError(STALE);
      if (!(await repos.marks.claimRevision(sheet.id, input.revision, actor.userId, now)))
        throw new ConflictError(STALE);
      await repos.marks.updateSheet(
        sheet.id,
        {
          status: 'UNLOCKED',
          unlockedAt: now,
          unlockedBy: actor.userId,
          unlockReason: input.reason,
        },
        actor.userId,
        now,
      );
      await scope.audit({
        action: 'marks.unlocked',
        entityType: 'mark_sheet',
        entityId: sheet.id,
        before: {
          status: 'SUBMITTED',
          submittedAt: sheet.submittedAt,
          submittedBy: sheet.submittedByName,
        },
        after: { ...describeSheet(c), status: 'UNLOCKED' },
        reason: input.reason,
      });
      const fresh = (await loadSheetContext(repos, input.examSubjectId, input.sectionId))!;
      return this.view(repos, fresh, await this.access(repos, actor, fresh));
    });
  }
}

// ---------------------------------------------------------------------------

export function examRef(e: ExamRecord) {
  return {
    id: e.id,
    name: e.name,
    stage: e.stage,
    status: e.status,
    startDate: e.startDate,
    endDate: e.endDate,
  };
}

export function enteredCount(
  entries: readonly MarkEntryRecord[],
  sheetId: string,
  structure: MarkStructure,
): number {
  return entries.filter((e) => e.markSheetId === sheetId && isComplete(structure, rawOf(e))).length;
}

const display = (cm: number | null) => (cm === null ? '-' : String(fromHundredths(cm)));

/** One line describing an audit entry of a mark sheet. */
function summarize(action: string, after: unknown): string {
  const a = (after ?? {}) as Record<string, unknown>;
  switch (action) {
    case 'marks.entered':
    case 'marks.corrected': {
      const changes = (a.changes as { component: string; from: string; to: string }[]) ?? [];
      const what = changes.map((x) => `${x.component} ${x.from} → ${x.to}`).join(', ');
      return `${action === 'marks.corrected' ? 'Corrected' : 'Entered'} ${String(a.student ?? 'a student')}: ${what}`;
    }
    case 'marks.submitted':
      return `Submitted and locked (${String(a.students)} students)`;
    case 'marks.resubmitted':
      return `Resubmitted after correction (${String(a.students)} students)`;
    case 'marks.unlocked':
      return 'Unlocked for correction';
    case 'marks.teacher_assigned':
      return `Mark entry assigned to ${String(a.teacher ?? 'nobody')}`;
    default:
      return MARK_SHEET_STATUS_LABELS[a.status as keyof typeof MARK_SHEET_STATUS_LABELS] ?? action;
  }
}

export type { MarkSheetRecord };
