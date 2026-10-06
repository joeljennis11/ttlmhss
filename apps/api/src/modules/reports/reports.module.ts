import {
  AnnualReportListQuerySchema,
  AnnualReportPrepareSchema,
  AnnualReportQuerySchema,
  AnnualReportRemarkSchema,
  AnnualReportReopenSchema,
  AnnualReportRevisionSchema,
  ClassAttendanceReportQuerySchema,
  ExamReportCardQuerySchema,
  IdSchema,
  MarkSheetReportQuerySchema,
  PerformanceReportQuerySchema,
  PortalQuerySchema,
  StudentAttendanceReportQuerySchema,
} from '@ttlmhss/shared';
import { z } from 'zod';
import type { AppDependencies } from '../../app-dependencies.js';
import { requires } from '../../core/auth/access.js';
import type { FeatureModule } from '../../core/http/module.js';
import { defineRoute, type RouteContext } from '../../core/http/routes.js';
import type { RequestContext } from '../marks/marks-context.js';
import { AnnualReportService } from './annual-report.service.js';
import { ReportService } from './report.service.js';

const ctxOf = (c: RouteContext<unknown, unknown, unknown>): RequestContext => ({
  principal: c.principal,
  requestId: c.request.id,
});
const Id = z.object({ id: IdSchema });

/**
 * Phase 11 — reports. Every endpoint returns the JSON report document (`format=json`, the
 * preview) or the generated file (`format=pdf`, attendance also `format=xlsx`) built from it.
 */
export function reportsModule(deps: AppDependencies): FeatureModule {
  const base = { dataStore: deps.dataStore, clock: deps.clock, authorization: deps.authorization };
  const reports = new ReportService(base);
  const annual = new AnnualReportService(base);
  return {
    name: 'reports',
    routes: [
      defineRoute({
        method: 'GET',
        url: '/reports/options',
        access: requires('reports.view'),
        schema: { query: PortalQuerySchema },
        handler: (c) => reports.options(ctxOf(c), c.query.academicYearId),
      }),
      defineRoute({
        method: 'GET',
        url: '/reports/exam-card',
        access: requires('reports.view'),
        schema: { query: ExamReportCardQuerySchema },
        handler: (c) => reports.examReportCard(ctxOf(c), c.query),
      }),
      defineRoute({
        method: 'GET',
        url: '/reports/mark-sheet',
        access: requires('reports.view'),
        schema: { query: MarkSheetReportQuerySchema },
        handler: (c) => reports.markSheet(ctxOf(c), c.query),
      }),
      defineRoute({
        method: 'GET',
        url: '/reports/attendance/student',
        access: requires('reports.view'),
        schema: { query: StudentAttendanceReportQuerySchema },
        handler: (c) => reports.studentAttendance(ctxOf(c), c.query),
      }),
      defineRoute({
        method: 'GET',
        url: '/reports/attendance/class',
        access: requires('reports.view'),
        schema: { query: ClassAttendanceReportQuerySchema },
        handler: (c) => reports.classAttendance(ctxOf(c), c.query),
      }),
      defineRoute({
        method: 'GET',
        url: '/reports/performance',
        access: requires('reports.view'),
        schema: { query: PerformanceReportQuerySchema },
        handler: (c) => reports.performance(ctxOf(c), c.query),
      }),
      // ---- Annual reports --------------------------------------------------------------------
      defineRoute({
        method: 'GET',
        url: '/reports/annual/section',
        access: requires('reports.generate'),
        schema: { query: AnnualReportListQuerySchema },
        handler: (c) => annual.list(ctxOf(c), c.query.academicYearId, c.query.sectionId),
      }),
      defineRoute({
        method: 'GET',
        url: '/reports/annual/mine',
        access: requires('reports.view'),
        handler: (c) => annual.mine(ctxOf(c)),
      }),
      defineRoute({
        method: 'GET',
        url: '/reports/annual',
        access: requires('reports.view'),
        schema: { query: AnnualReportQuerySchema },
        handler: (c) => annual.view(ctxOf(c), c.query),
      }),
      defineRoute({
        method: 'POST',
        url: '/reports/annual',
        access: requires('reports.generate'),
        successStatus: 201,
        schema: { body: AnnualReportPrepareSchema },
        handler: (c) => annual.prepare(ctxOf(c), c.body.academicYearId, c.body.studentId),
      }),
      defineRoute({
        method: 'PUT',
        url: '/reports/annual/:id/remark',
        access: requires('reports.generate'),
        schema: { params: Id, body: AnnualReportRemarkSchema },
        handler: (c) => annual.setRemark(ctxOf(c), c.params.id, c.body),
      }),
      defineRoute({
        method: 'POST',
        url: '/reports/annual/:id/finalize',
        access: requires('reports.generate'),
        schema: { params: Id, body: AnnualReportRevisionSchema },
        handler: (c) => annual.finalize(ctxOf(c), c.params.id, c.body.revision),
      }),
      defineRoute({
        method: 'POST',
        url: '/reports/annual/:id/publish',
        access: requires('reports.generate'),
        schema: { params: Id, body: AnnualReportRevisionSchema },
        handler: (c) => annual.publish(ctxOf(c), c.params.id, c.body.revision),
      }),
      defineRoute({
        method: 'POST',
        url: '/reports/annual/:id/unpublish',
        access: requires('reports.generate'),
        schema: { params: Id, body: AnnualReportRevisionSchema },
        handler: (c) => annual.unpublish(ctxOf(c), c.params.id, c.body.revision),
      }),
      defineRoute({
        method: 'POST',
        url: '/reports/annual/:id/reopen',
        access: requires('reports.generate'),
        schema: { params: Id, body: AnnualReportReopenSchema },
        handler: (c) => annual.reopen(ctxOf(c), c.params.id, c.body),
      }),
    ],
  };
}
