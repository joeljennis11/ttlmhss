import type { FeatureModule } from './core/http/module.js';
import type { AppDependencies } from './app-dependencies.js';
import { attendanceModule } from './modules/attendance/attendance.module.js';
import { authModule } from './modules/auth/auth.module.js';
import { calendarModule } from './modules/calendar/calendar.module.js';
import { configModule } from './modules/config/config.module.js';
import { peopleModule } from './modules/people/people.module.js';
import { schoolModule } from './modules/school/school.module.js';
import { systemModule } from './modules/system/system.module.js';
import { timetableModule } from './modules/timetable/timetable.module.js';

/**
 * Registered feature modules. Each later phase adds its module here — and only once the feature
 * is real. No placeholder endpoints.
 */
export function featureModules(deps: AppDependencies): FeatureModule[] {
  return [
    systemModule(deps),
    schoolModule(deps),
    authModule(deps),
    configModule(deps),
    calendarModule(deps),
    peopleModule(deps),
    timetableModule(deps),
    attendanceModule(deps),
  ];
}
