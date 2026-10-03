import {
  CONFIGURABLE_ROLES,
  PERMISSIONS,
  PERMISSION_INFO,
  RATING_VALUES,
  grantableTo,
  type BehaviourConfigView,
  type CategoryCreateSchema,
  type CategoryUpdateSchema,
  type CategoryView,
  type ConfigurableRole,
  type ExamCreateSchema,
  type ExamListView,
  type ExamSubjectView,
  type ExamSubjectsUpdateSchema,
  type ExamUpdateSchema,
  type ExamView,
  type Permission,
  type PermissionsView,
  type RatingLabelsUpdateSchema,
} from '@ttlmhss/shared';
import type { z } from 'zod';
import { ROLE_PERMISSIONS, type RolePermissionService } from '../../core/auth/role-permissions.js';
import { ConflictError, ValidationError, fieldConflict } from '../../core/errors/app-errors.js';
import { newId } from '../../core/utils/clock.js';
import type { Repositories } from '../../data/data-store.js';
import type { CategoryRepository, ExamRecord, PermissionOverride } from './config.repository.js';
import {
  ConfigService,
  defined,
  fromBp,
  required,
  toBp,
  type ConfigServiceDeps,
  type RequestContext,
} from './config-service.js';

// ---------------------------------------------------------------------------
// Exams
// ---------------------------------------------------------------------------

const FULL_WEIGHTAGE_BP = 10_000;

export class ExamService extends ConfigService {
  private toView(record: ExamRecord & { subjectCount: number }): ExamView {
    const { weightageBp, ...rest } = record;
    return { ...rest, weightagePercent: fromBp(weightageBp) };
  }

  async list(ctx: RequestContext, academicYearId: string): Promise<ExamListView> {
    this.authorize(ctx);
    required(await this.repos.academicYears.find(academicYearId), 'academic year');
    const exams = await this.repos.exams.listByYear(academicYearId);
    const totalBp = exams
      .filter((e) => e.status === 'ACTIVE')
      .reduce((sum, e) => sum + e.weightageBp, 0);
    return {
      exams: exams.map((e) => this.toView(e)),
      totalWeightagePercent: fromBp(totalBp),
      weightageComplete: totalBp === FULL_WEIGHTAGE_BP,
    };
  }

  private async view(id: string): Promise<ExamView> {
    const exam = required(await this.repos.exams.find(id), 'exam');
    return this.toView({ ...exam, subjectCount: await this.repos.exams.countSubjects(id) });
  }

  async get(ctx: RequestContext, id: string): Promise<ExamView> {
    this.authorize(ctx);
    return this.view(id);
  }

  /** Name unique in the year, dates inside the year, scale exists, annual weightage ≤ 100 %. */
  private async validate(repos: Repositories, exam: ExamRecord) {
    const year = required(await repos.academicYears.find(exam.academicYearId), 'academic year');
    const clash = await repos.exams.findByName(exam.academicYearId, exam.name);
    if (clash && clash.id !== exam.id)
      throw fieldConflict('name', `${year.label} already has an exam named "${clash.name}".`);
    for (const field of ['startDate', 'endDate'] as const) {
      const date = exam[field];
      if (date && (date < year.startDate || date > year.endDate)) {
        throw fieldConflict(
          field,
          `Exam dates must fall within ${year.label} (${year.startDate} to ${year.endDate}).`,
        );
      }
    }
    if (exam.gradeSchemeId) {
      const scheme = await repos.gradeSchemes.find(exam.gradeSchemeId);
      if (!scheme) throw fieldConflict('gradeSchemeId', 'That grade scale was not found.');
    }
    if (exam.status === 'ACTIVE') {
      const others = (await repos.exams.listByYear(exam.academicYearId)).filter(
        (e) => e.id !== exam.id && e.status === 'ACTIVE',
      );
      const total = others.reduce((sum, e) => sum + e.weightageBp, 0) + exam.weightageBp;
      if (total > FULL_WEIGHTAGE_BP) {
        throw fieldConflict(
          'weightagePercent',
          `Annual weightage for ${year.label} would be ${fromBp(total)}%. It cannot exceed 100% (other exams already use ${fromBp(total - exam.weightageBp)}%).`,
        );
      }
    }
  }

  async create(ctx: RequestContext, input: z.output<typeof ExamCreateSchema>): Promise<ExamView> {
    const record: ExamRecord = {
      id: newId(),
      academicYearId: input.academicYearId,
      name: input.name,
      startDate: input.startDate ?? null,
      endDate: input.endDate ?? null,
      weightageBp: toBp(input.weightagePercent),
      gradeSchemeId: input.gradeSchemeId ?? null,
      rankScope: input.rankScope,
      displayOrder: input.displayOrder,
      status: 'ACTIVE',
    };
    await this.write(ctx, async ({ repos, now, audit }) => {
      await this.validate(repos, record);
      await repos.exams.create(record, now);
      await audit({
        action: 'config.exam.created',
        entityType: 'exam',
        entityId: record.id,
        after: record,
      });
    });
    return this.view(record.id);
  }

  async update(
    ctx: RequestContext,
    id: string,
    input: z.output<typeof ExamUpdateSchema>,
  ): Promise<ExamView> {
    await this.write(ctx, async ({ repos, now, audit }) => {
      const before = required(await repos.exams.find(id), 'exam');
      const { weightagePercent, ...rest } = input;
      const changes: Partial<ExamRecord> = {
        ...defined(rest),
        ...(weightagePercent !== undefined ? { weightageBp: toBp(weightagePercent) } : {}),
      };
      const after = { ...before, ...changes };
      if (after.startDate && after.endDate && after.startDate > after.endDate) {
        throw fieldConflict('endDate', 'End date cannot be before the start date.');
      }
      await this.validate(repos, after);
      await repos.exams.update(id, changes, now);
      await audit({
        action: 'config.exam.updated',
        entityType: 'exam',
        entityId: id,
        before,
        after,
      });
    });
    return this.view(id);
  }

  async remove(ctx: RequestContext, id: string): Promise<void> {
    await this.write(ctx, async ({ repos, audit }) => {
      const exam = required(await repos.exams.find(id), 'exam');
      if ((await repos.exams.countSubjects(id)) > 0) {
        throw new ConflictError(
          `"${exam.name}" already has subjects set up. Remove them first, or make the exam inactive.`,
        );
      }
      await repos.exams.delete(id);
      await audit({
        action: 'config.exam.deleted',
        entityType: 'exam',
        entityId: id,
        before: exam,
      });
    });
  }

  async getSubjects(
    ctx: RequestContext,
    examId: string,
    classId: string,
  ): Promise<ExamSubjectView[]> {
    this.authorize(ctx);
    required(await this.repos.exams.find(examId), 'exam');
    required(await this.repos.classes.findClass(classId), 'class');
    return this.subjectViews(examId, classId);
  }

  private async subjectViews(examId: string, classId: string): Promise<ExamSubjectView[]> {
    const [rows, subjects] = await Promise.all([
      this.repos.exams.listSubjects(examId, classId),
      this.repos.subjects.list(),
    ]);
    const order = new Map(subjects.map((s, i) => [s.id, { i, name: s.name }]));
    return rows
      .sort((a, b) => (order.get(a.subjectId)?.i ?? 0) - (order.get(b.subjectId)?.i ?? 0))
      .map((r) => ({
        subjectId: r.subjectId,
        subjectName: order.get(r.subjectId)?.name ?? '',
        theoryMax: r.theoryMax,
        internalMax: r.internalMax,
        practicalMax: r.practicalMax,
        totalMax: r.theoryMax + (r.internalMax ?? 0) + (r.practicalMax ?? 0),
        passMarks: r.passMarks,
        normalizedMax: r.normalizedMax,
        includeInResult: r.includeInResult,
        gradeSchemeId: r.gradeSchemeId,
      }));
  }

  /**
   * Replace the subject list of one exam for one class. Existing rows keep their identity (later,
   * marks will refer to them); removed rows are deleted — which the database will refuse once
   * marks exist for them.
   */
  async setSubjects(
    ctx: RequestContext,
    examId: string,
    classId: string,
    input: z.output<typeof ExamSubjectsUpdateSchema>,
  ): Promise<ExamSubjectView[]> {
    await this.write(ctx, async ({ repos, now, audit }) => {
      required(await repos.exams.find(examId), 'exam');
      const cls = required(await repos.classes.findClass(classId), 'class');
      const existing = await repos.exams.listSubjects(examId, classId);
      const bySubject = new Map(existing.map((r) => [r.subjectId, r]));
      const issues: { path: string; message: string }[] = [];

      for (const [i, row] of input.subjects.entries()) {
        const subject = await repos.subjects.find(row.subjectId);
        if (!subject)
          issues.push({
            path: `body.subjects.${i}.subjectId`,
            message: 'That subject was not found.',
          });
        else if (subject.status !== 'ACTIVE' && !bySubject.has(row.subjectId)) {
          issues.push({
            path: `body.subjects.${i}.subjectId`,
            message: `${subject.name} is inactive and cannot be added.`,
          });
        }
        if (row.gradeSchemeId && !(await repos.gradeSchemes.find(row.gradeSchemeId))) {
          issues.push({
            path: `body.subjects.${i}.gradeSchemeId`,
            message: 'That grade scale was not found.',
          });
        }
      }
      if (cls.status !== 'ACTIVE' && input.subjects.some((r) => !bySubject.has(r.subjectId))) {
        issues.push({
          path: 'body.subjects',
          message: `${cls.name} is inactive; subjects cannot be added to it.`,
        });
      }
      if (issues.length) throw new ValidationError(issues);

      const keep = new Set(input.subjects.map((r) => r.subjectId));
      for (const row of existing)
        if (!keep.has(row.subjectId)) await repos.exams.deleteSubject(row.id);
      for (const row of input.subjects) {
        const values = {
          theoryMax: row.theoryMax,
          internalMax: row.internalMax ?? null,
          practicalMax: row.practicalMax ?? null,
          passMarks: row.passMarks,
          normalizedMax: row.normalizedMax ?? null,
          includeInResult: row.includeInResult,
          gradeSchemeId: row.gradeSchemeId ?? null,
        };
        const current = bySubject.get(row.subjectId);
        if (current) await repos.exams.updateSubject(current.id, values, now);
        else
          await repos.exams.insertSubject(
            { id: newId(), examId, classId, subjectId: row.subjectId, ...values },
            now,
          );
      }
      await audit({
        action: 'config.exam_subjects.updated',
        entityType: 'exam',
        entityId: examId,
        before: { classId, subjects: existing },
        after: { classId, subjects: input.subjects },
      });
    });
    return this.subjectViews(examId, classId);
  }
}

// ---------------------------------------------------------------------------
// Behaviour & achievement categories, rating labels
// ---------------------------------------------------------------------------

export class CategoryService extends ConfigService {
  constructor(
    deps: ConfigServiceDeps,
    private readonly kind: 'behaviour' | 'achievement',
    private readonly pick: (repos: Repositories) => CategoryRepository,
  ) {
    super(deps);
  }

  async list(ctx: RequestContext): Promise<CategoryView[]> {
    this.authorize(ctx);
    return this.pick(this.repos).list();
  }

  async create(
    ctx: RequestContext,
    input: z.output<typeof CategoryCreateSchema>,
  ): Promise<CategoryView> {
    const record = {
      id: newId(),
      name: input.name,
      description: input.description,
      displayOrder: input.displayOrder,
      status: 'ACTIVE' as const,
    };
    await this.write(ctx, async ({ repos, now, audit }) => {
      const repo = this.pick(repos);
      const clash = await repo.findByName(input.name);
      if (clash)
        throw fieldConflict(
          'name',
          `A ${this.kind} category named "${clash.name}" already exists.`,
        );
      await repo.create(record, now);
      await audit({
        action: `config.${this.kind}_category.created`,
        entityType: `${this.kind}_category`,
        entityId: record.id,
        after: record,
      });
    });
    return record;
  }

  async update(
    ctx: RequestContext,
    id: string,
    input: z.output<typeof CategoryUpdateSchema>,
  ): Promise<CategoryView> {
    let after: CategoryView | undefined;
    await this.write(ctx, async ({ repos, now, audit }) => {
      const repo = this.pick(repos);
      const before = required(await repo.find(id), `${this.kind} category`);
      if (input.name !== undefined) {
        const clash = await repo.findByName(input.name);
        if (clash && clash.id !== id)
          throw fieldConflict(
            'name',
            `A ${this.kind} category named "${clash.name}" already exists.`,
          );
      }
      const changes = defined(input);
      await repo.update(id, changes, now);
      after = { ...before, ...changes } as CategoryView;
      await audit({
        action: `config.${this.kind}_category.updated`,
        entityType: `${this.kind}_category`,
        entityId: id,
        before,
        after,
      });
    });
    return after!;
  }
}

export class BehaviourConfigService extends CategoryService {
  constructor(deps: ConfigServiceDeps) {
    super(deps, 'behaviour', (repos) => repos.behaviourCategories);
  }

  async getAll(ctx: RequestContext): Promise<BehaviourConfigView> {
    const categories = await this.list(ctx);
    return { categories, ratingLabels: await this.labelViews() };
  }

  private async labelViews() {
    const stored = new Map((await this.repos.ratingLabels.list()).map((l) => [l.rating, l]));
    return RATING_VALUES.map((rating) => ({
      rating,
      label: stored.get(rating)?.label ?? null,
      description: stored.get(rating)?.description ?? null,
    }));
  }

  async setLabels(ctx: RequestContext, input: z.output<typeof RatingLabelsUpdateSchema>) {
    await this.write(ctx, async ({ repos, now, audit }) => {
      const before = await repos.ratingLabels.list();
      const labels = [...input.labels].sort((a, b) => a.rating - b.rating);
      await repos.ratingLabels.replaceAll(labels, now);
      await audit({
        action: 'config.behaviour_labels.updated',
        entityType: 'behaviour_labels',
        entityId: null,
        before,
        after: labels,
      });
    });
    return this.labelViews();
  }
}

// ---------------------------------------------------------------------------
// Role permissions (requires `permissions.manage`)
// ---------------------------------------------------------------------------

export class PermissionConfigService extends ConfigService {
  protected override readonly permission: Permission = 'permissions.manage';

  constructor(
    deps: ConfigServiceDeps,
    private readonly runtime: RolePermissionService,
  ) {
    super(deps);
  }

  async get(ctx: RequestContext): Promise<PermissionsView> {
    this.authorize(ctx);
    const table = await this.runtime.table();
    return {
      admin: [...PERMISSIONS],
      roles: CONFIGURABLE_ROLES.map((role) => ({
        role,
        defaults: [...ROLE_PERMISSIONS[role]],
        effective: PERMISSIONS.filter((p) => table[role].has(p)),
        grantable: grantableTo(role),
      })),
    };
  }

  /**
   * Set what a role holds. Anything outside the role's ceiling is REJECTED (never silently
   * dropped), so it is impossible to grant administrator powers through this screen or the API.
   */
  async setRole(
    ctx: RequestContext,
    role: ConfigurableRole,
    permissions: Permission[],
  ): Promise<PermissionsView> {
    this.authorize(ctx);
    const ceiling = new Set(grantableTo(role));
    const forbidden = permissions.filter((p) => !ceiling.has(p));
    if (forbidden.length) {
      throw new ValidationError(
        forbidden.map((p) => ({
          path: 'body.permissions',
          message: `"${PERMISSION_INFO[p].label}" cannot be given to this role.`,
        })),
      );
    }
    const desired = new Set(permissions);
    const defaults = new Set(ROLE_PERMISSIONS[role]);
    const overrides: PermissionOverride[] = [
      ...[...desired]
        .filter((p) => !defaults.has(p))
        .map((p) => ({ role, permission: p, effect: 'GRANT' as const })),
      ...[...defaults]
        .filter((p) => !desired.has(p))
        .map((p) => ({ role, permission: p, effect: 'REVOKE' as const })),
    ];
    await this.write(ctx, async ({ repos, now, audit }) => {
      const before = (await repos.rolePermissions.list()).filter((o) => o.role === role);
      await repos.rolePermissions.replaceForRole(
        role,
        overrides,
        ctx.principal?.userId ?? null,
        now,
      );
      await audit({
        action: 'config.permissions.updated',
        entityType: 'role_permissions',
        entityId: role,
        before: { overrides: before },
        after: { overrides, effective: PERMISSIONS.filter((p) => desired.has(p)) },
      });
    });
    this.runtime.invalidate();
    return this.get(ctx);
  }
}
