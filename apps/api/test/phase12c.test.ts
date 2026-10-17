/* eslint-disable @typescript-eslint/no-explicit-any -- test assertions read untyped JSON response bodies */
import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config/config.js';
import { configChecks, liveChecks } from '../src/core/ops/readiness.js';
import { unavailableSmsSender } from '../src/core/sms/sms-sender.js';
import type { Database } from '../src/data/kysely/database-schema.js';
import { adminSession, call, sessionFor, type Session } from './support/api-helpers.js';
import { PASSWORD, assignClassTeacher, linkTeacher, seedAccount } from './support/auth-fixtures.js';
import {
  MutableClock,
  buildTestApp,
  openTestDatabase,
  type TestApp,
  type TestDriver,
} from './support/test-harness.js';

/*
 * Phase 12C — deployment readiness, sign-in throttling for a shared school network, and timetable
 * change requests. TEST DATA ONLY: synthetic accounts in throwaway databases; the "secret" values
 * below are random-looking test strings, not real credentials.
 */
const GOOD_SECRET = 'q7Vx2LmN9pR4tY8wZ3kJ6hG1fD5sA0bC';
const PROD = {
  NODE_ENV: 'production',
  DATABASE_URL: 'sqlite:./data/never-opened.sqlite',
  CORS_ORIGINS: 'https://school.test',
  SESSION_SECRET: GOOD_SECRET,
  TRUST_PROXY: 'true',
};
const problems = (env: Record<string, string>) => {
  try {
    loadConfig({ readEnvFiles: false, env });
    return '';
  } catch (error) {
    if (error instanceof ConfigError) return error.problems.join('\n');
    throw error;
  }
};

describe('production configuration (Phase 12C additions)', () => {
  it('requires an explicit proxy decision, and trusting the proxy only on a loopback address', () => {
    expect(problems(PROD)).toBe('');
    const { TRUST_PROXY: _omit, ...noProxy } = PROD;
    expect(problems(noProxy)).toContain('TRUST_PROXY: must be set explicitly');
    expect(problems({ ...PROD, HOST: '0.0.0.0' })).toContain('requires HOST to be a loopback');
    expect(problems({ ...PROD, HOST: '0.0.0.0', TRUST_PROXY: 'false' })).toBe('');
  });

  it('refuses an SMS provider that does not exist, and never pretends to send', async () => {
    expect(problems({ ...PROD, SMS_PROVIDER: 'twilio' })).toContain('SMS_PROVIDER');
    expect(unavailableSmsSender.available).toBe(false);
    await expect(unavailableSmsSender.send('+910000000000', 'x')).rejects.toThrow(/not configured/);
  });

  it('school-network defaults: 60 sign-ins per minute per address, 5 per user+address, 20 per user', () => {
    const c = loadConfig({ readEnvFiles: false, env: PROD });
    expect(c.auth).toMatchObject({
      loginRateLimitPerMinute: 60,
      maxFailedAttempts: 5,
      accountMaxFailedAttempts: 20,
    });
  });

  it('readiness checks report problems without revealing secret values', () => {
    const good = configChecks(loadConfig({ readEnvFiles: false, env: PROD }));
    expect(good.every((c) => c.ok)).toBe(true);
    expect(JSON.stringify(good)).not.toContain(GOOD_SECRET);
    const dev = configChecks(
      loadConfig({
        readEnvFiles: false,
        env: { NODE_ENV: 'development', DATABASE_URL: 'sqlite::memory:' },
      }),
    );
    expect(dev.filter((c) => !c.ok).map((c) => c.name)).toEqual(
      expect.arrayContaining([
        'environment',
        'session secret',
        'secure cookies + HSTS',
        'CORS origins',
        'database',
      ]),
    );
  });
});

describe('health, caching and live readiness checks', () => {
  let h: TestApp;
  beforeEach(async () => {
    h = await buildTestApp();
  });
  afterEach(() => h.close());

  it('the public health endpoint reveals only status, database up/down and time', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.json().data).sort()).toEqual(['database', 'status', 'time']);
    expect(res.body).not.toMatch(/sqlite|postgres|version|node|memory|secret/i);
  });

  it('every API answer is no-store (authenticated data is never cached)', async () => {
    const admin = await adminSession(h);
    for (const url of ['/auth/me', '/dashboard', '/timetable/years']) {
      const r = await call(admin, 'GET', url);
      expect(r.headers['cache-control'], url).toBe('no-store');
    }
    const health = await h.app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(health.headers['cache-control']).toBe('no-store');
  });

  it('live checks detect a missing HSTS / web CSP and pass health, privacy and unknown routes', async () => {
    const fetcher = async (url: string) => {
      const path = url.replace('http://school.test', '');
      if (!path.startsWith('/api')) {
        // A stand-in web server returning the app shell (what the proxy serves for client routes).
        return new Response('<!doctype html><div id="root"></div>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      }
      const res = await h.app.inject({ method: 'GET', url: path });
      return new Response(res.body, {
        status: res.statusCode,
        headers: Object.entries(res.headers).map(([k, v]) => [k, String(v)]) as [string, string][],
      });
    };
    const checks = await liveChecks('http://school.test', fetcher);
    const byName = Object.fromEntries(checks.map((c) => [c.name, c.ok]));
    expect(byName).toMatchObject({
      'health endpoint': true,
      'health endpoint privacy': true,
      'web app and client-side routes': true,
      'unknown API route': true,
      // Plain-http test app: no HSTS, and the stand-in web server sends no headers.
      'API security headers': false,
      'web security headers': false,
    });
  });
});

describe('sign-in throttling for a school that shares one network address (D-121)', () => {
  let h: TestApp;
  let clock: MutableClock;
  const login = (username: string, password: string, ip = '203.0.113.10', xff?: string) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      remoteAddress: ip,
      headers: xff ? { 'x-forwarded-for': xff } : {},
      payload: { username, password },
    });

  async function build(env: Record<string, string> = {}) {
    clock = new MutableClock('2026-10-01T03:30:00.000Z');
    h = await buildTestApp({ clock }, { env });
  }
  afterEach(() => h.close());

  it('a whole class signs in from one address within a minute', async () => {
    await build();
    for (let i = 0; i < 45; i += 1)
      await seedAccount(h.deps, { username: `pupil.${i}`, role: 'STUDENT' });
    const statuses: number[] = [];
    for (let i = 0; i < 45; i += 1) statuses.push((await login(`pupil.${i}`, PASSWORD)).statusCode);
    expect(statuses.every((s) => s === 200)).toBe(true);
  });

  it('wrong passwords lock that user only from that address, temporarily, with a neutral message', async () => {
    await build();
    await seedAccount(h.deps, { username: 'teacher.a', role: 'TEACHER' });
    for (let i = 0; i < 5; i += 1) {
      expect((await login('teacher.a', 'Wrong-pass-1', '198.51.100.7')).statusCode).toBe(401);
    }
    const locked = await login('teacher.a', PASSWORD, '198.51.100.7');
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error.message).toMatch(/wait a few minutes/i);
    // The real teacher at school (another address) is not affected.
    expect((await login('teacher.a', PASSWORD, '203.0.113.10')).statusCode).toBe(200);
    // Unknown usernames behave identically (no enumeration).
    for (let i = 0; i < 5; i += 1) await login('ghost.user', 'Wrong-pass-1', '198.51.100.7');
    const ghost = await login('ghost.user', 'Wrong-pass-1', '198.51.100.7');
    expect(ghost.statusCode).toBe(429);
    expect(ghost.json().error.message).toBe(locked.json().error.message);
    // Never permanent.
    clock.advance(16 * 60_000);
    expect((await login('teacher.a', PASSWORD, '198.51.100.7')).statusCode).toBe(200);
  });

  it('distributed guessing locks unknown addresses, not the address the user normally signs in from', async () => {
    await build();
    await seedAccount(h.deps, { username: 'teacher.b', role: 'TEACHER' });
    expect((await login('teacher.b', PASSWORD, '203.0.113.10')).statusCode).toBe(200); // school
    for (let i = 0; i < 20; i += 1) {
      await login('teacher.b', 'Wrong-pass-1', `192.0.2.${i + 1}`);
    }
    // A new address — even with the right password — is refused while the account is under attack…
    expect((await login('teacher.b', PASSWORD, '192.0.2.200')).statusCode).toBe(429);
    // …but the teacher keeps working from school.
    expect((await login('teacher.b', PASSWORD, '203.0.113.10')).statusCode).toBe(200);
    clock.advance(16 * 60_000);
    expect((await login('teacher.b', PASSWORD, '192.0.2.200')).statusCode).toBe(200);
  });

  it('forwarded addresses are ignored unless TRUST_PROXY is set', async () => {
    await build({ TRUST_PROXY: 'false' });
    await seedAccount(h.deps, { username: 'teacher.c', role: 'TEACHER' });
    // A client cannot dodge the lock by inventing X-Forwarded-For values.
    for (let i = 0; i < 5; i += 1)
      await login('teacher.c', 'Wrong-pass-1', '198.51.100.9', `10.0.0.${i}`);
    expect((await login('teacher.c', PASSWORD, '198.51.100.9', '10.9.9.9')).statusCode).toBe(429);
  });

  it('behind the trusted local proxy, each client address is counted separately', async () => {
    await build({ TRUST_PROXY: 'true' });
    await seedAccount(h.deps, { username: 'teacher.d', role: 'TEACHER' });
    for (let i = 0; i < 5; i += 1)
      await login('teacher.d', 'Wrong-pass-1', '127.0.0.1', '198.51.100.20');
    expect((await login('teacher.d', PASSWORD, '127.0.0.1', '198.51.100.20')).statusCode).toBe(429);
    expect((await login('teacher.d', PASSWORD, '127.0.0.1', '203.0.113.10')).statusCode).toBe(200);
  });

  it('the per-address request limit still stops a flood from one source', async () => {
    await build({ LOGIN_RATE_LIMIT_PER_MINUTE: '5' });
    const codes: number[] = [];
    for (let i = 0; i < 6; i += 1)
      codes.push((await login(`flood.${i}`, 'x-x-x-x-1', '198.51.100.30')).statusCode);
    expect(codes.at(-1)).toBe(429);
  });
});

// ---------------------------------------------------------------------------------------------
// Timetable change requests
// ---------------------------------------------------------------------------------------------

interface School {
  year: string;
  xA: string;
  xB: string;
  p1: string;
  p2: string;
  maths: string;
  science: string;
  arun: string;
  priya: string;
  kumar: string;
  entryA: string;
}

describe.each<TestDriver>(['sqlite', 'postgres'])('timetable change requests (%s)', (driver) => {
  let h: TestApp;
  let db: Kysely<Database>;
  let admin: Session;
  let kumar: Session; // class teacher of X-A (no timetable.manage)
  let arun: Session; // subject teacher
  let s: School;

  const ok = async (who: Session, method: string, url: string, body?: unknown) => {
    const r = await call(who, method, url, body);
    if (r.status >= 300) throw new Error(`${method} ${url}: ${r.status} ${r.raw}`);
    return r.data;
  };

  beforeEach(async () => {
    const opened = await openTestDatabase(driver);
    db = opened.db;
    h = await buildTestApp({
      dataStore: opened.store,
      clock: new MutableClock('2026-09-01T03:30:00.000Z'),
    });
    admin = await adminSession(h);
    const a = (m: string, u: string, b?: unknown) => ok(admin, m, u, b);
    const year = await a('POST', '/admin/academic-years', {
      label: 'TCR-2026',
      startDate: '2026-06-01',
      endDate: '2027-03-31',
    });
    await a('POST', `/admin/academic-years/${year.id}/make-current`);
    await a('PUT', `/admin/academic-years/${year.id}/working-days`, {
      workingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
    });
    await a('POST', `/admin/academic-years/${year.id}/periods`, {
      kind: 'LESSON',
      label: 'Period 1',
      periodNumber: 1,
      startTime: '08:00',
      endTime: '08:45',
    });
    const day = await a('POST', `/admin/academic-years/${year.id}/periods`, {
      kind: 'LESSON',
      label: 'Period 2',
      periodNumber: 2,
      startTime: '08:45',
      endTime: '09:30',
    });
    const slot = (l: string) => day.slots.find((x: any) => x.label === l).id;
    const x = await a('POST', '/admin/classes', { name: 'TCR-X', displayOrder: 1 });
    await a('POST', `/admin/classes/${x.id}/sections`, { name: 'A' });
    const xc = await a('POST', `/admin/classes/${x.id}/sections`, { name: 'B' });
    const sec = (n: string) => xc.sections.find((q: any) => q.name === n).id;
    const maths = await a('POST', '/admin/subjects', {
      name: 'TCR Maths',
      code: null,
      displayOrder: 1,
    });
    const science = await a('POST', '/admin/subjects', {
      name: 'TCR Science',
      code: null,
      displayOrder: 2,
    });
    const teacher = async (username: string, name: string) =>
      linkTeacher(db, await seedAccount(h.deps, { username, role: 'TEACHER' }), name);
    const arunId = await teacher('tcr.arun', 'TCR Arun');
    const priyaId = await teacher('tcr.priya', 'TCR Priya');
    const kumarId = await teacher('tcr.kumar', 'TCR Kumar');
    await a('POST', `/admin/teachers/${arunId}/subjects`, { subjectId: maths.id });
    await a('POST', `/admin/teachers/${priyaId}/subjects`, { subjectId: science.id });
    await assignClassTeacher(db, kumarId, year.id, sec('A'));
    await a('POST', `/timetable/years/${year.id}/draft`);
    const entryA = randomUUID();
    await a('POST', `/timetable/years/${year.id}/draft/changes`, {
      sectionId: sec('A'),
      operations: [
        {
          op: 'create',
          id: entryA,
          day: 'MON',
          periodId: slot('Period 1'),
          sectionId: sec('A'),
          subjectId: maths.id,
          teacherId: arunId,
        },
      ],
    });
    await a('POST', `/timetable/years/${year.id}/draft/publish`);
    s = {
      year: year.id,
      xA: sec('A'),
      xB: sec('B'),
      p1: slot('Period 1'),
      p2: slot('Period 2'),
      maths: maths.id,
      science: science.id,
      arun: arunId,
      priya: priyaId,
      kumar: kumarId,
      entryA,
    };
    kumar = await sessionFor(h, 'tcr.kumar');
    arun = await sessionFor(h, 'tcr.arun');
  }, 120_000);
  afterEach(() => h.close());

  const ask = (who: Session, body: Record<string, unknown>) =>
    call(who, 'POST', '/timetable/change-requests', {
      academicYearId: s.year,
      sectionId: s.xA,
      day: 'MON',
      periodId: s.p1,
      kind: 'CHANGE',
      subjectId: s.science,
      teacherId: s.priya,
      reason: 'Maths teacher is on exam duty on Mondays.',
      ...body,
    });

  it('a class teacher asks; administrators see it on the dashboard; approval goes into the draft only', async () => {
    const options = await ok(kumar, 'GET', '/timetable/change-requests/options');
    expect(options.sections).toEqual([{ id: s.xA, label: 'TCR-X A' }]);
    expect(options.teachers.find((t: any) => t.id === s.priya).subjectIds).toEqual([s.science]);

    // Without timetable.manage the class teacher cannot edit the draft directly.
    expect((await call(kumar, 'POST', `/timetable/years/${s.year}/draft`)).status).toBe(403);

    const created = await ask(kumar, {});
    expect(created.status, created.raw).toBe(201);
    expect(created.data).toMatchObject({
      status: 'PENDING',
      kind: 'CHANGE',
      section: { label: 'TCR-X A' },
      current: { subject: { name: 'TCR Maths' }, teacher: { name: 'TCR Arun' } },
      proposed: { subject: { name: 'TCR Science' }, teacher: { name: 'TCR Priya' } },
      requestedBy: 'TCR Kumar',
      canWithdraw: true,
      canReview: false,
    });
    // Repeated submission for the same slot is refused (no duplicate notifications).
    expect((await ask(kumar, {})).status).toBe(409);

    const dash = await ok(admin, 'GET', '/dashboard');
    expect(dash.admin.timetableRequests.pending).toBe(1);
    expect(dash.admin.timetableRequests.items[0]).toMatchObject({
      section: 'TCR-X A',
      day: 'MON',
      period: 'Period 1',
      requestedBy: 'TCR Kumar',
    });
    // The dashboard count equals the review list's count.
    const pending = await ok(admin, 'GET', '/timetable/change-requests?status=PENDING');
    expect(pending.pending).toBe(1);
    expect(pending.items[0].canReview).toBe(true);
    // The class teacher's dashboard carries no administrator block.
    expect((await ok(kumar, 'GET', '/dashboard')).admin).toBeNull();

    // Only administrators review.
    const id = created.data.id;
    expect(
      (await call(kumar, 'POST', `/timetable/change-requests/${id}/approve`, { revision: 1 }))
        .status,
    ).toBe(403);
    expect(
      (await call(admin, 'POST', `/timetable/change-requests/${id}/approve`, { revision: 9 }))
        .status,
    ).toBe(409);

    const approved = await ok(admin, 'POST', `/timetable/change-requests/${id}/approve`, {
      revision: 1,
    });
    expect(approved).toMatchObject({ status: 'APPROVED', reviewedBy: expect.any(String) });
    // The draft holds the change; the published timetable is untouched until publishing.
    const editor = await ok(admin, 'GET', `/timetable/years/${s.year}/editor?sectionId=${s.xA}`);
    expect(JSON.stringify(editor)).toContain('TCR Priya');
    const live = await ok(admin, 'GET', `/timetable/years/${s.year}/sections/${s.xA}`);
    expect(JSON.stringify(live)).toContain('TCR Arun');
    expect(JSON.stringify(live)).not.toContain('TCR Priya');
    await ok(admin, 'POST', `/timetable/years/${s.year}/draft/publish`);
    expect(
      JSON.stringify(await ok(admin, 'GET', `/timetable/years/${s.year}/sections/${s.xA}`)),
    ).toContain('TCR Priya');
    expect((await ok(admin, 'GET', '/dashboard')).admin.timetableRequests.pending).toBe(0);

    // Audited.
    const audit = await db
      .selectFrom('audit_logs')
      .select(['action'])
      .where('entity_id', '=', id)
      .orderBy('occurred_at')
      .execute();
    expect(audit.map((a) => a.action)).toEqual([
      'timetable.change_requested',
      'timetable.change_request_approved',
    ]);
  });

  it('scope and validation: own class only, qualified teachers, correct kind', async () => {
    expect((await ask(kumar, { sectionId: s.xB })).status).toBe(403);
    expect((await ask(arun, {})).status).toBe(403); // subject teacher
    expect((await call(arun, 'GET', '/timetable/change-requests')).status).toBe(403);
    // Priya does not teach maths (Teacher → Subject).
    const unqualified = await ask(kumar, { subjectId: s.maths, teacherId: s.priya });
    expect(unqualified.status).toBe(409);
    // ADD on an occupied slot, CHANGE on an empty one.
    expect((await ask(kumar, { kind: 'ADD' })).status).toBe(409);
    expect((await ask(kumar, { periodId: s.p2 })).status).toBe(409);
    // REMOVE needs no proposal; decline needs a reason.
    const remove = await ask(kumar, { kind: 'REMOVE', subjectId: null, teacherId: null });
    expect(remove.status, remove.raw).toBe(201);
    const id = remove.data.id;
    expect(
      (await call(admin, 'POST', `/timetable/change-requests/${id}/decline`, { revision: 1 }))
        .status,
    ).toBe(400);
    const declined = await ok(admin, 'POST', `/timetable/change-requests/${id}/decline`, {
      revision: 1,
      note: 'Maths needs this period.',
    });
    expect(declined).toMatchObject({ status: 'DECLINED', reviewNote: 'Maths needs this period.' });
    // Once dealt with it cannot be approved.
    expect(
      (await call(admin, 'POST', `/timetable/change-requests/${id}/approve`, { revision: 2 }))
        .status,
    ).toBe(409);
    // A student sees nothing.
    await seedAccount(h.deps, { username: 'tcr.student', role: 'STUDENT' });
    const student = await sessionFor(h, 'tcr.student');
    expect((await call(student, 'GET', '/timetable/change-requests')).status).toBe(403);
  });

  it('a stale request or a clash found at approval is refused and stays pending', async () => {
    // Stale: the administrator changes the slot in a draft after the request was made.
    const req = (await ask(kumar, {})).data;
    await ok(admin, 'POST', `/timetable/years/${s.year}/draft`);
    const editor = await ok(admin, 'GET', `/timetable/years/${s.year}/editor?sectionId=${s.xA}`);
    const entry = JSON.stringify(editor).match(/"id":"([0-9a-f-]{36})"[^{}]*"subject"/)?.[1];
    const draftEntry = editor.entries?.[0]?.id ?? entry;
    await ok(admin, 'POST', `/timetable/years/${s.year}/draft/changes`, {
      sectionId: s.xA,
      operations: [{ op: 'remove', entryId: draftEntry }],
    });
    const stale = await call(admin, 'POST', `/timetable/change-requests/${req.id}/approve`, {
      revision: 1,
    });
    expect(stale.status).toBe(409);
    expect(stale.error.message).toMatch(/has changed since this request/);
    expect((await ok(admin, 'GET', `/timetable/change-requests/${req.id}`)).status).toBe('PENDING');

    // Clash: an ADD for Arun in Period 2 of X-A, but Arun is put in X-B's Period 2 meanwhile.
    const add = (
      await ask(kumar, { kind: 'ADD', periodId: s.p2, subjectId: s.maths, teacherId: s.arun })
    ).data;
    await ok(admin, 'POST', `/timetable/years/${s.year}/draft/changes`, {
      sectionId: s.xB,
      operations: [
        {
          op: 'create',
          id: randomUUID(),
          day: 'MON',
          periodId: s.p2,
          sectionId: s.xB,
          subjectId: s.maths,
          teacherId: s.arun,
        },
      ],
    });
    const clash = await call(admin, 'POST', `/timetable/change-requests/${add.id}/approve`, {
      revision: 1,
    });
    expect(clash.status).toBe(409);
    expect((await ok(admin, 'GET', `/timetable/change-requests/${add.id}`)).status).toBe('PENDING');
    // The requester may withdraw; nobody else can.
    expect(
      (await call(admin, 'POST', `/timetable/change-requests/${add.id}/withdraw`, { revision: 1 }))
        .status,
    ).toBe(403);
    expect(
      (await ok(kumar, 'POST', `/timetable/change-requests/${add.id}/withdraw`, { revision: 1 }))
        .status,
    ).toBe('WITHDRAWN');
  });

  it('migration 0014 rolls back and re-applies', async () => {
    const store = h.deps.dataStore;
    expect(await store.schema.rollbackLast()).toBe('0014_timetable_change_requests');
    await expect(
      db.selectFrom('timetable_change_requests').selectAll().execute(),
    ).rejects.toThrow();
    expect(await store.schema.migrateToLatest()).toEqual(['0014_timetable_change_requests']);
    expect(await db.selectFrom('timetable_change_requests').selectAll().execute()).toEqual([]);
  });
});
