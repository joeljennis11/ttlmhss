import type { Permission } from '@ttlmhss/shared';
import { ForbiddenError, UnauthorizedError } from '../errors/app-errors.js';
import type { Principal } from './access.js';
import type { AuthScopeRepository } from './scope.repository.js';

const NO_ACCESS = 'You do not have access to this record.';

/**
 * Reusable service-layer authorization. Feature services use it like:
 *
 *   const user = this.authz.authorize(principal, 'students.view');   // authenticated + permission
 *   await this.authz.checkStudentScope(user, studentId);              // record-level scope
 *
 * Route-level `access` already blocks unauthenticated / unpermitted callers; services repeat
 * `authorize` so they stay safe when called from somewhere other than one specific route.
 *
 * Scope rules:
 *   ADMIN          — school-wide.
 *   STUDENT        — only their own student record and the section(s) they are enrolled in.
 *   CLASS_TEACHER  — students currently enrolled in, and the sections of, their class(es).
 *   TEACHER        — teaching scope comes from the published timetable (Phase 6). Until then a
 *                    plain teacher has NO student/section scope, so these checks deny.
 */
export class AuthorizationService {
  constructor(private readonly scopes: AuthScopeRepository) {}

  /** Signed in, not blocked by a temporary password, and holding `permission`. */
  authorize(principal: Principal | null, permission?: Permission): Principal {
    if (!principal) throw new UnauthorizedError();
    if (principal.mustChangePassword) throw new ForbiddenError();
    if (permission && !principal.permissions.has(permission)) throw new ForbiddenError();
    return principal;
  }

  isAdmin(principal: Principal): boolean {
    return principal.roles.includes('ADMIN');
  }

  isClassTeacherOf(principal: Principal, sectionId: string): boolean {
    return principal.classTeacherOf.some((scope) => scope.sectionId === sectionId);
  }

  /** May this principal access records of the given section (class/section-level data)? */
  canAccessSection(principal: Principal, sectionId: string): boolean {
    if (this.isAdmin(principal)) return true;
    if (this.isClassTeacherOf(principal, sectionId)) return true;
    if (principal.studentId && principal.enrolledIn.some((s) => s.sectionId === sectionId))
      return true;
    return false;
  }

  checkSectionScope(principal: Principal, sectionId: string): void {
    if (!this.canAccessSection(principal, sectionId)) throw new ForbiddenError(NO_ACCESS);
  }

  /** May this principal access the given student's records? */
  async canAccessStudent(principal: Principal, studentId: string): Promise<boolean> {
    if (this.isAdmin(principal)) return true;
    // A student account is limited to itself, whatever other data says.
    if (principal.accountRole === 'STUDENT') return principal.studentId === studentId;
    if (principal.classTeacherOf.length > 0) {
      const sections = await this.scopes.studentSections(studentId);
      return sections.some((s) => this.isClassTeacherOf(principal, s.sectionId));
    }
    return false;
  }

  async checkStudentScope(principal: Principal, studentId: string): Promise<void> {
    if (!(await this.canAccessStudent(principal, studentId))) throw new ForbiddenError(NO_ACCESS);
  }

  /** Resources owned by a user account (e.g. their own sessions or requests). */
  checkSelfOrAdmin(principal: Principal, userId: string): void {
    if (!this.isAdmin(principal) && principal.userId !== userId)
      throw new ForbiddenError(NO_ACCESS);
  }
}
