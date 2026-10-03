import { ChangePasswordRequestSchema, LoginRequestSchema } from '@ttlmhss/shared';
import type { FastifyRequest } from 'fastify';
import type { AppDependencies } from '../../app-dependencies.js';
import { PUBLIC, type AccessRequirement } from '../../core/auth/access.js';
import { UnauthorizedError } from '../../core/errors/app-errors.js';
import type { FeatureModule } from '../../core/http/module.js';
import { defineRoute } from '../../core/http/routes.js';
import { AuthService, type RequestMeta } from './auth.service.js';
import { clearSessionCookie, readSessionCookie, setSessionCookie } from './session-cookie.js';

/** Signed in, and usable while a temporary password still has to be changed. */
const SIGNED_IN_ANY_STATE: AccessRequirement = Object.freeze({
  kind: 'authenticated',
  allowDuringPasswordChange: true,
});

function meta(request: FastifyRequest): RequestMeta {
  const agent = request.headers['user-agent'];
  return {
    ipAddress: request.ip ?? null,
    userAgent: typeof agent === 'string' ? agent : null,
    requestId: request.id,
  };
}

export function authModule(deps: AppDependencies): FeatureModule {
  const auth = new AuthService({
    dataStore: deps.dataStore,
    hasher: deps.passwordHasher,
    sessions: deps.sessions,
    throttle: deps.loginThrottle,
    rolePermissions: deps.rolePermissions,
    clock: deps.clock,
  });
  const cookieConfig = deps.config.auth;
  const perIpLimit = { max: deps.config.auth.loginRateLimitPerMinute, timeWindowMs: 60_000 };

  return {
    name: 'auth',
    routes: [
      defineRoute({
        method: 'POST',
        url: '/auth/login',
        access: PUBLIC,
        rateLimit: perIpLimit,
        schema: { body: LoginRequestSchema },
        handler: async ({ body, request, reply }) => {
          const signedIn = await auth.login(body, meta(request));
          setSessionCookie(reply, cookieConfig, signedIn.token, signedIn.expiresAt);
          return { user: signedIn.user };
        },
      }),
      defineRoute({
        method: 'POST',
        url: '/auth/logout',
        // Public so an expired/invalid session can still clear its cookie.
        access: PUBLIC,
        handler: async ({ request, reply }) => {
          await auth.logout(readSessionCookie(request, cookieConfig), meta(request));
          clearSessionCookie(reply, cookieConfig);
          return { signedOut: true };
        },
      }),
      defineRoute({
        method: 'GET',
        url: '/auth/me',
        access: SIGNED_IN_ANY_STATE,
        handler: ({ principal }) => {
          if (!principal) throw new UnauthorizedError();
          return { user: auth.me(principal) };
        },
      }),
      defineRoute({
        method: 'POST',
        url: '/auth/change-password',
        access: SIGNED_IN_ANY_STATE,
        rateLimit: perIpLimit,
        schema: { body: ChangePasswordRequestSchema },
        handler: async ({ body, principal, request, reply }) => {
          if (!principal) throw new UnauthorizedError();
          const signedIn = await auth.changePassword(principal, body, meta(request));
          setSessionCookie(reply, cookieConfig, signedIn.token, signedIn.expiresAt);
          return { user: signedIn.user };
        },
      }),
    ],
  };
}
