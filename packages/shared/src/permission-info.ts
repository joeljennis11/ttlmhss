import { PERMISSIONS, type EffectiveRole, type Permission } from './auth.js';

/** Roles whose permissions an administrator may adjust. ADMIN always holds every permission. */
export const CONFIGURABLE_ROLES = ['TEACHER', 'CLASS_TEACHER', 'STUDENT'] as const;
export type ConfigurableRole = (typeof CONFIGURABLE_ROLES)[number];

export function isConfigurableRole(value: unknown): value is ConfigurableRole {
  return typeof value === 'string' && (CONFIGURABLE_ROLES as readonly string[]).includes(value);
}

export interface PermissionInfo {
  /** Plain-language name shown to administrators. */
  label: string;
  group: string;
  /**
   * The CEILING: the only non-admin roles that may ever hold this permission. Enforced by the API
   * when permissions are saved AND whenever they are evaluated, so a configuration mistake (or a
   * tampered request) can never give a teacher or student administrative powers.
   */
  grantableTo: readonly ConfigurableRole[];
}

const ALL: readonly ConfigurableRole[] = ['TEACHER', 'CLASS_TEACHER', 'STUDENT'];
const STAFF: readonly ConfigurableRole[] = ['TEACHER', 'CLASS_TEACHER'];
const CT: readonly ConfigurableRole[] = ['CLASS_TEACHER'];
const NONE: readonly ConfigurableRole[] = [];

export const PERMISSION_INFO: Readonly<Record<Permission, PermissionInfo>> = Object.freeze({
  'users.view': { label: 'View user accounts', group: 'Accounts', grantableTo: NONE },
  'users.create': { label: 'Create user accounts', group: 'Accounts', grantableTo: NONE },
  'users.edit': { label: 'Activate or deactivate accounts', group: 'Accounts', grantableTo: NONE },
  'users.delete': { label: 'Delete user accounts', group: 'Accounts', grantableTo: NONE },
  'users.reset_password': { label: 'Reset passwords', group: 'Accounts', grantableTo: NONE },
  'config.view': { label: 'View school configuration', group: 'School setup', grantableTo: ALL },
  'config.manage': {
    label: 'Change school configuration',
    group: 'School setup',
    grantableTo: NONE,
  },
  'permissions.manage': {
    label: 'Change role permissions',
    group: 'School setup',
    grantableTo: NONE,
  },
  'students.view': { label: 'View students', group: 'Students & teachers', grantableTo: ALL },
  'students.create': { label: 'Admit students', group: 'Students & teachers', grantableTo: NONE },
  'students.edit': { label: 'Edit student details', group: 'Students & teachers', grantableTo: CT },
  // Phase 5: promotion changes several classes at once, so it is administrator-only (D-16).
  'students.promote': {
    label: 'Promote students to the next year',
    group: 'Students & teachers',
    grantableTo: NONE,
  },
  'teachers.view': { label: 'View teachers', group: 'Students & teachers', grantableTo: STAFF },
  'teachers.create': { label: 'Add teachers', group: 'Students & teachers', grantableTo: NONE },
  'teachers.edit': { label: 'Edit teachers', group: 'Students & teachers', grantableTo: NONE },
  // Phase 5 — management actions on people are administrator-only; views can be shared with staff.
  'students.transfer': {
    label: 'Move students to another class or section',
    group: 'Students & teachers',
    grantableTo: NONE,
  },
  'students.deactivate': {
    label: 'Deactivate or reactivate students',
    group: 'Students & teachers',
    grantableTo: NONE,
  },
  'students.delete': {
    label: 'Delete student records created by mistake',
    group: 'Students & teachers',
    grantableTo: NONE,
  },
  'teachers.deactivate': {
    label: 'Deactivate or reactivate teachers',
    group: 'Students & teachers',
    grantableTo: NONE,
  },
  'teachers.delete': {
    label: 'Delete teacher records created by mistake',
    group: 'Students & teachers',
    grantableTo: NONE,
  },
  'teacher_subjects.view': {
    label: 'View teachers’ subjects',
    group: 'Students & teachers',
    grantableTo: STAFF,
  },
  'teacher_subjects.manage': {
    label: 'Assign subjects to teachers',
    group: 'Students & teachers',
    grantableTo: NONE,
  },
  'class_teacher_assignments.view': {
    label: 'View class teacher assignments',
    group: 'Students & teachers',
    grantableTo: STAFF,
  },
  'class_teacher_assignments.manage': {
    label: 'Assign class teachers',
    group: 'Students & teachers',
    grantableTo: NONE,
  },
  'timetable.view': { label: 'View timetables', group: 'Timetable', grantableTo: ALL },
  'timetable.manage': {
    label: 'Edit the draft timetable of their own class',
    group: 'Timetable',
    grantableTo: CT,
  },
  'timetable.publish': {
    label: 'Publish or discard the timetable',
    group: 'Timetable',
    grantableTo: NONE,
  },
  'attendance.view': { label: 'View attendance', group: 'Attendance', grantableTo: ALL },
  'attendance.mark': {
    label: 'Mark attendance (present / absent)',
    group: 'Attendance',
    grantableTo: STAFF,
  },
  'attendance.manage': {
    label: 'Apply leave and cancel periods',
    group: 'Attendance',
    grantableTo: CT,
  },
  'attendance.override': {
    label: 'Change locked attendance',
    group: 'Attendance',
    grantableTo: NONE,
  },
  'exams.view': { label: 'View exams', group: 'Exams & marks', grantableTo: ALL },
  'exams.manage': { label: 'Set up exams', group: 'Exams & marks', grantableTo: NONE },
  'marks.view': { label: 'View marks', group: 'Exams & marks', grantableTo: ALL },
  'marks.enter': { label: 'Enter marks', group: 'Exams & marks', grantableTo: STAFF },
  'marks.submit': { label: 'Submit marks', group: 'Exams & marks', grantableTo: STAFF },
  'marks.edit': {
    label: 'Unlock and correct submitted marks',
    group: 'Exams & marks',
    grantableTo: CT,
  },
  'results.view': { label: 'View results', group: 'Exams & marks', grantableTo: ALL },
  'behaviour.view': {
    label: 'View behaviour ratings',
    group: 'Behaviour & achievements',
    grantableTo: ALL,
  },
  'behaviour.manage': {
    label: 'Record behaviour ratings',
    group: 'Behaviour & achievements',
    grantableTo: STAFF,
  },
  'achievements.view': {
    label: 'View achievements',
    group: 'Behaviour & achievements',
    grantableTo: ALL,
  },
  // BR-ACH-01: only Admin and Class Teacher manage achievements — never subject teachers.
  'achievements.manage': {
    label: 'Record achievements',
    group: 'Behaviour & achievements',
    grantableTo: CT,
  },
  'announcements.view': { label: 'View announcements', group: 'Communication', grantableTo: ALL },
  'announcements.manage': { label: 'Post announcements', group: 'Communication', grantableTo: CT },
  'requests.view': { label: 'View requests', group: 'Communication', grantableTo: ALL },
  'requests.create': { label: 'Send requests', group: 'Communication', grantableTo: ['STUDENT'] },
  'requests.handle': { label: 'Respond to requests', group: 'Communication', grantableTo: CT },
  'reports.view': { label: 'View reports', group: 'Reports', grantableTo: ALL },
  'reports.generate': { label: 'Generate reports', group: 'Reports', grantableTo: STAFF },
  'audit.view': { label: 'View the audit log', group: 'Reports', grantableTo: CT },
});

/** Permissions a role may ever hold (its ceiling). */
export function grantableTo(role: ConfigurableRole): Permission[] {
  return PERMISSIONS.filter((p) => PERMISSION_INFO[p].grantableTo.includes(role));
}

export const PERMISSION_GROUPS: readonly string[] = [
  ...new Set(PERMISSIONS.map((p) => PERMISSION_INFO[p].group)),
];

export const ROLE_DISPLAY_NAMES: Readonly<Record<EffectiveRole, string>> = Object.freeze({
  ADMIN: 'Administrator',
  TEACHER: 'Teacher',
  CLASS_TEACHER: 'Class Teacher',
  STUDENT: 'Student',
});
