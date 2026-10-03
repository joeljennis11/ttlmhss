import { CalendarEntryInputSchema, CalendarYearParamSchema, IdSchema } from '@ttlmhss/shared';
import { z } from 'zod';
import type { AppDependencies } from '../../app-dependencies.js';
import { requires } from '../../core/auth/access.js';
import type { FeatureModule } from '../../core/http/module.js';
import { defineRoute, type RouteContext } from '../../core/http/routes.js';
import { CalendarService, type RequestContext } from './calendar.service.js';

const Id = z.object({ id: IdSchema });
const MANAGE = requires('config.manage');

const ctxOf = (c: RouteContext<unknown, unknown, unknown>): RequestContext => ({
  principal: c.principal,
  requestId: c.request.id,
});

/**
 * Academic calendar administration (Phase 8A) — School setup, administrators only. Other features
 * do not call these routes: they ask `CalendarResolver` on the server.
 */
export function calendarModule(deps: AppDependencies): FeatureModule {
  const calendar = new CalendarService({
    dataStore: deps.dataStore,
    clock: deps.clock,
    authorization: deps.authorization,
  });
  return {
    name: 'calendar',
    routes: [
      defineRoute({
        method: 'GET',
        url: '/admin/academic-years/:yearId/calendar',
        access: MANAGE,
        schema: { params: CalendarYearParamSchema },
        handler: (c) => calendar.get(ctxOf(c), c.params.yearId),
      }),
      defineRoute({
        method: 'POST',
        url: '/admin/academic-years/:yearId/calendar',
        access: MANAGE,
        successStatus: 201,
        schema: { params: CalendarYearParamSchema, body: CalendarEntryInputSchema },
        handler: (c) => calendar.create(ctxOf(c), c.params.yearId, c.body),
      }),
      defineRoute({
        method: 'PUT',
        url: '/admin/calendar-entries/:id',
        access: MANAGE,
        schema: { params: Id, body: CalendarEntryInputSchema },
        handler: (c) => calendar.update(ctxOf(c), c.params.id, c.body),
      }),
      defineRoute({
        method: 'DELETE',
        url: '/admin/calendar-entries/:id',
        access: MANAGE,
        schema: { params: Id },
        handler: (c) => calendar.remove(ctxOf(c), c.params.id),
      }),
    ],
  };
}
