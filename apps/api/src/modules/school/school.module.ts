import type { AppDependencies } from '../../app-dependencies.js';
import { PUBLIC } from '../../core/auth/access.js';
import type { FeatureModule } from '../../core/http/module.js';
import { defineRoute } from '../../core/http/routes.js';
import { SchoolService } from './school.service.js';

export function schoolModule(deps: AppDependencies): FeatureModule {
  const school = new SchoolService(deps.dataStore.repositories.schoolSettings);

  return {
    name: 'school',
    routes: [
      defineRoute({
        method: 'GET',
        url: '/school/branding',
        access: PUBLIC,
        handler: () => school.getBranding(),
      }),
    ],
  };
}
