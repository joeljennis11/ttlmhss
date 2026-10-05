import type {
  BehaviourOptionsView,
  BehaviourSheetKey,
  BehaviourSheetSave,
  BehaviourSheetSubmit,
  BehaviourSheetView,
  MarkHistoryEntry,
  StudentBehaviour,
  StudentBehaviourList,
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
import type {
  AcademicYearRecord,
  CategoryRecord,
  ExamRecord,
} from '../config/config.repository.js';
import { examRef } from '../marks/mark-sheet.service.js';
import {
  MarksServiceBase,
  sheetStudents,
  type RequestContext,
  type WriteScope,
} from '../marks/marks-context.js';
import { sectionRef } from '../timetable/timetable-service.js';
import type { BehaviourAssessmentRecord, BehaviourSheetRecord } from './behaviour.repository.js';

const NO_ACCESS = 'You do not have access to the behaviour of this class.';
const STALE =
  'This behaviour sheet was changed by someone else after you opened it. Reload it to see the latest ratings, then make your change again.';

interface Config {
  /** Active categories in display order (every one must be rated). */
  active: CategoryRecord[];
  byId: Map<string, CategoryRecord>;
  labels: Map<number, string>;
  problems: string[];
}

interface Context {
  year: AcademicYearRecord;
  exam: ExamRecord;
  section: Awaited<ReturnType<typeof sectionRef>>;
  sheet: BehaviourSheetRecord | null;
}

interface Access {
  canEdit: boolean;
  canSubmit: boolean;
  blocked: string | null;
  readOnlyReason: string | null;
}

/**
 * Exam-based behaviour (Phase 9, BR-BEH). One sheet per exam and section, recorded by the class
 * teacher of that section (or an administrator): Save draft → Submit (finalised, visible to the
 * student). A submitted sheet is corrected in place with a reason; every change is audited.
 * Categories and the five rating labels come from the Phase 4 configuration.
 */
export class BehaviourService extends MarksServiceBase {
  private isClassTeacher(p: Principal, yearId: string, sectionId: string) {
    return p.classTeacherOf.some((s) => s.academicYearId === yearId && s.sectionId === sectionId);
  }

  private async config(repos: Repositories): Promise<Config> {
    const [categories, labels] = await Promise.all([
      repos.behaviourCategories.list(),
      repos.ratingLabels.list(),
    ]);
    const active = categories
      .filter((c) => c.status === 'ACTIVE')
      .sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name));
    const labelMap = new Map(labels.map((l) => [l.rating, l.label]));
    const problems: string[] = [];
    if (active.length === 0)
      problems.push('Add behaviour categories in School setup → Behaviour first.');
    if ([1, 2, 3, 4, 5].some((r) => !labelMap.get(r)))
      problems.push('Name all five rating labels in School setup → Behaviour first.');
    return { active, byId: new Map(categories.map((c) => [c.id, c])), labels: labelMap, problems };
  }

  /** The exam + section in the caller's scope (same refusal whether or not it exists). */
  private async context(repos: Repositories, p: Principal, key: BehaviourSheetKey) {
    const admin = this.isAdmin(p);
    const refuse = () =>
      admin
        ? new NotFoundError('That exam or class was not found.')
        : new ForbiddenError(NO_ACCESS);
    const exam = await repos.exams.find(key.examId);
    const sectionRecord = await repos.classes.findSection(key.sectionId);
    if (!exam || !sectionRecord) throw refuse();
    if (!admin && !this.isClassTeacher(p, exam.academicYearId, key.sectionId))
      throw new ForbiddenError(NO_ACCESS);
    if ((await repos.exams.listSubjects(exam.id, sectionRecord.classId)).length === 0) {
      throw new ConflictError(`This class does not take ${exam.name}.`);
    }
    const year = (await repos.academicYears.find(exam.academicYearId))!;
    const ctx: Context = {
      year,
      exam,
      section: await sectionRef(repos, key.sectionId),
      sheet: await repos.behaviour.findSheet(exam.id, key.sectionId),
    };
    return ctx;
  }

  private access(p: Principal, c: Context, config: Config): Access {
    const admin = this.isAdmin(p);
    const blocked = behaviourBlocked(c.exam, c.year.status) ?? (config.problems[0] || null);
    const may =
      admin ||
      (p.permissions.has('behaviour.manage') &&
        this.isClassTeacher(p, c.year.id, c.section.sectionId));
    const canEdit = may && !blocked;
    return {
      canEdit,
      canSubmit: canEdit && (c.sheet?.status ?? 'DRAFT') === 'DRAFT',
      blocked,
      readOnlyReason: canEdit
        ? null
        : (blocked ?? 'You can view this behaviour but not change it.'),
    };
  }

  // ---- Staff ----------------------------------------------------------------------------------

  async options(ctx: RequestContext, academicYearId?: string): Promise<BehaviourOptionsView> {
    const p = this.authorize(ctx, 'behaviour.view');
    if (p.studentId) throw new ForbiddenError('Students see their own behaviour under My portal.');
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
    const config = await this.config(repos);
    if (!year)
      return {
        years,
        academicYearId: null,
        exams: [],
        sections: [],
        setupProblems: config.problems,
      };
    const admin = this.isAdmin(p);
    const own = new Set(
      p.classTeacherOf.filter((s) => s.academicYearId === year.id).map((s) => s.sectionId),
    );
    const [classes, sections] = await Promise.all([
      repos.classes.listClasses(),
      repos.classes.listSections(),
    ]);
    const classOf = new Map(classes.map((c) => [c.id, c]));
    return {
      years,
      academicYearId: year.id,
      exams: (await repos.exams.listByYear(year.id))
        .filter((e) => e.status === 'ACTIVE' && e.stage !== 'DRAFT')
        .map(examRef),
      sections: sections
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
        })),
      setupProblems: config.problems,
    };
  }

  async sheet(ctx: RequestContext, key: BehaviourSheetKey): Promise<BehaviourSheetView> {
    const p = this.authorize(ctx, 'behaviour.view');
    const repos = this.repos;
    const c = await this.context(repos, p, key);
    const config = await this.config(repos);
    return this.view(repos, c, config, this.access(p, c, config));
  }

  private async view(
    repos: Repositories,
    c: Context,
    config: Config,
    access: Access,
  ): Promise<BehaviourSheetView> {
    const assessments = c.sheet ? await repos.behaviour.assessmentsForSheet(c.sheet.id) : [];
    const byStudent = new Map(assessments.map((a) => [a.studentId, a]));
    const students = await sheetStudents(repos, c, assessments, this.today());
    const used = new Set(assessments.flatMap((a) => a.ratings.map((r) => r.categoryId)));
    const shown = [
      ...config.active,
      ...[...used]
        .map((id) => config.byId.get(id))
        .filter((x): x is CategoryRecord => !!x && x.status !== 'ACTIVE'),
    ];
    const rows = students.map((s) => {
      const a = byStudent.get(s.studentId);
      const ratings = Object.fromEntries(
        shown.map((cat) => [
          cat.id,
          a?.ratings.find((r) => r.categoryId === cat.id)?.rating ?? null,
        ]),
      );
      return {
        ...s,
        ratings,
        remark: a?.remark ?? null,
        complete: isComplete(a, config),
      };
    });
    const onRoll = rows.filter((r) => r.onRoll);
    return {
      academicYear: { id: c.year.id, label: c.year.label, status: c.year.status },
      exam: examRef(c.exam),
      section: {
        sectionId: c.section.sectionId,
        sectionName: c.section.sectionName,
        classId: c.section.classId,
        className: c.section.className,
      },
      categories: shown.map((cat) => ({
        id: cat.id,
        name: cat.name,
        description: cat.description,
        active: cat.status === 'ACTIVE',
      })),
      labels: [1, 2, 3, 4, 5].map((rating) => ({
        rating,
        label: config.labels.get(rating) ?? String(rating),
      })),
      status: c.sheet?.status ?? 'DRAFT',
      revision: c.sheet?.revision ?? null,
      submitted:
        c.sheet?.status === 'SUBMITTED' && c.sheet.submittedAt
          ? { at: c.sheet.submittedAt, by: c.sheet.submittedByName }
          : null,
      updatedAt: c.sheet?.updatedAt ?? null,
      rows,
      counts: { complete: onRoll.filter((r) => r.complete).length, total: onRoll.length },
      access: {
        canEdit: access.canEdit,
        canSubmit: access.canSubmit,
        correction: c.sheet?.status === 'SUBMITTED',
        readOnlyReason: access.readOnlyReason,
      },
    };
  }

  private refuse(access: Access): never {
    if (access.blocked) throw new ConflictError(access.blocked);
    throw new ForbiddenError(
      'Only the class teacher of this class or an administrator can record behaviour.',
    );
  }

  /** Save draft, or (on a submitted sheet) a correction with a reason. One transaction. */
  async save(ctx: RequestContext, input: BehaviourSheetSave): Promise<BehaviourSheetView> {
    return this.write(ctx, 'behaviour.view', async (scope) => {
      const { repos, actor, now } = scope;
      const c = await this.context(repos, actor, input);
      const config = await this.config(repos);
      const access = this.access(actor, c, config);
      if (!access.canEdit) this.refuse(access);
      const correction = c.sheet?.status === 'SUBMITTED';
      const reason = input.reason?.trim() ?? '';
      if (correction && reason.length < 5) {
        throw fieldConflict(
          'reason',
          'This behaviour is already submitted. Give a reason for the correction (at least 5 characters).',
        );
      }

      const assessments = c.sheet ? await repos.behaviour.assessmentsForSheet(c.sheet.id) : [];
      const byStudent = new Map(assessments.map((a) => [a.studentId, a]));
      const students = new Map(
        (await sheetStudents(repos, c, assessments, this.today())).map((s) => [s.studentId, s]),
      );
      const activeIds = new Set(config.active.map((x) => x.id));
      const changes: {
        studentId: string;
        before: BehaviourAssessmentRecord | undefined;
        ratings: { categoryId: string; from: number | null; to: number | null }[];
        remark: { from: string | null; to: string | null } | null;
      }[] = [];
      for (const [i, row] of input.rows.entries()) {
        const student = students.get(row.studentId);
        if (!student || !student.onRoll) {
          throw fieldConflict(
            `rows.${i}.studentId`,
            `That student is not in ${c.section.label} for ${c.exam.name}.`,
          );
        }
        const before = byStudent.get(row.studentId);
        const ratings: (typeof changes)[number]['ratings'] = [];
        for (const r of row.ratings) {
          if (!activeIds.has(r.categoryId)) {
            throw fieldConflict(`rows.${i}.ratings`, 'That behaviour category is not active.');
          }
          const from = before?.ratings.find((x) => x.categoryId === r.categoryId)?.rating ?? null;
          if (from !== r.rating) ratings.push({ categoryId: r.categoryId, from, to: r.rating });
        }
        const remarkTo = row.remark ?? null;
        const remarkFrom = before?.remark ?? null;
        const remark = remarkTo !== remarkFrom ? { from: remarkFrom, to: remarkTo } : null;
        if (ratings.length === 0 && !remark) continue;
        if (correction) {
          const after = new Map(
            (before?.ratings ?? []).map((x) => [x.categoryId, x.rating as number | null]),
          );
          for (const r of ratings) after.set(r.categoryId, r.to);
          if (config.active.some((cat) => (after.get(cat.id) ?? null) === null)) {
            throw fieldConflict(
              `rows.${i}.ratings`,
              `${student.fullName}: a submitted assessment keeps a rating for every category.`,
            );
          }
        }
        changes.push({ studentId: row.studentId, before, ratings, remark });
      }

      let sheet = c.sheet;
      if (!sheet) {
        if (input.revision !== null) throw new ConflictError(STALE);
        if (changes.length === 0) return this.view(repos, c, config, access);
        const id = newId();
        await repos.behaviour.createSheet(
          {
            id,
            academicYearId: c.year.id,
            examId: c.exam.id,
            classId: c.section.classId,
            sectionId: c.section.sectionId,
            createdBy: actor.userId,
          },
          now,
        );
        sheet = (await repos.behaviour.findSheetById(id))!;
      } else {
        if (input.revision === null || input.revision !== sheet.revision)
          throw new ConflictError(STALE);
        if (changes.length === 0) return this.view(repos, c, config, access);
        if (!(await repos.behaviour.claimRevision(sheet.id, input.revision, actor.userId, now)))
          throw new ConflictError(STALE);
      }

      for (const ch of changes) {
        const student = students.get(ch.studentId)!;
        let assessmentId = ch.before?.id;
        if (!assessmentId) {
          assessmentId = newId();
          await repos.behaviour.insertAssessment(
            {
              id: assessmentId,
              sheetId: sheet.id,
              academicYearId: c.year.id,
              sectionId: c.section.sectionId,
              enrolmentId: student.enrolmentId,
              studentId: student.studentId,
              remark: ch.remark?.to ?? null,
              createdBy: actor.userId,
            },
            now,
          );
        } else if (ch.remark) {
          await repos.behaviour.updateRemark(assessmentId, ch.remark.to, actor.userId, now);
        }
        for (const r of ch.ratings) {
          if (r.to === null) await repos.behaviour.deleteRating(assessmentId, r.categoryId);
          else
            await repos.behaviour.setRating(
              assessmentId,
              r.categoryId,
              r.to,
              correction ? (config.labels.get(r.to) ?? null) : null,
              now,
            );
        }
        await scope.audit({
          action: correction ? 'behaviour.corrected' : 'behaviour.recorded',
          entityType: 'behaviour_sheet',
          entityId: sheet.id,
          before: { status: sheet.status },
          after: {
            ...describe(c),
            studentId: student.studentId,
            student: student.fullName,
            admissionNumber: student.admissionNumber,
            enrolmentId: student.enrolmentId,
            changes: ch.ratings.map((r) => ({
              category: config.byId.get(r.categoryId)?.name ?? r.categoryId,
              from: ratingText(r.from, config),
              to: ratingText(r.to, config),
            })),
            ...(ch.remark ? { remark: ch.remark } : {}),
            correction,
          },
          reason: correction ? reason : null,
        });
      }
      const fresh = await this.context(repos, actor, input);
      return this.view(repos, fresh, config, this.access(actor, fresh, config));
    });
  }

  /** Submit (finalise): every student on the roll rated in every active category; labels kept. */
  async submit(ctx: RequestContext, input: BehaviourSheetSubmit): Promise<BehaviourSheetView> {
    return this.write(ctx, 'behaviour.view', async (scope: WriteScope) => {
      const { repos, actor, now } = scope;
      const c = await this.context(repos, actor, input);
      const config = await this.config(repos);
      const access = this.access(actor, c, config);
      if (!access.canEdit) this.refuse(access);
      const sheet = c.sheet;
      if (!sheet) throw new ConflictError('No behaviour has been saved for this class yet.');
      if (sheet.status === 'SUBMITTED')
        throw new ConflictError('This behaviour is already submitted.');
      if (input.revision !== sheet.revision) throw new ConflictError(STALE);
      const assessments = await repos.behaviour.assessmentsForSheet(sheet.id);
      const byStudent = new Map(assessments.map((a) => [a.studentId, a]));
      const onRoll = (await sheetStudents(repos, c, assessments, this.today())).filter(
        (s) => s.onRoll,
      );
      if (onRoll.length === 0)
        throw new ConflictError(`There are no students in ${c.section.label}.`);
      const missing = onRoll.filter((s) => !isComplete(byStudent.get(s.studentId), config));
      if (missing.length > 0) {
        const names = missing
          .slice(0, 5)
          .map((s) => (s.rollNumber ? `${s.rollNumber} ${s.fullName}` : s.fullName))
          .join(', ');
        throw new ConflictError(
          `Ratings are missing for ${missing.length} of ${onRoll.length} students (${names}${missing.length > 5 ? ', …' : ''}). Rate every category before submitting.`,
        );
      }
      if (!(await repos.behaviour.claimRevision(sheet.id, input.revision, actor.userId, now)))
        throw new ConflictError(STALE);
      // Keep the meaning of each rating as configured today (annual reports read these).
      for (const a of assessments) {
        for (const r of a.ratings) {
          await repos.behaviour.setRating(
            a.id,
            r.categoryId,
            r.rating,
            config.labels.get(r.rating) ?? null,
            now,
          );
        }
      }
      await repos.behaviour.markSubmitted(sheet.id, actor.userId, now);
      await scope.audit({
        action: 'behaviour.submitted',
        entityType: 'behaviour_sheet',
        entityId: sheet.id,
        before: { status: 'DRAFT' },
        after: {
          ...describe(c),
          status: 'SUBMITTED',
          students: onRoll.length,
          categories: config.active.map((x) => x.name),
          labels: Object.fromEntries(config.labels),
        },
      });
      const fresh = await this.context(repos, actor, input);
      return this.view(repos, fresh, config, this.access(actor, fresh, config));
    });
  }

  async history(ctx: RequestContext, key: BehaviourSheetKey): Promise<MarkHistoryEntry[]> {
    const p = this.authorize(ctx, 'behaviour.view');
    const c = await this.context(this.repos, p, key);
    if (!c.sheet) return [];
    const records = await this.repos.auditLogs.listForEntity('behaviour_sheet', c.sheet.id, 500);
    const names = new Map<string, string | null>();
    const out: MarkHistoryEntry[] = [];
    for (const r of records) {
      if (r.actorUserId && !names.has(r.actorUserId))
        names.set(
          r.actorUserId,
          (await this.repos.userAccounts.findById(r.actorUserId))?.displayName ?? null,
        );
      const a = (r.after ?? {}) as Record<string, unknown>;
      const changes = (a.changes as { category: string; from: string; to: string }[]) ?? [];
      const remark = a.remark ? ' · remark changed' : '';
      out.push({
        at: r.occurredAt,
        actor: r.actorUserId ? (names.get(r.actorUserId) ?? null) : null,
        action: r.action,
        summary:
          r.action === 'behaviour.submitted'
            ? `Submitted (${String(a.students)} students)`
            : `${r.action === 'behaviour.corrected' ? 'Corrected' : 'Recorded'} ${String(a.student ?? '')}: ${changes.map((x) => `${x.category} ${x.from} → ${x.to}`).join(', ')}${remark}`,
        reason: r.reason,
      });
    }
    return out;
  }

  // ---- A student's behaviour ---------------------------------------------------------------------

  /** The signed-in student's own SUBMITTED behaviour (drafts never leave the API). */
  async mine(ctx: RequestContext, academicYearId?: string): Promise<StudentBehaviourList> {
    const p = this.authorize(ctx, 'behaviour.view');
    if (!p.studentId) throw new ForbiddenError('Only students have their own behaviour page.');
    return { assessments: await this.forStudentId(this.repos, p.studentId, academicYearId, true) };
  }

  /** Staff: an administrator, or the class teacher of the student's current section. */
  async forStudent(ctx: RequestContext, studentId: string): Promise<StudentBehaviourList> {
    const p = this.authorize(ctx, 'behaviour.view');
    if (p.studentId && p.studentId !== studentId)
      throw new ForbiddenError('You do not have access to this record.');
    await this.deps.authorization.checkStudentScope(p, studentId);
    if (!(await this.repos.students.find(studentId)))
      throw new NotFoundError('That student was not found.');
    return {
      assessments: await this.forStudentId(this.repos, studentId, undefined, !!p.studentId),
    };
  }

  private async forStudentId(
    repos: Repositories,
    studentId: string,
    academicYearId: string | undefined,
    submittedOnly: boolean,
  ): Promise<StudentBehaviour[]> {
    const assessments = await repos.behaviour.assessmentsForStudent(studentId);
    const categories = new Map((await repos.behaviourCategories.list()).map((x) => [x.id, x]));
    const out: (StudentBehaviour & { order: [string, number] })[] = [];
    for (const a of assessments) {
      if (academicYearId && a.academicYearId !== academicYearId) continue;
      const sheet = await repos.behaviour.findSheetById(a.sheetId);
      if (!sheet) continue;
      if (submittedOnly && sheet.status !== 'SUBMITTED') continue;
      const exam = await repos.exams.find(sheet.examId);
      if (!exam || (submittedOnly && (exam.status !== 'ACTIVE' || exam.stage === 'DRAFT')))
        continue;
      const year = (await repos.academicYears.find(a.academicYearId))!;
      const section = await sectionRef(repos, a.sectionId);
      out.push({
        order: [year.startDate, exam.displayOrder],
        academicYear: { id: year.id, label: year.label, status: year.status },
        exam: examRef(exam),
        section: {
          sectionId: section.sectionId,
          sectionName: section.sectionName,
          classId: section.classId,
          className: section.className,
        },
        status: sheet.status,
        submittedAt: sheet.submittedAt,
        ratings: a.ratings
          .map((r) => ({
            categoryId: r.categoryId,
            categoryName: categories.get(r.categoryId)?.name ?? '',
            rating: r.rating,
            label: r.label,
            order: categories.get(r.categoryId)?.displayOrder ?? 0,
          }))
          .sort((x, y) => x.order - y.order || x.categoryName.localeCompare(y.categoryName))
          .map(({ order: _o, ...r }) => r),
        remark: a.remark,
      });
    }
    return out
      .sort((x, y) => y.order[0].localeCompare(x.order[0]) || x.order[1] - y.order[1])
      .map(({ order: _o, ...rest }) => rest);
  }
}

/** Nothing can change: inactive exam, closed year, exam not open (same lifecycle as marks). */
function behaviourBlocked(exam: ExamRecord, yearStatus: string): string | null {
  if (exam.status !== 'ACTIVE') return 'This exam is inactive; its behaviour is read-only.';
  if (yearStatus === 'CLOSED') return 'This academic year is closed; its behaviour is read-only.';
  if (exam.stage === 'DRAFT')
    return 'This exam is not open yet; behaviour can be recorded once it is opened.';
  if (exam.stage === 'CLOSED') return 'This exam is closed; its behaviour can no longer change.';
  return null;
}

function isComplete(a: BehaviourAssessmentRecord | undefined, config: Config): boolean {
  if (!a) return false;
  return config.active.every((cat) => a.ratings.some((r) => r.categoryId === cat.id));
}

function ratingText(rating: number | null, config: Config): string {
  if (rating === null) return '-';
  const label = config.labels.get(rating);
  return label ? `${rating} (${label})` : String(rating);
}

function describe(c: Context) {
  return {
    academicYearId: c.year.id,
    academicYear: c.year.label,
    examId: c.exam.id,
    exam: c.exam.name,
    classId: c.section.classId,
    sectionId: c.section.sectionId,
    classSection: c.section.label,
  };
}
