import {
  ClassTeacherAssignSchema,
  IdSchema,
  PromotionCandidatesQuerySchema,
  PromotionRequestSchema,
  StatusChangeSchema,
  StudentAdmissionSchema,
  StudentDetailsSchema,
  StudentListQuerySchema,
  StudentPlacementSchema,
  StudentTransferSchema,
  TeacherCreateSchema,
  TeacherDetailsSchema,
  TeacherListQuerySchema,
  TeacherSubjectAssignSchema,
} from '@ttlmhss/shared';
import { z } from 'zod';
import type { AppDependencies } from '../../app-dependencies.js';
import { requires } from '../../core/auth/access.js';
import type { FeatureModule } from '../../core/http/module.js';
import { defineRoute, type RouteContext } from '../../core/http/routes.js';
import { createAccountCredentialsService } from '../../composition.js';
import type { PeopleServiceDeps, RequestContext } from './people-service.js';
import { PromotionService } from './promotion.service.js';
import { StudentService } from './student.service.js';
import { ClassTeacherService, TeacherService } from './teacher.service.js';

const Id = z.object({ id: IdSchema });
const TeacherSubjectParams = z.object({ id: IdSchema, subjectId: IdSchema });
const YearQuery = z.object({ academicYearId: IdSchema });

const ctxOf = (c: RouteContext<unknown, unknown, unknown>): RequestContext => ({
  principal: c.principal,
  requestId: c.request.id,
});
const deleted = { deleted: true } as const;

/** One-time credentials must never be cached by the browser or a proxy. */
const noStore = (c: RouteContext<unknown, unknown, unknown>) => {
  c.reply.header('Cache-Control', 'no-store');
  c.reply.header('Pragma', 'no-cache');
};

/**
 * Student & teacher management API (Phase 5). Each route names the permission it needs; each
 * service method checks it again (and applies record scope where it exists).
 */
export function peopleModule(deps: AppDependencies): FeatureModule {
  const base: PeopleServiceDeps = {
    dataStore: deps.dataStore,
    clock: deps.clock,
    authorization: deps.authorization,
    accounts: createAccountCredentialsService(deps),
    sessions: deps.sessions,
  };
  const students = new StudentService(base);
  const promotion = new PromotionService(base);
  const teachers = new TeacherService(base);
  const classTeachers = new ClassTeacherService(base);

  return {
    name: 'people',
    routes: [
      // ---- Students -----------------------------------------------------------------------------
      defineRoute({
        method: 'GET',
        url: '/admin/students',
        access: requires('students.view'),
        schema: { query: StudentListQuerySchema },
        handler: (c) => students.list(ctxOf(c), c.query),
      }),
      defineRoute({
        method: 'POST',
        url: '/admin/students',
        access: requires('students.create'),
        successStatus: 201,
        schema: { body: StudentAdmissionSchema },
        handler: (c) => students.admit(ctxOf(c), c.body),
      }),
      defineRoute({
        method: 'GET',
        url: '/admin/students/:id',
        access: requires('students.view'),
        schema: { params: Id },
        handler: (c) => students.get(ctxOf(c), c.params.id),
      }),
      defineRoute({
        method: 'PUT',
        url: '/admin/students/:id',
        access: requires('students.edit'),
        schema: { params: Id, body: StudentDetailsSchema },
        handler: (c) => students.update(ctxOf(c), c.params.id, c.body),
      }),
      defineRoute({
        method: 'POST',
        url: '/admin/students/:id/status',
        access: requires('students.deactivate'),
        schema: { params: Id, body: StatusChangeSchema },
        handler: (c) => students.setStatus(ctxOf(c), c.params.id, c.body.status, c.body.note),
      }),
      defineRoute({
        method: 'POST',
        url: '/admin/students/:id/transfer',
        access: requires('students.transfer'),
        schema: { params: Id, body: StudentTransferSchema },
        handler: (c) => students.transfer(ctxOf(c), c.params.id, c.body),
      }),
      defineRoute({
        method: 'POST',
        url: '/admin/students/:id/placements',
        access: requires('students.transfer'),
        successStatus: 201,
        schema: { params: Id, body: StudentPlacementSchema },
        handler: (c) => students.place(ctxOf(c), c.params.id, c.body),
      }),
      defineRoute({
        method: 'DELETE',
        url: '/admin/students/:id',
        access: requires('students.delete'),
        schema: { params: Id },
        handler: async (c) => (await students.remove(ctxOf(c), c.params.id), deleted),
      }),
      defineRoute({
        method: 'POST',
        url: '/admin/students/:id/temporary-password',
        access: requires('users.reset_password'),
        schema: { params: Id },
        handler: (c) => (noStore(c), students.issueTemporaryPassword(ctxOf(c), c.params.id)),
      }),

      // ---- Promotion ----------------------------------------------------------------------------
      defineRoute({
        method: 'GET',
        url: '/admin/promotions/candidates',
        access: requires('students.promote'),
        schema: { query: PromotionCandidatesQuerySchema },
        handler: (c) => promotion.candidates(ctxOf(c), c.query),
      }),
      defineRoute({
        method: 'POST',
        url: '/admin/promotions',
        access: requires('students.promote'),
        schema: { body: PromotionRequestSchema },
        handler: (c) => promotion.promote(ctxOf(c), c.body),
      }),

      // ---- Teachers -----------------------------------------------------------------------------
      defineRoute({
        method: 'GET',
        url: '/admin/teachers',
        access: requires('teachers.view'),
        schema: { query: TeacherListQuerySchema },
        handler: (c) => teachers.list(ctxOf(c), c.query),
      }),
      defineRoute({
        method: 'GET',
        url: '/admin/teachers/designations',
        access: requires('teachers.view'),
        handler: (c) => teachers.designations(ctxOf(c)),
      }),
      defineRoute({
        method: 'POST',
        url: '/admin/teachers',
        access: requires('teachers.create'),
        successStatus: 201,
        schema: { body: TeacherCreateSchema },
        handler: (c) => teachers.create(ctxOf(c), c.body),
      }),
      defineRoute({
        method: 'GET',
        url: '/admin/teachers/:id',
        access: requires('teachers.view'),
        schema: { params: Id },
        handler: (c) => teachers.get(ctxOf(c), c.params.id),
      }),
      defineRoute({
        method: 'PUT',
        url: '/admin/teachers/:id',
        access: requires('teachers.edit'),
        schema: { params: Id, body: TeacherDetailsSchema },
        handler: (c) => teachers.update(ctxOf(c), c.params.id, c.body),
      }),
      defineRoute({
        method: 'POST',
        url: '/admin/teachers/:id/status',
        access: requires('teachers.deactivate'),
        schema: { params: Id, body: StatusChangeSchema },
        handler: (c) => teachers.setStatus(ctxOf(c), c.params.id, c.body.status),
      }),
      defineRoute({
        method: 'DELETE',
        url: '/admin/teachers/:id',
        access: requires('teachers.delete'),
        schema: { params: Id },
        handler: async (c) => (await teachers.remove(ctxOf(c), c.params.id), deleted),
      }),
      defineRoute({
        method: 'POST',
        url: '/admin/teachers/:id/subjects',
        access: requires('teacher_subjects.manage'),
        successStatus: 201,
        schema: { params: Id, body: TeacherSubjectAssignSchema },
        handler: (c) => teachers.assignSubject(ctxOf(c), c.params.id, c.body.subjectId),
      }),
      defineRoute({
        method: 'DELETE',
        url: '/admin/teachers/:id/subjects/:subjectId',
        access: requires('teacher_subjects.manage'),
        schema: { params: TeacherSubjectParams },
        handler: (c) => teachers.removeSubject(ctxOf(c), c.params.id, c.params.subjectId),
      }),
      defineRoute({
        method: 'POST',
        url: '/admin/teachers/:id/temporary-password',
        access: requires('users.reset_password'),
        schema: { params: Id },
        handler: (c) => (noStore(c), teachers.issueTemporaryPassword(ctxOf(c), c.params.id)),
      }),

      // ---- Class teachers -----------------------------------------------------------------------
      defineRoute({
        method: 'GET',
        url: '/admin/class-teachers',
        access: requires('class_teacher_assignments.view'),
        schema: { query: YearQuery },
        handler: (c) => classTeachers.board(ctxOf(c), c.query.academicYearId),
      }),
      defineRoute({
        method: 'POST',
        url: '/admin/class-teachers',
        access: requires('class_teacher_assignments.manage'),
        successStatus: 201,
        schema: { body: ClassTeacherAssignSchema },
        handler: (c) => classTeachers.assign(ctxOf(c), c.body),
      }),
      defineRoute({
        method: 'POST',
        url: '/admin/class-teachers/:id/end',
        access: requires('class_teacher_assignments.manage'),
        schema: { params: Id },
        handler: (c) => classTeachers.end(ctxOf(c), c.params.id),
      }),
    ],
  };
}
