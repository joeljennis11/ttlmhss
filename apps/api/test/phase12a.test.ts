import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IsoDateSchema } from '@ttlmhss/shared';
import { buildApp } from '../src/app.js';
import { createAppDependencies } from '../src/composition.js';
import { ConfigError, loadConfig, weakSecretProblem } from '../src/config/config.js';
import type { AccessRequirement } from '../src/core/auth/access.js';
import { ROLE_PERMISSIONS } from '../src/core/auth/role-permissions.js';
import { featureModules } from '../src/modules.js';
import { adminSession, call, sessionFor, type Session } from './support/api-helpers.js';
import {
  assignClassTeacher,
  createSchoolStructure,
  enrol,
  linkStudent,
  linkTeacher,
  seedAccount,
} from './support/auth-fixtures.js';
import {
  buildTestApp,
  fixedClock,
  openTestDatabase,
  type TestApp,
} from './support/test-harness.js';

/*
 * Phase 12A — production hardening and security. TEST DATA ONLY: synthetic accounts in throwaway
 * databases. The "secrets" below are random-looking test strings, not real credentials.
 */
const GOOD_SECRET = 'q7Vx2LmN9pR4tY8wZ3kJ6hG1fD5sA0bC';
const PROD = {
  NODE_ENV: 'production',
  DATABASE_URL: 'sqlite:./data/never-opened.sqlite',
  CORS_ORIGINS: 'https://school.test',
  SESSION_SECRET: GOOD_SECRET,
  // Phase 12C: production must decide explicitly whether a local reverse proxy is trusted.
  TRUST_PROXY: 'true',
};

function problemsOf(env: Record<string, string>): string {
  try {
    loadConfig({ readEnvFiles: false, env });
  } catch (error) {
    if (error instanceof ConfigError) return error.problems.join('\n');
    throw error;
  }
  return '';
}

describe('unsafe production configuration is rejected', () => {
  it('accepts a safe production configuration (secure cookies + HSTS)', () => {
    const config = loadConfig({ readEnvFiles: false, env: PROD });
    expect(config.auth.cookieSecure).toBe(true);
    expect(config.hsts).toBe(true);
    expect(config.auth.sessionSecretIsEphemeral).toBe(false);
  });

  it.each([
    ['missing session secret', { SESSION_SECRET: '' }, 'SESSION_SECRET: is required'],
    ['short session secret', { SESSION_SECRET: 'short' }, 'at least 32'],
    ['repetitive secret', { SESSION_SECRET: 'a'.repeat(40) }, 'too repetitive'],
    [
      'placeholder secret',
      { SESSION_SECRET: 'please-change-me-to-a-long-random-value-0123' },
      'placeholder',
    ],
    ['insecure cookies', { COOKIE_SECURE: 'false' }, 'COOKIE_SECURE: cannot be false'],
    ['no CORS origins', { CORS_ORIGINS: '' }, 'CORS_ORIGINS: must list'],
    ['wildcard origin', { CORS_ORIGINS: '*' }, 'wildcards are not allowed'],
    ['plain-http origin', { CORS_ORIGINS: 'http://school.test' }, 'must use https'],
    ['origin with a path', { CORS_ORIGINS: 'https://school.test/app' }, 'origin only'],
    ['in-memory database', { DATABASE_URL: 'sqlite::memory:' }, 'in-memory database'],
  ])('%s', (_label, override, expected) => {
    const problems = problemsOf({ ...PROD, ...override });
    expect(problems).toContain(expected);
    // Values are never echoed back.
    for (const value of Object.values(override)) {
      if (value.length > 8) expect(problems).not.toContain(value);
    }
  });

  it('rejects wildcard / malformed CORS origins in every environment, keeps localhost dev', () => {
    const dev = { NODE_ENV: 'development', DATABASE_URL: 'sqlite::memory:' };
    expect(problemsOf({ ...dev, CORS_ORIGINS: '*' })).toContain('wildcards');
    expect(problemsOf({ ...dev, CORS_ORIGINS: 'javascript:alert(1)' })).not.toBe('');
    const ok = loadConfig({
      readEnvFiles: false,
      env: { ...dev, CORS_ORIGINS: 'http://localhost:5173' },
    });
    expect(ok.corsOrigins).toEqual(['http://localhost:5173']);
    expect(ok.hsts).toBe(false);
    expect(ok.auth.cookieSecure).toBe(false);
  });

  it('judges weak secrets without needing the environment', () => {
    expect(weakSecretProblem(GOOD_SECRET)).toBeNull();
    expect(weakSecretProblem('abababababababababababababababab')).not.toBeNull();
  });
});

describe('production process', () => {
  it('can never mount test-only modules, and sends HSTS + secure cookies', async () => {
    const config = loadConfig({ readEnvFiles: false, env: { ...PROD, LOG_LEVEL: 'silent' } });
    const { store } = await openTestDatabase('sqlite');
    const deps = createAppDependencies(config, store, { clock: fixedClock() });
    await expect(
      buildApp(deps, { logger: false, extraModules: [{ name: 'test-only', routes: [] }] }),
    ).rejects.toThrow('Test modules cannot be registered in production');

    const app = await buildApp(deps, { logger: false });
    await seedAccount(deps, { username: 'prod.admin', role: 'ADMIN' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: 'https://school.test' },
      payload: { username: 'prod.admin', password: 'Correct-horse-42' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['strict-transport-security']).toContain('max-age=31536000');
    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toMatch(/^__Host-/);
    expect(setCookie).toMatch(/Secure/);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    await app.close();
    await store.close();
  });
});

describe('security headers, CORS and errors', () => {
  let h: TestApp;
  beforeEach(async () => {
    h = await buildTestApp({}, { env: { CORS_ORIGINS: 'http://localhost:5173' } });
  });
  afterEach(() => h.close());

  it('sends a strict API CSP and the protective headers (no HSTS over plain http)', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/health' });
    const csp = String(res.headers['content-security-policy']);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(String(res.headers['permissions-policy'])).toContain('camera=()');
    expect(res.headers['strict-transport-security']).toBeUndefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('allows only configured origins with credentials', async () => {
    const allowed = await h.app.inject({
      method: 'OPTIONS',
      url: '/api/v1/auth/login',
      headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'POST' },
    });
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');
    const evil = await h.app.inject({
      method: 'OPTIONS',
      url: '/api/v1/auth/login',
      headers: { origin: 'https://evil.test', 'access-control-request-method': 'POST' },
    });
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
    // A cross-site state change is refused even without CORS.
    const cross = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: 'https://evil.test' },
      payload: { username: 'x.user', password: 'whatever-123' },
    });
    expect(cross.statusCode).toBe(403);
  });

  it('never leaks internals in error responses', async () => {
    const bad = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: '{"username": ',
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.body).not.toMatch(/at \w+ \(|node_modules|SyntaxError|\/home\/|sqlite|SELECT/i);
    const unknown = await h.app.inject({ method: 'GET', url: '/api/v1/no-such-route' });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.body).not.toMatch(/node_modules|\/home\//);
  });

  it('does not reveal whether a username exists', async () => {
    await seedAccount(h.deps, { username: 'real.user', role: 'TEACHER' });
    const wrong = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'real.user', password: 'Wrong-password-1' },
    });
    const missing = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'ghost.user', password: 'Wrong-password-1' },
    });
    expect(wrong.statusCode).toBe(missing.statusCode);
    expect(JSON.parse(wrong.body).error.message).toBe(JSON.parse(missing.body).error.message);
  });

  it('blocks deactivated accounts and ends their sessions', async () => {
    await seedAccount(h.deps, { username: 'gone.user', role: 'TEACHER', status: 'INACTIVE' });
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'gone.user', password: 'Correct-horse-42' },
    });
    expect(res.statusCode).toBe(401);
  });
});

/** Fill route parameters with well-formed ids that match no record. */
const concrete = (url: string) => `/api/v1${url.replace(/:\w+/g, () => randomUUID())}`;

describe('RBAC audit of every route', () => {
  let h: TestApp;
  beforeEach(async () => {
    h = await buildTestApp();
  });
  afterEach(() => h.close());

  const routes = () =>
    featureModules(h.deps).flatMap((m) =>
      m.routes.map((r) => ({
        method: r.method,
        url: r.url,
        access: r.access as AccessRequirement,
      })),
    );

  it('every route declares access; anonymous callers get 401 on every protected route', async () => {
    const all = routes();
    expect(all.length).toBeGreaterThan(150);
    const publicRoutes = all.filter((r) => r.access.kind === 'public').map((r) => r.url);
    // The whole public surface — nothing else is reachable without signing in.
    expect(publicRoutes.sort()).toEqual([
      '/auth/login',
      '/auth/logout',
      '/health',
      '/school/branding',
    ]);
    for (const r of all.filter((x) => x.access.kind !== 'public')) {
      const res = await h.app.inject({ method: r.method as 'GET', url: concrete(r.url) });
      expect(res.statusCode, `${r.method} ${r.url}`).toBe(401);
    }
  });

  it.each(['STUDENT', 'TEACHER'] as const)(
    '%s is refused (403) on every route needing a permission it does not hold',
    async (role) => {
      await seedAccount(h.deps, { username: `audit.${role.toLowerCase()}`, role });
      const s = await sessionFor(h, `audit.${role.toLowerCase()}`);
      const held = new Set<string>(ROLE_PERMISSIONS[role]);
      const guarded = routes().filter(
        (r) =>
          r.access.kind === 'authenticated' &&
          r.access.permission &&
          !held.has(r.access.permission),
      );
      expect(guarded.length).toBeGreaterThan(20);
      for (const r of guarded) {
        const res = await h.app.inject({
          method: r.method as 'GET',
          url: concrete(r.url),
          headers: { cookie: s.cookie },
          ...(r.method === 'GET' || r.method === 'DELETE' ? {} : { payload: {} }),
        });
        expect(res.statusCode, `${role} ${r.method} ${r.url}`).toBe(403);
      }
    },
  );

  it('a temporary password allows nothing but the password change', async () => {
    await seedAccount(h.deps, { username: 'temp.user', role: 'ADMIN', temporary: true });
    const s = await sessionFor(h, 'temp.user');
    const res = await call(s, 'GET', '/admin/students');
    expect(res.status).toBe(403);
    expect(res.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
  });
});

describe.each(['sqlite', 'postgres'] as const)('IDOR and input validation (%s)', (driver) => {
  let h: TestApp;
  let admin: Session;
  let school: Awaited<ReturnType<typeof createSchoolStructure>>;
  let ids: {
    student1: string;
    student2: string;
    teacherA: string;
    otherTeacher: string;
  };
  let s1: Session;
  let ctA: Session;
  let other: Session;

  beforeEach(async () => {
    const opened = await openTestDatabase(driver);
    h = await buildTestApp({ dataStore: opened.store });
    h = { ...h, db: opened.db };
    admin = await adminSession(h);
    school = await createSchoolStructure(h.db);
    const u1 = await seedAccount(h.deps, { username: 'idor.s1', role: 'STUDENT' });
    const u2 = await seedAccount(h.deps, { username: 'idor.s2', role: 'STUDENT' });
    const t1 = await seedAccount(h.deps, { username: 'idor.cta', role: 'TEACHER' });
    const t2 = await seedAccount(h.deps, { username: 'idor.t2', role: 'TEACHER' });
    ids = {
      student1: await linkStudent(h.db, u1, 'Synthetic One'),
      student2: await linkStudent(h.db, u2, 'Synthetic Two'),
      teacherA: await linkTeacher(h.db, t1, 'Synthetic Teacher A'),
      otherTeacher: await linkTeacher(h.db, t2, 'Synthetic Teacher B'),
    };
    await enrol(h.db, ids.student1, school.yearId, school.sectionA);
    await enrol(h.db, ids.student2, school.yearId, school.sectionB);
    await assignClassTeacher(h.db, ids.teacherA, school.yearId, school.sectionA);
    s1 = await sessionFor(h, 'idor.s1');
    ctA = await sessionFor(h, 'idor.cta');
    other = await sessionFor(h, 'idor.t2');
  });
  afterEach(() => h.close());

  it('students cannot reach another student by changing an id', async () => {
    const q = `from=2026-06-01&to=2026-06-30`;
    const urls = [
      `/reports/attendance/student?studentId=${ids.student2}&${q}`,
      `/reports/exam-card?examId=${randomUUID()}&studentId=${ids.student2}`,
      `/reports/performance?studentId=${ids.student2}`,
      `/reports/annual?academicYearId=${school.yearId}&studentId=${ids.student2}`,
      `/attendance/students/${ids.student2}?${q}`,
      `/admin/students/${ids.student2}`,
      `/behaviour/students/${ids.student2}`,
    ];
    for (const url of urls) {
      const res = await call(s1, 'GET', url);
      expect([403, 404], url).toContain(res.status);
      expect(res.raw, url).not.toContain('Synthetic Two');
    }
  });

  it('class teachers are limited to their own section', async () => {
    const q = `from=2026-06-01&to=2026-06-30`;
    for (const url of [
      `/reports/attendance/student?studentId=${ids.student2}&${q}`,
      `/reports/attendance/class?sectionId=${school.sectionB}&${q}`,
      `/reports/annual?academicYearId=${school.yearId}&studentId=${ids.student2}`,
      `/reports/annual/section?academicYearId=${school.yearId}&sectionId=${school.sectionB}`,
      `/reports/performance?studentId=${ids.student2}`,
    ]) {
      const res = await call(ctA, 'GET', url);
      expect(res.status, url).toBe(403);
      expect(res.raw, url).not.toContain('Synthetic Two');
    }
    const prepare = await call(ctA, 'POST', '/reports/annual', {
      academicYearId: school.yearId,
      studentId: ids.student2,
    });
    expect(prepare.status).toBe(403);
    // A subject teacher without the class-teacher assignment sees neither section.
    const res = await call(
      other,
      'GET',
      `/reports/attendance/class?sectionId=${school.sectionA}&${q}`,
    );
    expect(res.status).toBe(403);
  });

  it('rejects malformed ids, enums, dates, ranges and page sizes with 400', async () => {
    for (const url of [
      '/admin/students/not-an-id',
      '/admin/students?classId=abc',
      `/admin/students?academicYearId=1%20OR%201=1`,
      '/admin/students?pageSize=100000',
      '/admin/students?page=-1',
      '/admin/students?status=WHATEVER',
      '/admin/teachers?subjectId=x',
      `/admin/promotions/candidates?sourceAcademicYearId=x&sourceSectionId=y`,
      `/reports/attendance/class?sectionId=${school.sectionA}&from=2026-02-30&to=2026-03-01`,
      `/reports/attendance/class?sectionId=${school.sectionA}&from=2026-07-01&to=2026-06-01`,
      `/reports/exam-card?examId=${randomUUID()}&studentId=${ids.student1}&format=exe`,
    ]) {
      const res = await call(admin, 'GET', url);
      expect(res.status, url).toBe(400);
    }
    // An empty filter still means "no filter".
    expect((await call(admin, 'GET', '/admin/students?classId=&sectionId=')).status).toBe(200);
    expect(IsoDateSchema.safeParse('2026-13-01').success).toBe(false);
  });
});

describe('rate limits on sensitive and costly routes', () => {
  let h: TestApp;
  beforeEach(async () => {
    h = await buildTestApp();
  });
  afterEach(() => h.close());

  it('limits temporary-password issuance per account', async () => {
    const admin = await adminSession(h);
    const id = randomUUID();
    const statuses: number[] = [];
    for (let i = 0; i < 21; i += 1) {
      statuses.push((await call(admin, 'POST', `/admin/students/${id}/temporary-password`)).status);
    }
    expect(statuses.slice(0, 20).every((s) => s === 404)).toBe(true);
    expect(statuses[20]).toBe(429);
    // A different administrator has their own allowance.
    const second = await adminSession(h, 'second.admin');
    expect((await call(second, 'POST', `/admin/students/${id}/temporary-password`)).status).toBe(
      404,
    );
  });

  it('limits report generation per account', async () => {
    const admin = await adminSession(h);
    let last = 0;
    for (let i = 0; i < 61; i += 1) {
      last = (await call(admin, 'GET', `/reports/performance?studentId=${randomUUID()}`)).status;
    }
    expect(last).toBe(429);
  });
});
