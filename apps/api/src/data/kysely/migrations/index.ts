import type { Migration } from 'kysely/migration';
import { migration0001Foundation } from './0001_foundation.js';
import { migration0002SchoolIdentity } from './0002_school_identity.js';
import { migration0003Authentication } from './0003_authentication.js';
import { migration0004SchoolLogo } from './0004_school_logo.js';
import { migration0005SchoolConfiguration } from './0005_school_configuration.js';
import { migration0006People } from './0006_people.js';
import { migration0007Timetable } from './0007_timetable.js';
import { migration0008Attendance } from './0008_attendance.js';
import { migration0009AcademicCalendar } from './0009_academic_calendar.js';
import { migration0010Marks } from './0010_marks.js';

/**
 * Ordered migration registry. Names sort lexically and are applied in that order.
 *
 * Rules:
 * - Never edit or delete a migration that has been applied anywhere; add a new one.
 * - Every migration has a working `down`.
 * - Use only portable DDL (see ddl-helpers.ts). Provider-specific steps need an explicit,
 *   documented reason.
 */
export const migrations: Record<string, Migration> = {
  '0001_foundation': migration0001Foundation,
  '0002_school_identity': migration0002SchoolIdentity,
  '0003_authentication': migration0003Authentication,
  '0004_school_logo': migration0004SchoolLogo,
  '0005_school_configuration': migration0005SchoolConfiguration,
  '0006_people': migration0006People,
  '0007_timetable': migration0007Timetable,
  '0008_attendance': migration0008Attendance,
  '0009_academic_calendar': migration0009AcademicCalendar,
  '0010_marks': migration0010Marks,
};
