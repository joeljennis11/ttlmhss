import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { API_PREFIX } from '@ttlmhss/shared';
import type { AppDependencies } from './app-dependencies.js';
import { registerAccessControl } from './core/auth/access-hook.js';
import { registerErrorHandling } from './core/errors/error-handler.js';
import type { FeatureModule } from './core/http/module.js';
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
  });

  await app.register(helmet);
  await app.register(cors, {
    origin: [...deps.config.corsOrigins],
    credentials: true,
  });

  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  registerErrorHandling(app);
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
