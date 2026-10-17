import {
  IdSchema,
  TimetableChangesSchema,
  TimetableLessonsQuerySchema,
  TimetableRequestCreateSchema,
  TimetableRequestDeclineSchema,
  TimetableRequestListQuerySchema,
  TimetableRequestReviewSchema,
  TimetableRequestWithdrawSchema,
  TimetableSectionQuerySchema,
  TimetableYearQuerySchema,
} from '@ttlmhss/shared';
import { z } from 'zod';
import type { AppDependencies } from '../../app-dependencies.js';
import { requires } from '../../core/auth/access.js';
import type { FeatureModule } from '../../core/http/module.js';
import { CHANGE_REQUEST_LIMIT } from '../../core/http/rate-limits.js';
import { defineRoute, type RouteContext } from '../../core/http/routes.js';
import { TimetableChangeRequestService } from './change-request.service.js';
import { TimetableEditorService } from './timetable-editor.service.js';
import type { RequestContext, TimetableServiceDeps } from './timetable-service.js';
import { TimetableViewService } from './timetable-view.service.js';

const YearParam = z.object({ yearId: IdSchema });
const YearSectionParams = z.object({ yearId: IdSchema, sectionId: IdSchema });
const YearTeacherParams = z.object({ yearId: IdSchema, teacherId: IdSchema });
const StudentParam = z.object({ studentId: IdSchema });
const IdParam = z.object({ id: IdSchema });
const OptionalYear = z.object({ academicYearId: IdSchema.optional() });

const ctxOf = (c: RouteContext<unknown, unknown, unknown>): RequestContext => ({
  principal: c.principal,
  requestId: c.request.id,
});

/**
 * Timetable API (Phase 6). Editing (`/timetable/years/:yearId/draft…`) needs `timetable.manage`
 * (Class Teachers only within their own sections — checked in the service), publishing and
 * discarding need `timetable.publish` (administrators). Views need `timetable.view` and are scoped
 * in the service.
 */
export function timetableModule(deps: AppDependencies): FeatureModule {
  const base: TimetableServiceDeps = {
    dataStore: deps.dataStore,
    clock: deps.clock,
    authorization: deps.authorization,
  };
  const editor = new TimetableEditorService(base);
  const views = new TimetableViewService(base);
  const requests = new TimetableChangeRequestService(base);

  return {
    name: 'timetable',
    routes: [
      // ---- Editing -----------------------------------------------------------------------------
      defineRoute({
        method: 'GET',
        url: '/timetable/years/:yearId/editor',
        access: requires('timetable.manage'),
        schema: { params: YearParam, query: TimetableSectionQuerySchema },
        handler: (c) => editor.editor(ctxOf(c), c.params.yearId, c.query.sectionId),
      }),
      defineRoute({
        method: 'GET',
        url: '/timetable/years/:yearId/options',
        access: requires('timetable.manage'),
        schema: { params: YearParam },
        handler: (c) => editor.options(ctxOf(c), c.params.yearId),
      }),
      defineRoute({
        method: 'GET',
        url: '/timetable/years/:yearId/versions',
        access: requires('timetable.manage'),
        schema: { params: YearParam },
        handler: (c) => editor.versions(ctxOf(c), c.params.yearId),
      }),
      defineRoute({
        method: 'POST',
        url: '/timetable/years/:yearId/draft',
        access: requires('timetable.manage'),
        successStatus: 201,
        schema: { params: YearParam },
        handler: (c) => editor.startDraft(ctxOf(c), c.params.yearId),
      }),
      defineRoute({
        method: 'POST',
        url: '/timetable/years/:yearId/draft/changes',
        access: requires('timetable.manage'),
        schema: { params: YearParam, body: TimetableChangesSchema },
        handler: (c) => editor.applyChanges(ctxOf(c), c.params.yearId, c.body),
      }),
      defineRoute({
        method: 'POST',
        url: '/timetable/years/:yearId/draft/publish',
        access: requires('timetable.publish'),
        schema: { params: YearParam },
        handler: (c) => editor.publish(ctxOf(c), c.params.yearId),
      }),
      defineRoute({
        method: 'DELETE',
        url: '/timetable/years/:yearId/draft',
        access: requires('timetable.publish'),
        schema: { params: YearParam },
        handler: async (c) => {
          await editor.discardDraft(ctxOf(c), c.params.yearId);
          return { deleted: true } as const;
        },
      }),

      // ---- Change requests (Phase 12C): class teachers ask, administrators review ----------------
      defineRoute({
        method: 'GET',
        url: '/timetable/change-requests/options',
        access: requires('timetable.view'),
        schema: { query: OptionalYear },
        handler: (c) => requests.options(ctxOf(c), c.query.academicYearId),
      }),
      defineRoute({
        method: 'GET',
        url: '/timetable/change-requests',
        access: requires('timetable.view'),
        schema: { query: TimetableRequestListQuerySchema },
        handler: (c) => requests.list(ctxOf(c), c.query),
      }),
      defineRoute({
        method: 'GET',
        url: '/timetable/change-requests/:id',
        access: requires('timetable.view'),
        schema: { params: IdParam },
        handler: (c) => requests.get(ctxOf(c), c.params.id),
      }),
      defineRoute({
        method: 'POST',
        url: '/timetable/change-requests',
        access: requires('timetable.view'),
        rateLimit: CHANGE_REQUEST_LIMIT,
        successStatus: 201,
        schema: { body: TimetableRequestCreateSchema },
        handler: (c) => requests.create(ctxOf(c), c.body),
      }),
      defineRoute({
        method: 'POST',
        url: '/timetable/change-requests/:id/withdraw',
        access: requires('timetable.view'),
        schema: { params: IdParam, body: TimetableRequestWithdrawSchema },
        handler: (c) => requests.withdraw(ctxOf(c), c.params.id, c.body),
      }),
      defineRoute({
        method: 'POST',
        url: '/timetable/change-requests/:id/approve',
        access: requires('timetable.publish'),
        schema: { params: IdParam, body: TimetableRequestReviewSchema },
        handler: (c) => requests.approve(ctxOf(c), c.params.id, c.body),
      }),
      defineRoute({
        method: 'POST',
        url: '/timetable/change-requests/:id/decline',
        access: requires('timetable.publish'),
        schema: { params: IdParam, body: TimetableRequestDeclineSchema },
        handler: (c) => requests.decline(ctxOf(c), c.params.id, c.body),
      }),

      // ---- Published views ----------------------------------------------------------------------
      defineRoute({
        method: 'GET',
        url: '/timetable/years',
        access: requires('timetable.view'),
        handler: (c) => views.years(ctxOf(c)),
      }),
      defineRoute({
        method: 'GET',
        url: '/timetable/years/:yearId/sections',
        access: requires('timetable.view'),
        schema: { params: YearParam },
        handler: (c) => views.viewableSections(ctxOf(c), c.params.yearId),
      }),
      defineRoute({
        method: 'GET',
        url: '/timetable/years/:yearId/sections/:sectionId',
        access: requires('timetable.view'),
        schema: { params: YearSectionParams },
        handler: (c) => views.classTimetable(ctxOf(c), c.params.yearId, c.params.sectionId),
      }),
      defineRoute({
        method: 'GET',
        url: '/timetable/years/:yearId/teachers/:teacherId',
        access: requires('timetable.view'),
        schema: { params: YearTeacherParams },
        handler: (c) => views.teacherTimetable(ctxOf(c), c.params.yearId, c.params.teacherId),
      }),
      defineRoute({
        method: 'GET',
        url: '/timetable/me',
        access: requires('timetable.view'),
        schema: { query: TimetableYearQuerySchema },
        handler: (c) => views.myTimetable(ctxOf(c), c.query.academicYearId),
      }),
      defineRoute({
        method: 'GET',
        url: '/timetable/students/:studentId',
        access: requires('timetable.view'),
        schema: { params: StudentParam, query: TimetableYearQuerySchema },
        handler: (c) =>
          views.studentTimetable(ctxOf(c), c.params.studentId, c.query.academicYearId),
      }),
      defineRoute({
        method: 'GET',
        url: '/timetable/lessons',
        access: requires('timetable.view'),
        schema: { query: TimetableLessonsQuerySchema },
        handler: (c) => views.lessons(ctxOf(c), c.query.date, c.query.teacherId),
      }),
    ],
  };
}
