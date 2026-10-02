import type { AuthUser, EffectiveRole, ScopeRef } from '@ttlmhss/shared';
import type { Principal } from '../../core/auth/access.js';
import { permissionsFor } from '../../core/auth/role-permissions.js';
import type { AuthScopeRepository } from '../../core/auth/scope.repository.js';
import type { StoredCredential, UserAccount } from './auth.repository.js';

/**
 * Builds the request principal from an ACTIVE account, its credential and current assignments.
 * Class Teacher is derived here: a TEACHER with at least one active class-teacher assignment in
 * the current academic year gains the CLASS_TEACHER effective role (and keeps TEACHER).
 */
export async function buildPrincipal(
  account: UserAccount,
  credential: StoredCredential,
  scopes: AuthScopeRepository,
  sessionId: string | null,
): Promise<Principal> {
  let classTeacherOf: ScopeRef[] = [];
  let enrolledIn: ScopeRef[] = [];
  const roles: EffectiveRole[] = [account.role];

  if (account.role === 'TEACHER' && account.teacherId) {
    classTeacherOf = await scopes.classTeacherSections(account.teacherId);
    if (classTeacherOf.length > 0) roles.push('CLASS_TEACHER');
  }
  if (account.role === 'STUDENT' && account.studentId) {
    enrolledIn = await scopes.studentSections(account.studentId);
  }

  return Object.freeze({
    userId: account.id,
    username: account.username,
    displayName: account.displayName,
    accountRole: account.role,
    roles: Object.freeze(roles),
    permissions: permissionsFor(roles),
    // Links only make sense for the matching account role.
    teacherId: account.role === 'TEACHER' ? account.teacherId : null,
    studentId: account.role === 'STUDENT' ? account.studentId : null,
    classTeacherOf: Object.freeze(classTeacherOf),
    enrolledIn: Object.freeze(enrolledIn),
    mustChangePassword: credential.passwordStatus === 'TEMPORARY',
    sessionId,
  });
}

/** The ONLY shape of user information the API returns about the signed-in user. */
export function toAuthUser(principal: Principal): AuthUser {
  return {
    id: principal.userId,
    username: principal.username,
    displayName: principal.displayName,
    accountRole: principal.accountRole,
    roles: [...principal.roles],
    permissions: [...principal.permissions].sort(),
    teacherId: principal.teacherId,
    studentId: principal.studentId,
    classTeacherOf: [...principal.classTeacherOf],
    mustChangePassword: principal.mustChangePassword,
  };
}
