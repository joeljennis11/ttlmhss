import { ErrorCode } from '@ttlmhss/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { AccessPolicy, Authenticator, Principal } from '../src/core/auth/access.js';
import { PUBLIC } from '../src/core/auth/access.js';
import { ConflictError, NotFoundError } from '../src/core/errors/app-errors.js';
import type { FeatureModule } from '../src/core/http/module.js';
import { defineRoute, paged } from '../src/core/http/routes.js';
import type { DataStore } from '../src/data/data-store.js';
import { buildTestApp, openTestDatabase } from './support/test-harness.js';

/**
 * Routes registered ONLY inside these tests to exercise the foundation (validation, error
 * mapping, access control). They are not part of the application.
 */
const probeModule: FeatureModule = {
  name: 'test-probe',
  routes: [
    defineRoute({
      method: 'POST',
      url: '/__test/echo/:id',
      access: PUBLIC,
      successStatus: 201,
      schema: {
        params: z.object({ id: z.uuid() }),
        query: z.object({ verbose: z.enum(['yes', 'no']).default('no') }),
        body: z.object({ name: z.string().trim().min(1), count: z.number().int().min(0) }),
      },
      handler: ({ params, query, body }) => ({ id: params.id, verbose: query.verbose, ...body }),
    }),
    defineRoute({
      method: 'GET',
      url: '/__test/list',
      access: PUBLIC,
      handler: () => paged(['a', 'b'], { page: 1, pageSize: 2, total: 5 }),
    }),
    defineRoute({
      method: 'GET',
      url: '/__test/not-found',
      access: PUBLIC,
      handler: () => {
        throw new NotFoundError('That student was not found.');
      },
    }),
    defineRoute({
      method: 'GET',
      url: '/__test/conflict',
      access: PUBLIC,
      handler: () => {
        throw new ConflictError('Teacher is already booked for this period.');
      },
    }),
    defineRoute({
      method: 'GET',
      url: '/__test/crash',
      access: PUBLIC,
      handler: () => {
        throw new Error('SQLITE_IOERR: disk I/O error at /secret/path/db.sqlite');
      },
    }),
    defineRoute({
      method: 'GET',
      url: '/__test/protected',
      access: { kind: 'authenticated', permission: 'test.read' },
      handler: ({ principal }) => ({ userId: principal?.userId }),
    }),
  ],
};

const somePrincipal: Principal = {
  userId: 'u-1',
  role: 'TEACHER',
  teacherId: 't-1',
  studentId: null,
};
const alwaysAuthenticated: Authenticator = { authenticate: async () => somePrincipal };
const allowAll: AccessPolicy = { isAllowed: async () => true };

const ID = '6f1b2a7e-3c55-4c0b-9a51-0d8f3e1f2a10';

describe('HTTP foundation', () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  async function setup(...args: Parameters<typeof buildTestApp>) {
    const harness = await buildTestApp(...args);
    close = harness.close;
    return harness.app;
  }

  it('GET /api/v1/health reports the database as up', async () => {
    const app = await setup();
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      data: { status: 'ok', database: 'up', time: '2026-06-01T09:00:00.000Z' },
    });
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('health returns 503 when the database is unreachable', async () => {
    const { store } = await openTestDatabase();
    const unreachable: DataStore = {
      repositories: store.repositories,
      schema: store.schema,
      transaction: (work) => store.transaction(work),
      ping: async () => false,
      close: () => store.close(),
    };
    const app = await setup({ dataStore: unreachable });
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json().data).toMatchObject({ status: 'degraded', database: 'down' });
  });

  it('GET /api/v1/school/branding returns the configured school identity', async () => {
    const app = await setup();
    const res = await app.inject({ method: 'GET', url: '/api/v1/school/branding' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      data: {
        shortName: 'TTLMHSS',
        fullName: 'Thiruthangal Lions Matriculation Higher Secondary School',
        primaryColor: '#003300',
        logoUrl: null,
      },
    });
  });

  it('applies security headers and CORS for configured origins only', async () => {
    const app = await setup();
    const allowed = await app.inject({
      method: 'GET',
      url: '/api/v1/health',
      headers: { origin: 'http://localhost:5173' },
    });
    expect(allowed.headers['x-content-type-options']).toBe('nosniff');
    // testConfig() has no CORS origins configured.
    expect(allowed.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('unknown routes return the standard NOT_FOUND envelope', async () => {
    const app = await setup();
    const res = await app.inject({ method: 'GET', url: '/api/v1/does-not-exist' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      error: {
        code: ErrorCode.NOT_FOUND,
        message: 'The requested resource does not exist.',
        requestId: expect.any(String),
      },
    });
  });

  describe('validation', () => {
    it('passes parsed, typed input to the handler and wraps the result', async () => {
      const app = await setup({}, { extraModules: [probeModule] });
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/__test/echo/${ID}?verbose=yes`,
        payload: { name: '  Arun ', count: 3 },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toEqual({ data: { id: ID, verbose: 'yes', name: 'Arun', count: 3 } });
    });

    it('collects issues from params, query and body into one 400 response', async () => {
      const app = await setup({}, { extraModules: [probeModule] });
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/__test/echo/not-a-uuid?verbose=maybe',
        payload: { name: '', count: -1 },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
      const paths = body.error.details.map((d: { path: string }) => d.path).sort();
      expect(paths).toEqual(['body.count', 'body.name', 'params.id', 'query.verbose']);
    });

    it('malformed JSON is a validation error, not a crash', async () => {
      const app = await setup({}, { extraModules: [probeModule] });
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/__test/echo/${ID}`,
        headers: { 'content-type': 'application/json' },
        payload: '{"name": ',
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe(ErrorCode.VALIDATION_ERROR);
    });
  });

  describe('error mapping', () => {
    it('maps typed application errors to status codes with user-safe messages', async () => {
      const app = await setup({}, { extraModules: [probeModule] });
      const notFound = await app.inject({ method: 'GET', url: '/api/v1/__test/not-found' });
      expect(notFound.statusCode).toBe(404);
      expect(notFound.json().error).toMatchObject({
        code: ErrorCode.NOT_FOUND,
        message: 'That student was not found.',
      });

      const conflict = await app.inject({ method: 'GET', url: '/api/v1/__test/conflict' });
      expect(conflict.statusCode).toBe(409);
      expect(conflict.json().error.code).toBe(ErrorCode.CONFLICT);
    });

    it('hides internal error details from the client', async () => {
      const app = await setup({}, { extraModules: [probeModule] });
      const res = await app.inject({ method: 'GET', url: '/api/v1/__test/crash' });
      expect(res.statusCode).toBe(500);
      expect(res.json().error).toEqual({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Something went wrong. Please try again.',
        requestId: expect.any(String),
      });
      expect(res.body).not.toContain('SQLITE');
      expect(res.body).not.toContain('/secret/path');
    });

    it('wraps paged results with meta', async () => {
      const app = await setup({}, { extraModules: [probeModule] });
      const res = await app.inject({ method: 'GET', url: '/api/v1/__test/list' });
      expect(res.json()).toEqual({ data: ['a', 'b'], meta: { page: 1, pageSize: 2, total: 5 } });
    });
  });

  describe('access control boundary (fail-closed; real authentication arrives in Phase 2)', () => {
    it('refuses non-public routes with 401 when no authentication exists', async () => {
      const app = await setup({}, { extraModules: [probeModule] });
      const res = await app.inject({ method: 'GET', url: '/api/v1/__test/protected' });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe(ErrorCode.UNAUTHORIZED);
    });

    it('returns 403 when a principal exists but the policy denies', async () => {
      const app = await setup(
        { authenticator: alwaysAuthenticated },
        { extraModules: [probeModule] },
      );
      const res = await app.inject({ method: 'GET', url: '/api/v1/__test/protected' });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe(ErrorCode.FORBIDDEN);
    });

    it('lets a pluggable authenticator + policy through, exposing the principal', async () => {
      const app = await setup(
        { authenticator: alwaysAuthenticated, accessPolicy: allowAll },
        { extraModules: [probeModule] },
      );
      const res = await app.inject({ method: 'GET', url: '/api/v1/__test/protected' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ data: { userId: 'u-1' } });
    });

    it('a route without an access declaration is refused, never exposed', async () => {
      const undeclared = {
        name: 'undeclared',
        routes: [{ method: 'GET', url: '/__test/undeclared', handler: () => 'leak' }],
      } as unknown as FeatureModule;
      const app = await setup({}, { extraModules: [undeclared] });
      const res = await app.inject({ method: 'GET', url: '/api/v1/__test/undeclared' });
      expect(res.statusCode).toBe(500);
      expect(res.body).not.toContain('leak');
    });
  });

  it('the server actually listens and answers over HTTP', async () => {
    const app = await setup();
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const res = await fetch(`${address}/api/v1/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { database: string } };
    expect(body.data.database).toBe('up');
  });
});
