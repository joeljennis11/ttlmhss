import { PUBLIC } from '../../core/auth/access.js';
import type { FeatureModule } from '../../core/http/module.js';
import { defineRoute } from '../../core/http/routes.js';
import type { AppDependencies } from '../../app-dependencies.js';
import { HealthService } from './health.service.js';

export function systemModule(deps: AppDependencies): FeatureModule {
  const health = new HealthService({
    pingDatabase: () => deps.dataStore.ping(),
    clock: deps.clock,
  });

  return {
    name: 'system',
    routes: [
      defineRoute({
        method: 'GET',
        url: '/health',
        access: PUBLIC,
        handler: async ({ reply }) => {
          const result = await health.check();
          if (result.status !== 'ok') reply.status(503);
          return result;
        },
      }),
    ],
  };
}
