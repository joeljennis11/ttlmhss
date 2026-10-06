import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { FileResponse } from './file-response.js';
import { toFieldIssues, type ApiSuccess, type FieldIssue } from '@ttlmhss/shared';
import type { z } from 'zod';
import type { AccessRequirement, Principal } from '../auth/access.js';
import { ValidationError } from '../errors/app-errors.js';

/**
 * Route/controller convention.
 *
 * A route is a thin adapter: declare access, declare input schemas, call ONE service method,
 * return its result. No business rules and no data access in routes.
 *
 *   defineRoute({
 *     method: 'GET',
 *     url: '/school/branding',
 *     access: PUBLIC,
 *     schema: { query: SomeQuerySchema },
 *     handler: ({ query }) => service.doSomething(query),
 *   });
 *
 * The handler's return value is wrapped as `{ "data": ... }`. Return `paged(items, meta)` for lists.
 */
type Infer<S> = S extends z.ZodType ? z.output<S> : undefined;

export interface RouteContext<P, Q, B> {
  params: P;
  query: Q;
  body: B;
  principal: Principal | null;
  request: FastifyRequest;
  reply: FastifyReply;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RouteDefinition<
  PS extends z.ZodType | undefined,
  QS extends z.ZodType | undefined,
  BS extends z.ZodType | undefined,
  R,
> {
  method: HttpMethod;
  url: string;
  access: AccessRequirement;
  /** HTTP status on success (default 200). */
  successStatus?: number;
  /** Request limit for this route: per account when signed in, otherwise per IP (e.g. sign-in). */
  rateLimit?: { max: number; timeWindowMs: number };
  schema?: { params?: PS; query?: QS; body?: BS };
  handler: (ctx: RouteContext<Infer<PS>, Infer<QS>, Infer<BS>>) => Promise<R> | R;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyRouteDefinition = RouteDefinition<any, any, any, any>;

export function defineRoute<
  PS extends z.ZodType | undefined = undefined,
  QS extends z.ZodType | undefined = undefined,
  BS extends z.ZodType | undefined = undefined,
  R = unknown,
>(definition: RouteDefinition<PS, QS, BS, R>): RouteDefinition<PS, QS, BS, R> {
  return definition;
}

const PAGED = Symbol('paged');
interface PagedResult<T> {
  [PAGED]: true;
  items: T[];
  meta: NonNullable<ApiSuccess<T[]>['meta']>;
}

export function paged<T>(items: T[], meta: PagedResult<T>['meta']): PagedResult<T> {
  return { [PAGED]: true, items, meta };
}

function isPaged(value: unknown): value is PagedResult<unknown> {
  return typeof value === 'object' && value !== null && PAGED in value;
}

function parsePart(
  schema: z.ZodType | undefined,
  input: unknown,
  location: string,
  issues: FieldIssue[],
): unknown {
  if (!schema) return undefined;
  const result = schema.safeParse(input ?? {});
  if (result.success) return result.data;
  issues.push(...toFieldIssues(result.error, location));
  return undefined;
}

export function registerRoutes(app: FastifyInstance, routes: readonly AnyRouteDefinition[]): void {
  for (const route of routes) {
    app.route({
      method: route.method,
      url: route.url,
      config: {
        access: route.access,
        ...(route.rateLimit
          ? { rateLimit: { max: route.rateLimit.max, timeWindow: route.rateLimit.timeWindowMs } }
          : {}),
      },
      handler: async (request, reply) => {
        const issues: FieldIssue[] = [];
        const params = parsePart(route.schema?.params, request.params, 'params', issues);
        const query = parsePart(route.schema?.query, request.query, 'query', issues);
        const body = parsePart(route.schema?.body, request.body, 'body', issues);
        if (issues.length > 0) throw new ValidationError(issues);

        const result = await route.handler({
          params,
          query,
          body,
          principal: request.principal,
          request,
          reply,
        });

        if (result instanceof FileResponse) {
          reply.header('Content-Type', result.contentType);
          reply.header('Content-Disposition', `attachment; filename="${result.fileName}"`);
          reply.header('Cache-Control', 'no-store');
          reply.header('X-Content-Type-Options', 'nosniff');
          return reply.send(result.body);
        }
        if (reply.statusCode === 200 && route.successStatus) reply.status(route.successStatus);
        const envelope: ApiSuccess<unknown> = isPaged(result)
          ? { data: result.items, meta: result.meta }
          : { data: result };
        return envelope;
      },
    });
  }
}
