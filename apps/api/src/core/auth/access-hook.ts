import type { FastifyInstance } from 'fastify';
import {
  ForbiddenError,
  InternalError,
  PasswordChangeRequiredError,
  UnauthorizedError,
} from '../errors/app-errors.js';
import type { AccessPolicy, AccessRequirement, Authenticator, Principal } from './access.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the access hook. Null for anonymous requests on public routes. */
    principal: Principal | null;
  }
  interface FastifyContextConfig {
    access?: AccessRequirement;
  }
}

/**
 * Global access gate, run before validation and handlers on every route:
 *   1. authenticate (session → active user → principal), even on public routes so handlers can
 *      see who is signed in;
 *   2. protected route without a principal → 401;
 *   3. temporary password in use and the route is not part of the change flow → 403
 *      PASSWORD_CHANGE_REQUIRED (cannot be bypassed by calling other endpoints directly);
 *   4. route permission not held → 403.
 * A matched route without an access declaration is a programming error and is refused (500).
 */
export function registerAccessControl(
  app: FastifyInstance,
  authenticator: Authenticator,
  policy: AccessPolicy,
): void {
  app.decorateRequest('principal', null);

  app.addHook('onRequest', async (request) => {
    if (request.is404) return;

    const access = request.routeOptions.config.access;
    if (!access) {
      throw new InternalError(`Route ${request.routeOptions.url} has no access declaration`);
    }

    const principal = await authenticator.authenticate(request);
    request.principal = principal;

    if (access.kind === 'public') return;
    if (!principal) throw new UnauthorizedError();
    if (principal.mustChangePassword && !access.allowDuringPasswordChange) {
      throw new PasswordChangeRequiredError();
    }
    if (!(await policy.isAllowed(principal, access))) throw new ForbiddenError();
  });
}
