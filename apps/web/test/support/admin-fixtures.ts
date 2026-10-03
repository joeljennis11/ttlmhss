import { PERMISSIONS, grantableTo, type Permission, type PermissionsView } from '@ttlmhss/shared';

/** TEST DATA ONLY: a small, synthetic role-permission view for UI tests. */
const TEACHER: Permission[] = ['config.view', 'students.view', 'attendance.mark', 'marks.enter'];
const CLASS_TEACHER: Permission[] = ['students.edit', 'attendance.manage'];
const STUDENT: Permission[] = ['students.view'];

export const ROLE_PERMISSIONS_FOR_TESTS: PermissionsView = {
  admin: [...PERMISSIONS],
  roles: [
    { role: 'TEACHER', defaults: TEACHER, effective: TEACHER, grantable: grantableTo('TEACHER') },
    {
      role: 'CLASS_TEACHER',
      defaults: CLASS_TEACHER,
      effective: CLASS_TEACHER,
      grantable: grantableTo('CLASS_TEACHER'),
    },
    { role: 'STUDENT', defaults: STUDENT, effective: STUDENT, grantable: grantableTo('STUDENT') },
  ],
};
