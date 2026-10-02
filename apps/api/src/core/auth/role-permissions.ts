import { PERMISSIONS, type EffectiveRole, type Permission } from '@ttlmhss/shared';

/**
 * Role → permission grants (code-defined, version-controlled; docs/permissions.md, D-15).
 *
 * A permission says what KIND of action a role may attempt. It is never sufficient on its own for
 * record-level access: services must also check scope (own class, own periods, self) through
 * AuthorizationService. E.g. TEACHER holds `students.view`, but only for students in their scope.
 *
 * CLASS_TEACHER grants are ADDED to TEACHER grants for a teacher holding an active class-teacher
 * assignment, and apply only within that class/section.
 */
const TEACHER: readonly Permission[] = [
  'config.view',
  'students.view',
  'timetable.view',
  'attendance.view',
  'attendance.mark',
  'exams.view',
  'marks.view',
  'marks.enter',
  'marks.submit',
  'results.view',
  'announcements.view',
  'reports.view',
];

const CLASS_TEACHER: readonly Permission[] = [
  'students.edit',
  'attendance.manage',
  'marks.edit',
  'behaviour.view',
  'behaviour.manage',
  'achievements.view',
  'achievements.manage',
  'announcements.manage',
  'requests.view',
  'requests.handle',
  'reports.generate',
];

const STUDENT: readonly Permission[] = [
  'students.view',
  'timetable.view',
  'attendance.view',
  'exams.view',
  'marks.view',
  'results.view',
  'behaviour.view',
  'achievements.view',
  'announcements.view',
  'requests.view',
  'requests.create',
  'reports.view',
];

export const ROLE_PERMISSIONS: Readonly<Record<EffectiveRole, readonly Permission[]>> =
  Object.freeze({
    ADMIN: PERMISSIONS,
    TEACHER,
    CLASS_TEACHER,
    STUDENT,
  });

export function permissionsFor(roles: readonly EffectiveRole[]): ReadonlySet<Permission> {
  return new Set(roles.flatMap((role) => ROLE_PERMISSIONS[role]));
}
