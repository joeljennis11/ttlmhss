import type { FastifyRequest } from 'fastify';
import type { EffectiveRole, Permission, ScopeRef, UserRole } from '@ttlmhss/shared';

/**
 * The authenticated-user context attached to every request (request.principal).
 *
 * Built by the Authenticator from the session, the user record and current assignments — fresh on
 * each request, so deactivation and assignment changes apply immediately. Services receive this;
 * nothing downstream reads cookies or tokens.
 */
export interface Principal {
  readonly userId: string;
  readonly username: string;
  readonly displayName: string;
  /** Stored account role. */
  readonly accountRole: UserRole;
  /** Effective roles: account role, plus CLASS_TEACHER for teachers with an active assignment. */
  readonly roles: readonly EffectiveRole[];
  readonly permissions: ReadonlySet<Permission>;
  readonly teacherId: string | null;
  readonly studentId: string | null;
  /** Sections this teacher is class teacher of (current academic year). */
  readonly classTeacherOf: readonly ScopeRef[];
  /** Sections this student is actively enrolled in (current academic year). */
  readonly enrolledIn: readonly ScopeRef[];
  /** Temporary password in use: only the password-change flow is allowed until it is changed. */
  readonly mustChangePassword: boolean;
  readonly sessionId: string | null;
}

/**
 * Every route MUST declare its access requirement (deny by default).
 * - public: no identity needed.
 * - authenticated: an active, signed-in principal, optionally holding `permission`.
 *   `allowDuringPasswordChange` marks the few routes usable before a temporary password is changed.
 * Record-level scope (own class, own period, self) is checked in services via AuthorizationService.
 */
export type AccessRequirement =
  | { readonly kind: 'public' }
  | {
      readonly kind: 'authenticated';
      readonly permission?: Permission;
      readonly allowDuringPasswordChange?: boolean;
    };

export const PUBLIC: AccessRequirement = Object.freeze({ kind: 'public' });

/** Signed in, any role. */
export const AUTHENTICATED: AccessRequirement = Object.freeze({ kind: 'authenticated' });

/** Signed in and holding `permission`. */
export function requires(permission: Permission): AccessRequirement {
  return Object.freeze({ kind: 'authenticated', permission });
}

/** Resolves the principal for a request, or null when there is no valid, active identity. */
export interface Authenticator {
  authenticate(request: FastifyRequest): Promise<Principal | null>;
}

/** Decides whether a principal satisfies a route's permission requirement. */
export interface AccessPolicy {
  isAllowed(principal: Principal, requirement: AccessRequirement): Promise<boolean>;
}

/** Permission-based policy: allowed when the requirement names no permission or the principal holds it. */
export const permissionPolicy: AccessPolicy = {
  isAllowed: async (principal, requirement) =>
    requirement.kind === 'public' ||
    requirement.permission === undefined ||
    principal.permissions.has(requirement.permission),
};

/** Nobody is authenticated. Used by tests that exercise the fail-closed path. */
export const noAuthentication: Authenticator = {
  authenticate: async () => null,
};

/** Refuses every protected request. Used by tests that exercise the fail-closed path. */
export const denyAllPolicy: AccessPolicy = {
  isAllowed: async () => false,
};
