import type { FastifyInstance } from 'fastify';
import { ForbiddenError, InternalError, UnauthorizedError } from '../errors/app-errors.js';
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
 * Global access gate, run before validation and handlers on every route.
 * A matched route without an access declaration is a programming error and is refused (500)
 * rather than silently exposed.
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
    if (!(await policy.isAllowed(principal, access))) throw new ForbiddenError();
  });
}
