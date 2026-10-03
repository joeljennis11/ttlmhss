import {
  AttendanceClassDayQuerySchema,
  AttendanceClassRangeQuerySchema,
  AttendanceDateQuerySchema,
  AttendanceRangeQuerySchema,
  AttendanceRegisterQuerySchema,
  AttendanceSaveSchema,
  AttendanceSessionListQuerySchema,
  AttendanceStudentDayQuerySchema,
  AttendanceStudentDaySaveSchema,
  IdSchema,
} from '@ttlmhss/shared';
import { z } from 'zod';
import type { AppDependencies } from '../../app-dependencies.js';
import { requires } from '../../core/auth/access.js';
import type { FeatureModule } from '../../core/http/module.js';
import { defineRoute, type RouteContext } from '../../core/http/routes.js';
import { AttendanceRegisterService } from './attendance-register.service.js';
import type { AttendanceServiceDeps, RequestContext } from './attendance-service.js';
import { AttendanceViewService } from './attendance-views.service.js';

const StudentParam = z.object({ studentId: IdSchema });
const YearQuery = z.object({ academicYearId: IdSchema });

const ctxOf = (c: RouteContext<unknown, unknown, unknown>): RequestContext => ({
  principal: c.principal,
  requestId: c.request.id,
});

/**
 * Period-wise attendance API (Phase 7). Routes name the broad permission; the services decide the
 * record scope from the authenticated user and the timetable / class-teacher assignments — never
 * from ids in the request.
 */
export function attendanceModule(deps: AppDependencies): FeatureModule {
  const base: AttendanceServiceDeps = {
    dataStore: deps.dataStore,
    clock: deps.clock,
    authorization: deps.authorization,
  };
  const registers = new AttendanceRegisterService(base);
  const views = new AttendanceViewService(base);

  return {
    name: 'attendance',
    routes: [
      // ---- Registers ----------------------------------------------------------------------------
      defineRoute({
        method: 'GET',
        url: '/attendance/register',
        access: requires('attendance.view'),
        schema: { query: AttendanceRegisterQuerySchema },
        handler: (c) =>
          registers.register(ctxOf(c), c.query.date, c.query.periodId, c.query.sectionId),
      }),
      defineRoute({
        method: 'PUT',
        url: '/attendance/register',
        access: requires('attendance.mark'),
        schema: { body: AttendanceSaveSchema },
        handler: (c) => registers.save(ctxOf(c), c.body),
      }),
      defineRoute({
        method: 'GET',
        url: '/attendance/student-day',
        access: requires('attendance.view'),
        schema: { query: AttendanceStudentDayQuerySchema },
        handler: (c) => registers.studentDay(ctxOf(c), c.query.studentId, c.query.date),
      }),
      defineRoute({
        method: 'PUT',
        url: '/attendance/student-day',
        access: requires('attendance.manage'),
        schema: { body: AttendanceStudentDaySaveSchema },
        handler: (c) => registers.saveStudentDay(ctxOf(c), c.body),
      }),

      // ---- Views --------------------------------------------------------------------------------
      defineRoute({
        method: 'GET',
        url: '/attendance/lessons',
        access: requires('attendance.view'),
        schema: { query: AttendanceDateQuerySchema },
        handler: (c) => views.lessons(ctxOf(c), c.query.date, c.query.teacherId),
      }),
      defineRoute({
        method: 'GET',
        url: '/attendance/classes',
        access: requires('attendance.view'),
        schema: { query: YearQuery },
        handler: (c) => views.manageableSections(ctxOf(c), c.query.academicYearId),
      }),
      defineRoute({
        method: 'GET',
        url: '/attendance/class-day',
        access: requires('attendance.view'),
        schema: { query: AttendanceClassDayQuerySchema },
        handler: (c) => views.classDay(ctxOf(c), c.query.sectionId, c.query.date),
      }),
      defineRoute({
        method: 'GET',
        url: '/attendance/class-summary',
        access: requires('attendance.view'),
        schema: { query: AttendanceClassRangeQuerySchema },
        handler: (c) => views.classSummary(ctxOf(c), c.query.sectionId, c.query.from, c.query.to),
      }),
      defineRoute({
        method: 'GET',
        url: '/attendance/students/:studentId',
        access: requires('attendance.view'),
        schema: { params: StudentParam, query: AttendanceRangeQuerySchema },
        handler: (c) =>
          views.studentAttendance(ctxOf(c), c.params.studentId, c.query.from, c.query.to),
      }),
      defineRoute({
        method: 'GET',
        url: '/attendance/me',
        access: requires('attendance.view'),
        schema: { query: AttendanceRangeQuerySchema },
        handler: (c) => views.myAttendance(ctxOf(c), c.query.from, c.query.to),
      }),
      defineRoute({
        method: 'GET',
        url: '/attendance/sessions',
        access: requires('attendance.view'),
        schema: { query: AttendanceSessionListQuerySchema },
        handler: (c) => views.sessions(ctxOf(c), c.query),
      }),
    ],
  };
}
