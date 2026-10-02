import type { FastifyRequest } from 'fastify';
import type { UserRole } from '@ttlmhss/shared';

/**
 * The authenticated identity attached to a request. Produced only by an Authenticator
 * (Phase 2). Nothing downstream reads cookies or tokens directly.
 *
 * Class-teacher scope is NOT part of the principal: it is resolved from assignments in the
 * database at authorization time, so assignment changes take effect immediately.
 */
export interface Principal {
  readonly userId: string;
  readonly role: UserRole;
  readonly teacherId: string | null;
  readonly studentId: string | null;
}

/** Permission keys follow `resource.action`, e.g. `attendance.mark`. Defined in Phase 2. */
export type PermissionKey = `${string}.${string}`;

/**
 * Every route MUST declare its access requirement (deny by default).
 * - public: no identity needed (health, public branding).
 * - authenticated: a signed-in principal, optionally holding a permission. Record-level scope
 *   checks (own class, own period, self) happen in service policies, not here.
 */
export type AccessRequirement =
  | { readonly kind: 'public' }
  | { readonly kind: 'authenticated'; readonly permission?: PermissionKey };

export const PUBLIC: AccessRequirement = Object.freeze({ kind: 'public' });

/** Resolves the principal for a request, or null when there is no valid identity. */
export interface Authenticator {
  authenticate(request: FastifyRequest): Promise<Principal | null>;
}

/** Decides whether a principal satisfies a route's access requirement. */
export interface AccessPolicy {
  isAllowed(principal: Principal, requirement: AccessRequirement): Promise<boolean>;
}

/**
 * Phase 1 defaults. Authentication does not exist yet, so nobody is ever authenticated and every
 * non-public route is refused. This is fail-closed on purpose — there is no temporary or
 * bypass authentication. Phase 2 replaces these with real implementations.
 */
export const noAuthentication: Authenticator = {
  authenticate: async () => null,
};

export const denyAllPolicy: AccessPolicy = {
  isAllowed: async () => false,
};
