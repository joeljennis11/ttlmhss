import {
  AchievementCreateSchema,
  AchievementListQuerySchema,
  AchievementUpdateSchema,
  BehaviourSheetKeySchema,
  BehaviourSheetSaveSchema,
  BehaviourSheetSubmitSchema,
  IdSchema,
  PortalQuerySchema,
} from '@ttlmhss/shared';
import { z } from 'zod';
import type { AppDependencies } from '../../app-dependencies.js';
import { requires } from '../../core/auth/access.js';
import type { FeatureModule } from '../../core/http/module.js';
import { defineRoute, type RouteContext } from '../../core/http/routes.js';
import { AchievementService } from '../achievements/achievement.service.js';
import { BehaviourService } from '../behaviour/behaviour.service.js';
import type { RequestContext } from '../marks/marks-context.js';
import { PortalService } from './portal.service.js';

const ctxOf = (c: RouteContext<unknown, unknown, unknown>): RequestContext => ({
  principal: c.principal,
  requestId: c.request.id,
});
const Id = z.object({ id: IdSchema });

/**
 * Phase 9 — student portal, exam-based behaviour and achievements.
 *   /portal/…        the signed-in student's own profile, behaviour and achievements (ids from the
 *                    session only)
 *   /behaviour/…     behaviour sheets per exam + section (administrators; class teachers own section)
 *   /achievements/…  achievements (administrators; class teachers own section; never subject teachers)
 */
export function phase9Module(deps: AppDependencies): FeatureModule {
  const base = { dataStore: deps.dataStore, clock: deps.clock, authorization: deps.authorization };
  const portal = new PortalService(base);
  const behaviour = new BehaviourService(base);
  const achievements = new AchievementService(base);
  return {
    name: 'portal',
    routes: [
      // ---- Student portal ------------------------------------------------------------------
      defineRoute({
        method: 'GET',
        url: '/portal/profile',
        access: requires('students.view'),
        handler: (c) => portal.profile(ctxOf(c)),
      }),
      defineRoute({
        method: 'GET',
        url: '/portal/behaviour',
        access: requires('behaviour.view'),
        schema: { query: PortalQuerySchema },
        handler: (c) => behaviour.mine(ctxOf(c), c.query.academicYearId),
      }),
      defineRoute({
        method: 'GET',
        url: '/portal/achievements',
        access: requires('achievements.view'),
        schema: { query: PortalQuerySchema },
        handler: (c) => achievements.mine(ctxOf(c), c.query.academicYearId),
      }),
      // ---- Behaviour -------------------------------------------------------------------------
      defineRoute({
        method: 'GET',
        url: '/behaviour/options',
        access: requires('behaviour.view'),
        schema: { query: PortalQuerySchema },
        handler: (c) => behaviour.options(ctxOf(c), c.query.academicYearId),
      }),
      defineRoute({
        method: 'GET',
        url: '/behaviour/sheet',
        access: requires('behaviour.view'),
        schema: { query: BehaviourSheetKeySchema },
        handler: (c) => behaviour.sheet(ctxOf(c), c.query),
      }),
      defineRoute({
        method: 'GET',
        url: '/behaviour/sheet/history',
        access: requires('behaviour.view'),
        schema: { query: BehaviourSheetKeySchema },
        handler: (c) => behaviour.history(ctxOf(c), c.query),
      }),
      defineRoute({
        method: 'PUT',
        url: '/behaviour/sheet',
        access: requires('behaviour.manage'),
        schema: { body: BehaviourSheetSaveSchema },
        handler: (c) => behaviour.save(ctxOf(c), c.body),
      }),
      defineRoute({
        method: 'POST',
        url: '/behaviour/sheet/submit',
        access: requires('behaviour.manage'),
        schema: { body: BehaviourSheetSubmitSchema },
        handler: (c) => behaviour.submit(ctxOf(c), c.body),
      }),
      defineRoute({
        method: 'GET',
        url: '/behaviour/students/:id',
        access: requires('behaviour.view'),
        schema: { params: Id },
        handler: (c) => behaviour.forStudent(ctxOf(c), c.params.id),
      }),
      // ---- Achievements ----------------------------------------------------------------------
      defineRoute({
        method: 'GET',
        url: '/achievements/options',
        access: requires('achievements.view'),
        schema: { query: PortalQuerySchema },
        handler: (c) => achievements.options(ctxOf(c), c.query.academicYearId),
      }),
      defineRoute({
        method: 'GET',
        url: '/achievements',
        access: requires('achievements.view'),
        schema: { query: AchievementListQuerySchema },
        handler: (c) => achievements.list(ctxOf(c), c.query),
      }),
      defineRoute({
        method: 'POST',
        url: '/achievements',
        access: requires('achievements.manage'),
        successStatus: 201,
        schema: { body: AchievementCreateSchema },
        handler: (c) => achievements.create(ctxOf(c), c.body),
      }),
      defineRoute({
        method: 'GET',
        url: '/achievements/:id',
        access: requires('achievements.view'),
        schema: { params: Id },
        handler: (c) => achievements.get(ctxOf(c), c.params.id),
      }),
      defineRoute({
        method: 'PUT',
        url: '/achievements/:id',
        access: requires('achievements.manage'),
        schema: { params: Id, body: AchievementUpdateSchema },
        handler: (c) => achievements.update(ctxOf(c), c.params.id, c.body),
      }),
      defineRoute({
        method: 'POST',
        url: '/achievements/:id/archive',
        access: requires('achievements.manage'),
        schema: { params: Id },
        handler: (c) => achievements.setArchived(ctxOf(c), c.params.id, true),
      }),
      defineRoute({
        method: 'POST',
        url: '/achievements/:id/restore',
        access: requires('achievements.manage'),
        schema: { params: Id },
        handler: (c) => achievements.setArchived(ctxOf(c), c.params.id, false),
      }),
      defineRoute({
        method: 'DELETE',
        url: '/achievements/:id',
        access: requires('achievements.manage'),
        schema: { params: Id },
        handler: async (c) => (await achievements.remove(ctxOf(c), c.params.id), { deleted: true }),
      }),
    ],
  };
}
