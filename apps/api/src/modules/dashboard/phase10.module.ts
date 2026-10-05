import {
  AnnouncementCreateSchema,
  AnnouncementFeedQuerySchema,
  AnnouncementInputSchema,
  AnnouncementListQuerySchema,
  IdSchema,
  RequestAssignSchema,
  RequestCreateSchema,
  RequestListQuerySchema,
  RequestStatusChangeSchema,
} from '@ttlmhss/shared';
import { z } from 'zod';
import type { AppDependencies } from '../../app-dependencies.js';
import { AUTHENTICATED, requires } from '../../core/auth/access.js';
import type { FeatureModule } from '../../core/http/module.js';
import { defineRoute, type RouteContext } from '../../core/http/routes.js';
import { AnnouncementService } from '../announcements/announcement.service.js';
import type { RequestContext } from '../marks/marks-context.js';
import { RequestService } from '../requests/request.service.js';
import { DashboardService } from './dashboard.service.js';

const ctxOf = (c: RouteContext<unknown, unknown, unknown>): RequestContext => ({
  principal: c.principal,
  requestId: c.request.id,
});
const Id = z.object({ id: IdSchema });

/**
 * Phase 10 — dashboards, announcements and structured requests.
 *   /dashboard        the caller's role dashboard (built from the existing services)
 *   /announcements/…  feed (own audience), management (administrators; class teachers own section)
 *   /requests/…       students: own requests; reviewers: scoped list and workflow
 */
export function phase10Module(deps: AppDependencies): FeatureModule {
  const base = { dataStore: deps.dataStore, clock: deps.clock, authorization: deps.authorization };
  const dashboard = new DashboardService(base);
  const announcements = new AnnouncementService(base);
  const requests = new RequestService(base);
  return {
    name: 'phase10',
    routes: [
      // ---- Dashboard -------------------------------------------------------------------------
      defineRoute({
        method: 'GET',
        url: '/dashboard',
        access: AUTHENTICATED,
        handler: (c) => dashboard.view(ctxOf(c)),
      }),
      // ---- Announcements ---------------------------------------------------------------------
      defineRoute({
        method: 'GET',
        url: '/announcements/feed',
        access: requires('announcements.view'),
        schema: { query: AnnouncementFeedQuerySchema },
        handler: (c) => announcements.feed(ctxOf(c), c.query),
      }),
      defineRoute({
        method: 'GET',
        url: '/announcements/options',
        access: requires('announcements.manage'),
        handler: (c) => announcements.options(ctxOf(c)),
      }),
      defineRoute({
        method: 'GET',
        url: '/announcements',
        access: requires('announcements.manage'),
        schema: { query: AnnouncementListQuerySchema },
        handler: (c) => announcements.list(ctxOf(c), c.query),
      }),
      defineRoute({
        method: 'POST',
        url: '/announcements',
        access: requires('announcements.manage'),
        successStatus: 201,
        schema: { body: AnnouncementCreateSchema },
        handler: (c) => announcements.create(ctxOf(c), c.body),
      }),
      defineRoute({
        method: 'GET',
        url: '/announcements/:id',
        access: requires('announcements.view'),
        schema: { params: Id },
        handler: (c) => announcements.get(ctxOf(c), c.params.id),
      }),
      defineRoute({
        method: 'PUT',
        url: '/announcements/:id',
        access: requires('announcements.manage'),
        schema: { params: Id, body: AnnouncementInputSchema },
        handler: (c) => announcements.update(ctxOf(c), c.params.id, c.body),
      }),
      defineRoute({
        method: 'POST',
        url: '/announcements/:id/publish',
        access: requires('announcements.manage'),
        schema: { params: Id },
        handler: (c) => announcements.publish(ctxOf(c), c.params.id),
      }),
      defineRoute({
        method: 'POST',
        url: '/announcements/:id/archive',
        access: requires('announcements.manage'),
        schema: { params: Id },
        handler: (c) => announcements.setArchived(ctxOf(c), c.params.id, true),
      }),
      defineRoute({
        method: 'POST',
        url: '/announcements/:id/restore',
        access: requires('announcements.manage'),
        schema: { params: Id },
        handler: (c) => announcements.setArchived(ctxOf(c), c.params.id, false),
      }),
      // ---- Requests --------------------------------------------------------------------------
      defineRoute({
        method: 'GET',
        url: '/requests/mine',
        access: requires('requests.view'),
        schema: { query: RequestListQuerySchema },
        handler: (c) => requests.mine(ctxOf(c), c.query),
      }),
      defineRoute({
        method: 'GET',
        url: '/requests/options',
        access: requires('requests.create'),
        handler: (c) => requests.formOptions(ctxOf(c)),
      }),
      defineRoute({
        method: 'POST',
        url: '/requests',
        access: requires('requests.create'),
        successStatus: 201,
        schema: { body: RequestCreateSchema },
        handler: (c) => requests.create(ctxOf(c), c.body),
      }),
      defineRoute({
        method: 'GET',
        url: '/requests',
        access: requires('requests.view'),
        schema: { query: RequestListQuerySchema },
        handler: (c) => requests.list(ctxOf(c), c.query),
      }),
      defineRoute({
        method: 'GET',
        url: '/requests/:id',
        access: requires('requests.view'),
        schema: { params: Id },
        handler: (c) => requests.get(ctxOf(c), c.params.id),
      }),
      defineRoute({
        method: 'POST',
        url: '/requests/:id/status',
        access: requires('requests.handle'),
        schema: { params: Id, body: RequestStatusChangeSchema },
        handler: (c) => requests.changeStatus(ctxOf(c), c.params.id, c.body),
      }),
      defineRoute({
        method: 'POST',
        url: '/requests/:id/assign',
        access: requires('requests.handle'),
        schema: { params: Id, body: RequestAssignSchema },
        handler: (c) => requests.assign(ctxOf(c), c.params.id, c.body),
      }),
    ],
  };
}
