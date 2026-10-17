import { randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { API_PREFIX } from '@ttlmhss/shared';
import type { AppDependencies } from './app-dependencies.js';
import { registerAccessControl } from './core/auth/access-hook.js';
import { TooManyRequestsError } from './core/errors/app-errors.js';
import { registerErrorHandling } from './core/errors/error-handler.js';
import type { FeatureModule } from './core/http/module.js';
import { registerOriginCheck } from './core/http/origin-check.js';
import { registerRoutes } from './core/http/routes.js';
import { buildLoggerOptions } from './core/logging/logger.js';
import { featureModules } from './modules.js';

export interface BuildAppOptions {
  /** Override the logger (tests pass false). */
  logger?: FastifyServerOptions['logger'];
  /** Extra modules — used by tests to exercise the foundation (never registered in production). */
  extraModules?: FeatureModule[];
}

/** Build the HTTP application. Pure factory: no listening, no process handling. */
export async function buildApp(
  deps: AppDependencies,
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  if (deps.config.isProduction && options.extraModules?.length) {
    // Test-only routes can never be mounted in a production process.
    throw new Error('Test modules cannot be registered in production.');
  }

  const app = Fastify({
    logger: options.logger ?? buildLoggerOptions(deps.config),
    // Never trust client-supplied request ids.
    requestIdHeader: false,
    genReqId: () => randomUUID(),
    bodyLimit: 1_048_576,
    // Only behind a known reverse proxy; otherwise X-Forwarded-For could spoof the client IP
    // that rate limiting relies on.
    trustProxy: deps.config.trustProxy,
  });

  // Request bodies are JSON only. Removing the text/plain parser means a cross-site HTML form
  // cannot submit a body this API will accept (CSRF hardening).
  app.removeContentTypeParser('text/plain');

  // The API only serves JSON and generated files, never HTML: the tightest possible CSP.
  // HSTS only when the deployment is HTTPS (secure cookies); sending it over plain-http
  // development would pin browsers to https://localhost.
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },
    },
    referrerPolicy: { policy: 'no-referrer' },
    frameguard: { action: 'deny' },
    strictTransportSecurity: deps.config.hsts
      ? { maxAge: 31_536_000, includeSubDomains: true }
      : false,
  });
  await app.register(cors, {
    origin: [...deps.config.corsOrigins],
    credentials: true,
  });
  await app.register(cookie);
  // Limits are opt-in per route (see RouteDefinition.rateLimit), e.g. sign-in. They run after
  // access control, so a signed-in caller is limited per account (many staff can share one school
  // network address) and an anonymous caller per IP address.
  await app.register(rateLimit, {
    global: false,
    hook: 'preHandler',
    keyGenerator: (request) =>
      request.principal ? `user:${request.principal.userId}` : `ip:${request.ip}`,
    errorResponseBuilder: () => new TooManyRequestsError(),
  });

  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
    // API answers are per-user and dynamic: never stored by browsers or proxies (Phase 12C).
    if (!reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
    reply.header(
      'permissions-policy',
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
    );
  });

  registerErrorHandling(app);
  registerOriginCheck(app, deps.config.corsOrigins);
  registerAccessControl(app, deps.authenticator, deps.accessPolicy);

  const modules = [...featureModules(deps), ...(options.extraModules ?? [])];
  await app.register(
    async (api) => {
      for (const module of modules) registerRoutes(api, module.routes);
    },
    { prefix: API_PREFIX },
  );

  return app;
}
