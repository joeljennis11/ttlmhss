import {
  AcademicYearCreateSchema,
  AcademicYearUpdateSchema,
  AttendancePolicyUpdateSchema,
  CategoryCreateSchema,
  CategoryUpdateSchema,
  ClassCreateSchema,
  ClassUpdateSchema,
  ConfigurableRoleSchema,
  CopyDayStructureSchema,
  ExamCreateSchema,
  ExamSubjectsUpdateSchema,
  ExamUpdateSchema,
  GradeSchemeInputSchema,
  IdSchema,
  PeriodCreateSchema,
  PeriodUpdateSchema,
  RatingLabelsUpdateSchema,
  RolePermissionsUpdateSchema,
  SchoolSettingsUpdateSchema,
  SectionCreateSchema,
  SectionUpdateSchema,
  SubjectCreateSchema,
  SubjectUpdateSchema,
  WorkingDaysUpdateSchema,
} from '@ttlmhss/shared';
import { z } from 'zod';
import type { AppDependencies } from '../../app-dependencies.js';
import { requires } from '../../core/auth/access.js';
import type { FeatureModule } from '../../core/http/module.js';
import { defineRoute, type RouteContext } from '../../core/http/routes.js';
import type { ConfigServiceDeps, RequestContext } from './config-service.js';
import {
  BehaviourConfigService,
  CategoryService,
  ExamService,
  PermissionConfigService,
} from './exams-and-categories.services.js';
import {
  AttendancePolicyService,
  DayStructureService,
  GradeSchemeService,
} from './schedule-and-rules.services.js';
import {
  AcademicYearService,
  ClassService,
  SchoolSettingsService,
  SubjectService,
} from './school-structure.services.js';

const Id = z.object({ id: IdSchema });
const YearParam = z.object({ yearId: IdSchema });
const ExamClassParams = z.object({ examId: IdSchema, classId: IdSchema });
const RoleParam = z.object({ role: ConfigurableRoleSchema });
const YearQuery = z.object({ academicYearId: IdSchema });

const MANAGE = requires('config.manage');
const ctxOf = (c: RouteContext<unknown, unknown, unknown>): RequestContext => ({
  principal: c.principal,
  requestId: c.request.id,
});
const deleted = { deleted: true } as const;

/**
 * Admin configuration API (Phase 4). Every route requires `config.manage` — or
 * `permissions.manage` for role permissions — and every service method checks it again.
 */
export function configModule(deps: AppDependencies): FeatureModule {
  const base: ConfigServiceDeps = {
    dataStore: deps.dataStore,
    clock: deps.clock,
    authorization: deps.authorization,
  };
  const school = new SchoolSettingsService(base);
  const years = new AcademicYearService(base);
  const classes = new ClassService(base);
  const subjects = new SubjectService(base);
  const day = new DayStructureService(base, years);
  const attendance = new AttendancePolicyService(base);
  const grading = new GradeSchemeService(base);
  const exams = new ExamService(base);
  const behaviour = new BehaviourConfigService(base);
  const achievements = new CategoryService(
    base,
    'achievement',
    (repos) => repos.achievementCategories,
  );
  const permissions = new PermissionConfigService(base, deps.rolePermissions);

  return {
    name: 'config',
    routes: [
      // School settings
      defineRoute({
        method: 'GET',
        url: '/admin/school-settings',
        access: MANAGE,
        handler: (c) => school.get(ctxOf(c)),
      }),
      defineRoute({
        method: 'PUT',
        url: '/admin/school-settings',
        access: MANAGE,
        schema: { body: SchoolSettingsUpdateSchema },
        handler: (c) => school.update(ctxOf(c), c.body),
      }),

      // Academic years
      defineRoute({
        method: 'GET',
        url: '/admin/academic-years',
        access: MANAGE,
        handler: (c) => years.list(ctxOf(c)),
      }),
      defineRoute({
        method: 'POST',
        url: '/admin/academic-years',
        access: MANAGE,
        successStatus: 201,
        schema: { body: AcademicYearCreateSchema },
        handler: (c) => years.create(ctxOf(c), c.body),
      }),
      defineRoute({
        method: 'PATCH',
        url: '/admin/academic-years/:id',
        access: MANAGE,
        schema: { params: Id, body: AcademicYearUpdateSchema },
        handler: (c) => years.update(ctxOf(c), c.params.id, c.body),
      }),
      defineRoute({
        method: 'POST',
        url: '/admin/academic-years/:id/make-current',
        access: MANAGE,
        schema: { params: Id },
        handler: (c) => years.makeCurrent(ctxOf(c), c.params.id),
      }),
      defineRoute({
        method: 'PUT',
        url: '/admin/academic-years/:id/working-days',
        access: MANAGE,
        schema: { params: Id, body: WorkingDaysUpdateSchema },
        handler: (c) => years.setWorkingDays(ctxOf(c), c.params.id, c.body.workingDays),
      }),
      defineRoute({
        method: 'DELETE',
        url: '/admin/academic-years/:id',
        access: MANAGE,
        schema: { params: Id },
        handler: async (c) => (await years.remove(ctxOf(c), c.params.id), deleted),
      }),

      // Classes & sections
      defineRoute({
        method: 'GET',
        url: '/admin/classes',
        access: MANAGE,
        handler: (c) => classes.list(ctxOf(c)),
      }),
      defineRoute({
        method: 'POST',
        url: '/admin/classes',
        access: MANAGE,
        successStatus: 201,
        schema: { body: ClassCreateSchema },
        handler: (c) => classes.createClass(ctxOf(c), c.body),
      }),
      defineRoute({
        method: 'PATCH',
        url: '/admin/classes/:id',
        access: MANAGE,
        schema: { params: Id, body: ClassUpdateSchema },
        handler: (c) => classes.updateClass(ctxOf(c), c.params.id, c.body),
      }),
      defineRoute({
        method: 'POST',
        url: '/admin/classes/:id/sections',
        access: MANAGE,
        successStatus: 201,
        schema: { params: Id, body: SectionCreateSchema },
        handler: (c) => classes.createSection(ctxOf(c), c.params.id, c.body),
      }),
      defineRoute({
        method: 'PATCH',
        url: '/admin/sections/:id',
        access: MANAGE,
        schema: { params: Id, body: SectionUpdateSchema },
        handler: (c) => classes.updateSection(ctxOf(c), c.params.id, c.body),
      }),

      // Subjects
      defineRoute({
        method: 'GET',
        url: '/admin/subjects',
        access: MANAGE,
        handler: (c) => subjects.list(ctxOf(c)),
      }),
      defineRoute({
        method: 'POST',
        url: '/admin/subjects',
        access: MANAGE,
        successStatus: 201,
        schema: { body: SubjectCreateSchema },
        handler: (c) => subjects.create(ctxOf(c), c.body),
      }),
      defineRoute({
        method: 'PATCH',
        url: '/admin/subjects/:id',
        access: MANAGE,
        schema: { params: Id, body: SubjectUpdateSchema },
        handler: (c) => subjects.update(ctxOf(c), c.params.id, c.body),
      }),

      // Periods & breaks
      defineRoute({
        method: 'GET',
        url: '/admin/academic-years/:yearId/day-structure',
        access: MANAGE,
        schema: { params: YearParam },
        handler: (c) => day.get(ctxOf(c), c.params.yearId),
      }),
      defineRoute({
        method: 'POST',
        url: '/admin/academic-years/:yearId/periods',
        access: MANAGE,
        successStatus: 201,
        schema: { params: YearParam, body: PeriodCreateSchema },
        handler: (c) => day.create(ctxOf(c), c.params.yearId, c.body),
      }),
      defineRoute({
        method: 'POST',
        url: '/admin/academic-years/:yearId/day-structure/copy',
        access: MANAGE,
        successStatus: 201,
        schema: { params: YearParam, body: CopyDayStructureSchema },
        handler: (c) => day.copy(ctxOf(c), c.params.yearId, c.body.fromAcademicYearId),
      }),
      defineRoute({
        method: 'PATCH',
        url: '/admin/periods/:id',
        access: MANAGE,
        schema: { params: Id, body: PeriodUpdateSchema },
        handler: (c) => day.update(ctxOf(c), c.params.id, c.body),
      }),
      defineRoute({
        method: 'DELETE',
        url: '/admin/periods/:id',
        access: MANAGE,
        schema: { params: Id },
        handler: (c) => day.remove(ctxOf(c), c.params.id),
      }),

      // Attendance locking
      defineRoute({
        method: 'GET',
        url: '/admin/attendance-policy',
        access: MANAGE,
        handler: (c) => attendance.get(ctxOf(c)),
      }),
      defineRoute({
        method: 'PUT',
        url: '/admin/attendance-policy',
        access: MANAGE,
        schema: { body: AttendancePolicyUpdateSchema },
        handler: (c) => attendance.save(ctxOf(c), c.body),
      }),

      // Grade scales
      defineRoute({
        method: 'GET',
        url: '/admin/grade-scales',
        access: MANAGE,
        handler: (c) => grading.list(ctxOf(c)),
      }),
      defineRoute({
        method: 'POST',
        url: '/admin/grade-scales',
        access: MANAGE,
        successStatus: 201,
        schema: { body: GradeSchemeInputSchema },
        handler: (c) => grading.create(ctxOf(c), c.body),
      }),
      defineRoute({
        method: 'PUT',
        url: '/admin/grade-scales/:id',
        access: MANAGE,
        schema: { params: Id, body: GradeSchemeInputSchema },
        handler: (c) => grading.update(ctxOf(c), c.params.id, c.body),
      }),
      defineRoute({
        method: 'DELETE',
        url: '/admin/grade-scales/:id',
        access: MANAGE,
        schema: { params: Id },
        handler: async (c) => (await grading.remove(ctxOf(c), c.params.id), deleted),
      }),

      // Exams
      defineRoute({
        method: 'GET',
        url: '/admin/exams',
        access: MANAGE,
        schema: { query: YearQuery },
        handler: (c) => exams.list(ctxOf(c), c.query.academicYearId),
      }),
      defineRoute({
        method: 'POST',
        url: '/admin/exams',
        access: MANAGE,
        successStatus: 201,
        schema: { body: ExamCreateSchema },
        handler: (c) => exams.create(ctxOf(c), c.body),
      }),
      defineRoute({
        method: 'GET',
        url: '/admin/exams/:id',
        access: MANAGE,
        schema: { params: Id },
        handler: (c) => exams.get(ctxOf(c), c.params.id),
      }),
      defineRoute({
        method: 'PATCH',
        url: '/admin/exams/:id',
        access: MANAGE,
        schema: { params: Id, body: ExamUpdateSchema },
        handler: (c) => exams.update(ctxOf(c), c.params.id, c.body),
      }),
      defineRoute({
        method: 'DELETE',
        url: '/admin/exams/:id',
        access: MANAGE,
        schema: { params: Id },
        handler: async (c) => (await exams.remove(ctxOf(c), c.params.id), deleted),
      }),
      defineRoute({
        method: 'GET',
        url: '/admin/exams/:examId/classes/:classId/subjects',
        access: MANAGE,
        schema: { params: ExamClassParams },
        handler: (c) => exams.getSubjects(ctxOf(c), c.params.examId, c.params.classId),
      }),
      defineRoute({
        method: 'PUT',
        url: '/admin/exams/:examId/classes/:classId/subjects',
        access: MANAGE,
        schema: { params: ExamClassParams, body: ExamSubjectsUpdateSchema },
        handler: (c) => exams.setSubjects(ctxOf(c), c.params.examId, c.params.classId, c.body),
      }),

      // Behaviour
      defineRoute({
        method: 'GET',
        url: '/admin/behaviour',
        access: MANAGE,
        handler: (c) => behaviour.getAll(ctxOf(c)),
      }),
      defineRoute({
        method: 'POST',
        url: '/admin/behaviour/categories',
        access: MANAGE,
        successStatus: 201,
        schema: { body: CategoryCreateSchema },
        handler: (c) => behaviour.create(ctxOf(c), c.body),
      }),
      defineRoute({
        method: 'PATCH',
        url: '/admin/behaviour/categories/:id',
        access: MANAGE,
        schema: { params: Id, body: CategoryUpdateSchema },
        handler: (c) => behaviour.update(ctxOf(c), c.params.id, c.body),
      }),
      defineRoute({
        method: 'PUT',
        url: '/admin/behaviour/rating-labels',
        access: MANAGE,
        schema: { body: RatingLabelsUpdateSchema },
        handler: (c) => behaviour.setLabels(ctxOf(c), c.body),
      }),

      // Achievement categories
      defineRoute({
        method: 'GET',
        url: '/admin/achievement-categories',
        access: MANAGE,
        handler: (c) => achievements.list(ctxOf(c)),
      }),
      defineRoute({
        method: 'POST',
        url: '/admin/achievement-categories',
        access: MANAGE,
        successStatus: 201,
        schema: { body: CategoryCreateSchema },
        handler: (c) => achievements.create(ctxOf(c), c.body),
      }),
      defineRoute({
        method: 'PATCH',
        url: '/admin/achievement-categories/:id',
        access: MANAGE,
        schema: { params: Id, body: CategoryUpdateSchema },
        handler: (c) => achievements.update(ctxOf(c), c.params.id, c.body),
      }),

      // Role permissions
      defineRoute({
        method: 'GET',
        url: '/admin/permissions',
        access: requires('permissions.manage'),
        handler: (c) => permissions.get(ctxOf(c)),
      }),
      defineRoute({
        method: 'PUT',
        url: '/admin/permissions/:role',
        access: requires('permissions.manage'),
        schema: { params: RoleParam, body: RolePermissionsUpdateSchema },
        handler: (c) => permissions.setRole(ctxOf(c), c.params.role, c.body.permissions),
      }),
    ],
  };
}
