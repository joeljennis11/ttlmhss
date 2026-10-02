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

  await app.register(helmet);
  await app.register(cors, {
    origin: [...deps.config.corsOrigins],
    credentials: true,
  });
  await app.register(cookie);
  // Limits are opt-in per route (see RouteDefinition.rateLimit), e.g. sign-in.
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: () => new TooManyRequestsError(),
  });

  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
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
