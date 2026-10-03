import { z } from 'zod';
import { UserRole, controlledValues } from './controlled-values.js';

/**
 * Authentication & authorization contract shared by API and web.
 * The API is the authority: the web app uses these only for display and early form feedback.
 */

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

/**
 * Effective roles of a signed-in user.
 * Account roles are ADMIN / TEACHER / STUDENT (stored on the user). CLASS_TEACHER is never
 * stored: a TEACHER gains it while holding an ACTIVE class-teacher assignment in the CURRENT
 * academic year, and keeps TEACHER at the same time.
 */
export const EffectiveRole = controlledValues(['ADMIN', 'TEACHER', 'CLASS_TEACHER', 'STUDENT']);
export type EffectiveRole = (typeof EffectiveRole.values)[number];

/** Whether a stored password is temporary (must be changed at next sign-in) or set by the user. */
export const PasswordStatus = controlledValues(['TEMPORARY', 'SET']);
export type PasswordStatus = (typeof PasswordStatus.values)[number];

// ---------------------------------------------------------------------------
// Permission catalogue
// ---------------------------------------------------------------------------

/**
 * Every permission key in the system (`resource.action`). Granting is done per role by the API
 * (apps/api/src/core/auth/role-permissions.ts). Holding a permission is necessary but not
 * sufficient: record-level SCOPE (own class, own periods, self) is checked separately.
 *
 * Keys exist ahead of their features so that each feature phase only has to use them; adding
 * a key here grants nothing by itself.
 */
export const PERMISSIONS = [
  // Accounts
  'users.view',
  'users.create',
  'users.edit',
  'users.delete',
  'users.reset_password',
  // School configuration (years, classes, sections, subjects, periods, rules)
  'config.view',
  'config.manage',
  'permissions.manage',
  // People
  'students.view',
  'students.create',
  'students.edit',
  'students.promote',
  'students.transfer',
  'students.deactivate',
  'students.delete',
  'teachers.view',
  'teachers.create',
  'teachers.edit',
  'teachers.deactivate',
  'teachers.delete',
  'teacher_subjects.view',
  'teacher_subjects.manage',
  'class_teacher_assignments.view',
  'class_teacher_assignments.manage',
  // Timetable
  'timetable.view',
  'timetable.manage',
  'timetable.publish',
  // Attendance
  'attendance.view',
  'attendance.mark',
  'attendance.manage',
  'attendance.override',
  // Exams, marks, results
  'exams.view',
  'exams.manage',
  'marks.view',
  'marks.enter',
  'marks.submit',
  'marks.edit',
  'results.view',
  // Behaviour & achievements
  'behaviour.view',
  'behaviour.manage',
  'achievements.view',
  'achievements.manage',
  // Communication
  'announcements.view',
  'announcements.manage',
  'requests.view',
  'requests.create',
  'requests.handle',
  // Reports & audit
  'reports.view',
  'reports.generate',
  'audit.view',
] as const;

export type Permission = (typeof PERMISSIONS)[number];
export const PermissionSchema = z.enum(PERMISSIONS);

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && (PERMISSIONS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Credentials & password policy
// ---------------------------------------------------------------------------

export const USERNAME_MAX = 64;
export const PASSWORD_MIN = 8;
/** Upper bound keeps hashing cost predictable and blocks oversized-input abuse. */
export const PASSWORD_MAX = 128;

/** Usernames are case-insensitive: trimmed and lower-cased before use. */
export const UsernameSchema = z
  .string({ message: 'Username is required' })
  .trim()
  .min(1, { message: 'Username is required' })
  .max(USERNAME_MAX, { message: `Username must be at most ${USERNAME_MAX} characters` })
  .regex(/^[A-Za-z0-9._@-]+$/, { message: 'Username contains invalid characters' })
  .transform((value) => value.toLowerCase());

/** Password as typed at sign-in: never trimmed (spaces may be part of it). */
export const PasswordInputSchema = z
  .string({ message: 'Password is required' })
  .min(1, { message: 'Password is required' })
  .max(PASSWORD_MAX, { message: 'Password is too long' });

const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  '12345678',
  '123456789',
  '1234567890',
  'qwerty123',
  'abc12345',
  'welcome1',
  'welcome123',
  'admin123',
  'letmein1',
  'school123',
  'ttlmhss123',
  'iloveyou1',
]);

/**
 * Password rules for NEW passwords (length-first, per current NIST guidance, plus a minimal
 * letter+digit rule suited to school users). Returns problems; empty means acceptable.
 */
export function passwordPolicyProblems(password: string, username?: string): string[] {
  const problems: string[] = [];
  if (password.length < PASSWORD_MIN) problems.push(`Use at least ${PASSWORD_MIN} characters`);
  if (password.length > PASSWORD_MAX) problems.push(`Use at most ${PASSWORD_MAX} characters`);
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    problems.push('Include at least one letter and one number');
  }
  if (password.trim() !== password) problems.push('Do not start or end with a space');
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) problems.push('This password is too common');
  if (username && username.length >= 3 && lower.includes(username.toLowerCase())) {
    problems.push('Do not include your username');
  }
  return problems;
}

export const LoginRequestSchema = z.object({
  username: UsernameSchema,
  password: PasswordInputSchema,
});
export type LoginRequest = z.input<typeof LoginRequestSchema>;

export const ChangePasswordRequestSchema = z
  .object({
    currentPassword: PasswordInputSchema,
    newPassword: z.string({ message: 'New password is required' }).max(PASSWORD_MAX, {
      message: 'Password is too long',
    }),
    confirmPassword: z.string({ message: 'Please confirm the new password' }),
  })
  .superRefine((value, ctx) => {
    for (const message of passwordPolicyProblems(value.newPassword)) {
      ctx.addIssue({ code: 'custom', path: ['newPassword'], message });
    }
    if (value.newPassword !== value.confirmPassword) {
      ctx.addIssue({
        code: 'custom',
        path: ['confirmPassword'],
        message: 'Passwords do not match',
      });
    }
    if (value.newPassword === value.currentPassword) {
      ctx.addIssue({
        code: 'custom',
        path: ['newPassword'],
        message: 'New password must be different from the current one',
      });
    }
  });
export type ChangePasswordRequest = z.input<typeof ChangePasswordRequestSchema>;

// ---------------------------------------------------------------------------
// Authenticated user (what the API returns about the signed-in user)
// ---------------------------------------------------------------------------

export const ScopeRefSchema = z.object({
  academicYearId: z.string(),
  sectionId: z.string(),
});
export type ScopeRef = z.infer<typeof ScopeRefSchema>;

/** Never contains password hashes, session tokens or other secrets. */
export const AuthUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  displayName: z.string(),
  accountRole: UserRole.schema,
  roles: z.array(EffectiveRole.schema),
  permissions: z.array(PermissionSchema),
  teacherId: z.string().nullable(),
  studentId: z.string().nullable(),
  /** Class/sections this user is class teacher of (current academic year). */
  classTeacherOf: z.array(ScopeRefSchema),
  mustChangePassword: z.boolean(),
});
export type AuthUser = z.infer<typeof AuthUserSchema>;

export const AuthSessionResponseSchema = z.object({ user: AuthUserSchema });
export type AuthSessionResponse = z.infer<typeof AuthSessionResponseSchema>;
