import { ErrorCode } from '@ttlmhss/shared';
import { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { requires } from '../src/core/auth/access.js';
import { createAccountCredentialsService } from '../src/composition.js';
import type { FeatureModule } from '../src/core/http/module.js';
import { defineRoute } from '../src/core/http/routes.js';
import { INVALID_CREDENTIALS_MESSAGE } from '../src/modules/auth/auth.service.js';
import { Argon2PasswordHasher } from '../src/modules/auth/password-hasher.js';
import { generateTemporaryPassword, hashSessionToken } from '../src/modules/auth/secrets.js';
import { PASSWORD, seedAccount } from './support/auth-fixtures.js';
import {
  MutableClock,
  TEST_SESSION_SECRET,
  buildTestApp,
  sessionCookieFrom,
  signIn,
  type TestApp,
  type TestAppOptions,
} from './support/test-harness.js';

/** A protected test-only route (requires a permission every ADMIN has). */
const protectedProbe = (): FeatureModule[] => [
  {
    name: 'probe',
    routes: [
      defineRoute({
        method: 'GET',
        url: '/__test/protected',
        access: requires('users.view'),
        handler: ({ principal }) => ({ userId: principal?.userId }),
      }),
    ],
  },
];

describe('authentication', () => {
  let harness: TestApp | undefined;
  afterEach(async () => {
    await harness?.close();
    harness = undefined;
  });

  async function setup(clock?: MutableClock, options: TestAppOptions = {}) {
    harness = await buildTestApp(clock ? { clock } : {}, { modules: protectedProbe, ...options });
    return harness;
  }

  const me = (h: TestApp, cookie?: string | null) =>
    h.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: cookie ? { cookie } : {} });

  describe('password hashing', () => {
    const hasher = new Argon2PasswordHasher();

    it('uses Argon2id with the configured cost and a unique salt per hash', async () => {
      const a = await hasher.hash('Correct-horse-42');
      const b = await hasher.hash('Correct-horse-42');
      expect(a).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
      expect(a).not.toBe(b);
      expect(a).not.toContain('Correct-horse-42');
    });

    it('verifies the right password only, and never throws on a malformed hash', async () => {
      const hash = await hasher.hash('Correct-horse-42');
      expect(await hasher.verify(hash, 'Correct-horse-42')).toBe(true);
      expect(await hasher.verify(hash, 'correct-horse-42')).toBe(false);
      expect(await hasher.verify('not-a-hash', 'anything')).toBe(false);
    });

    it('temporary passwords are random and satisfy the policy', () => {
      const values = new Set(Array.from({ length: 50 }, () => generateTemporaryPassword()));
      expect(values.size).toBe(50);
      for (const value of values)
        expect(value).toMatch(/^(?=.*[A-Za-z])(?=.*[2-9])[A-Za-z2-9]{12}$/);
    });
  });

  describe('login', () => {
    it('signs in with valid credentials and sets a secure session cookie', async () => {
      const h = await setup();
      await seedAccount(h.deps, { username: 'test.admin', role: 'ADMIN' });

      const { response } = await signIn(h.app, '  Test.Admin ', PASSWORD);
      expect(response.statusCode).toBe(200);
      const user = response.json().data.user;
      expect(user).toMatchObject({
        username: 'test.admin',
        accountRole: 'ADMIN',
        roles: ['ADMIN'],
        mustChangePassword: false,
        teacherId: null,
        studentId: null,
      });
      expect(user.permissions).toContain('users.view');

      const cookie = response.cookies[0]!;
      expect(cookie).toMatchObject({
        name: 'ttlmhss_session',
        httpOnly: true,
        sameSite: 'Lax',
        path: '/',
      });
      expect(cookie.value).toMatch(/^[A-Za-z0-9_-]{43}$/);

      const lastLogin = await h.db
        .selectFrom('user_credentials')
        .select('last_login_at')
        .executeTakeFirstOrThrow();
      expect(lastLogin.last_login_at).toBe('2026-06-01T09:00:00.000Z');
    });

    it('stores only an HMAC of the session token, never the token itself', async () => {
      const h = await setup();
      await seedAccount(h.deps, { username: 'test.admin', role: 'ADMIN' });
      const { cookie } = await signIn(h.app, 'test.admin', PASSWORD);
      const token = cookie!.split('=')[1]!;
      const row = await h.db.selectFrom('sessions').select('token_hash').executeTakeFirstOrThrow();
      expect(row.token_hash).not.toBe(token);
      expect(row.token_hash).toBe(hashSessionToken(token, TEST_SESSION_SECRET));
    });

    it('gives the same generic answer for unknown user, wrong password, inactive account and no password', async () => {
      const h = await setup();
      await seedAccount(h.deps, { username: 'test.active', role: 'TEACHER' });
      await seedAccount(h.deps, { username: 'test.inactive', role: 'TEACHER', status: 'INACTIVE' });
      await seedAccount(h.deps, { username: 'test.nopass', role: 'TEACHER', password: null });

      const attempts = [
        ['test.nobody', PASSWORD],
        ['test.active', 'Wrong-password-1'],
        ['test.inactive', PASSWORD],
        ['test.nopass', PASSWORD],
      ] as const;
      for (const [username, password] of attempts) {
        const { response } = await signIn(h.app, username, password);
        expect(response.statusCode).toBe(401);
        const { requestId: _ignored, ...error } = response.json().error;
        expect(error).toEqual({
          code: ErrorCode.UNAUTHORIZED,
          message: INVALID_CREDENTIALS_MESSAGE,
        });
        expect(response.headers['set-cookie']).toBeUndefined();
      }
    });

    it('rejects malformed sign-in requests before touching credentials', async () => {
      const h = await setup();
      const bad = [
        { username: 'test.admin' },
        { username: '', password: 'x' },
        { username: 'has space', password: 'x' },
        { username: 'test.admin', password: 'x'.repeat(129) },
        { username: 42, password: 'x' },
      ];
      for (const payload of bad) {
        const res = await h.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload });
        expect(res.statusCode).toBe(400);
        expect(res.json().error.code).toBe(ErrorCode.VALIDATION_ERROR);
      }
      const textBody = await h.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { 'content-type': 'text/plain' },
        payload: 'username=a&password=b',
      });
      expect(textBody.statusCode).toBe(415);
    });

    it('records audit events without any password or token', async () => {
      const h = await setup();
      await seedAccount(h.deps, { username: 'test.admin', role: 'ADMIN' });
      await signIn(h.app, 'test.admin', 'Wrong-password-1');
      const { cookie } = await signIn(h.app, 'test.admin', PASSWORD);
      await h.app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        headers: { cookie: cookie! },
      });

      const rows = await h.db.selectFrom('audit_logs').selectAll().orderBy('action').execute();
      expect(rows.map((r) => r.action)).toEqual([
        'auth.login.failed',
        'auth.login.succeeded',
        'auth.logout',
      ]);
      const everything = JSON.stringify(rows);
      expect(everything).not.toContain(PASSWORD);
      expect(everything).not.toContain('Wrong-password-1');
      expect(everything).not.toContain(cookie!.split('=')[1]);
      expect(rows.find((r) => r.action === 'auth.login.failed')?.after_json).toContain(
        'wrong_password',
      );
    });
  });

  describe('session', () => {
    it('GET /auth/me returns the signed-in user and never a hash or token', async () => {
      const h = await setup();
      await seedAccount(h.deps, { username: 'test.admin', role: 'ADMIN' });
      const { cookie } = await signIn(h.app, 'test.admin', PASSWORD);
      const res = await me(h, cookie);
      expect(res.statusCode).toBe(200);
      expect(res.json().data.user.username).toBe('test.admin');
      expect(res.body).not.toMatch(/argon2|password_hash|passwordHash|token/i);
    });

    it('protected routes refuse missing, malformed and forged cookies', async () => {
      const h = await setup();
      expect((await me(h)).statusCode).toBe(401);
      expect((await me(h, 'ttlmhss_session=garbage')).statusCode).toBe(401);
      expect((await me(h, `ttlmhss_session=${'A'.repeat(43)}`)).statusCode).toBe(401);
      const res = await h.app.inject({ method: 'GET', url: '/api/v1/__test/protected' });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe(ErrorCode.UNAUTHORIZED);
    });

    it('logout invalidates the session server-side and clears the cookie', async () => {
      const h = await setup();
      await seedAccount(h.deps, { username: 'test.admin', role: 'ADMIN' });
      const { cookie } = await signIn(h.app, 'test.admin', PASSWORD);
      expect((await me(h, cookie)).statusCode).toBe(200);

      const out = await h.app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        headers: { cookie: cookie! },
      });
      expect(out.statusCode).toBe(200);
      const cleared = out.cookies.find((c) => c.name === 'ttlmhss_session');
      expect(cleared?.value).toBe('');
      expect(cleared?.expires?.getTime()).toBeLessThanOrEqual(Date.now());

      // Re-using the old cookie value does not work: the session is revoked in the database.
      expect((await me(h, cookie)).statusCode).toBe(401);
      const row = await h.db
        .selectFrom('sessions')
        .select(['revoked_at', 'revoked_reason'])
        .executeTakeFirstOrThrow();
      expect(row).toEqual({ revoked_at: '2026-06-01T09:00:00.000Z', revoked_reason: 'logout' });
    });

    it('logout without a session is harmless', async () => {
      const h = await setup();
      const res = await h.app.inject({ method: 'POST', url: '/api/v1/auth/logout' });
      expect(res.statusCode).toBe(200);
    });

    it('expires after the idle timeout, and after the absolute lifetime even when active', async () => {
      const clock = new MutableClock();
      const h = await setup(clock, {
        env: { SESSION_IDLE_TIMEOUT_MINUTES: '30', SESSION_ABSOLUTE_TIMEOUT_HOURS: '2' },
      });
      await seedAccount(h.deps, { username: 'test.admin', role: 'ADMIN' });

      const idle = await signIn(h.app, 'test.admin', PASSWORD);
      clock.advance(29 * 60_000);
      expect((await me(h, idle.cookie)).statusCode).toBe(200); // activity slides the idle window
      clock.advance(29 * 60_000);
      expect((await me(h, idle.cookie)).statusCode).toBe(200);
      clock.advance(31 * 60_000);
      expect((await me(h, idle.cookie)).statusCode).toBe(401);

      const active = await signIn(h.app, 'test.admin', PASSWORD);
      for (let i = 0; i < 4; i++) {
        clock.advance(25 * 60_000);
        expect((await me(h, active.cookie)).statusCode).toBe(200);
      }
      clock.advance(25 * 60_000); // 125 minutes > 2 hours absolute
      expect((await me(h, active.cookie)).statusCode).toBe(401);
    });

    it('an account deactivated during a session is locked out on its next request', async () => {
      const h = await setup();
      const userId = await seedAccount(h.deps, { username: 'test.teacher', role: 'TEACHER' });
      const { cookie } = await signIn(h.app, 'test.teacher', PASSWORD);
      expect((await me(h, cookie)).statusCode).toBe(200);

      // Even a direct status change (no session revocation) is enough.
      await h.db
        .updateTable('users')
        .set({ status: 'INACTIVE' })
        .where('id', '=', userId)
        .execute();
      expect((await me(h, cookie)).statusCode).toBe(401);
      expect((await signIn(h.app, 'test.teacher', PASSWORD)).response.statusCode).toBe(401);
    });

    it('account deactivation through the service revokes sessions and is audited', async () => {
      const h = await setup();
      const userId = await seedAccount(h.deps, { username: 'test.teacher', role: 'TEACHER' });
      const { cookie } = await signIn(h.app, 'test.teacher', PASSWORD);
      await createAccountCredentialsService(h.deps).setStatus(userId, 'INACTIVE', 'system');
      expect((await me(h, cookie)).statusCode).toBe(401);
      const sessions = await h.db.selectFrom('sessions').select('revoked_reason').execute();
      expect(sessions).toEqual([{ revoked_reason: 'account_deactivated' }]);
      const audit = await h.db
        .selectFrom('audit_logs')
        .select('action')
        .where('action', 'like', 'account.%')
        .execute();
      expect(audit).toEqual([{ action: 'account.deactivated' }]);
    });

    it('uses a Secure, __Host- prefixed cookie when COOKIE_SECURE is on', async () => {
      const h = await setup(undefined, { env: { COOKIE_SECURE: 'true' } });
      await seedAccount(h.deps, { username: 'test.admin', role: 'ADMIN' });
      const { response } = await signIn(h.app, 'test.admin', PASSWORD);
      expect(response.cookies[0]).toMatchObject({
        name: '__Host-ttlmhss_session',
        secure: true,
        httpOnly: true,
      });
      expect((await me(h, sessionCookieFrom(response))).statusCode).toBe(200);
    });
  });

  describe('temporary password / first sign-in', () => {
    async function temporaryUser() {
      const h = await setup();
      const created = await createAccountCredentialsService(h.deps).createAccount(
        { username: 'test.newadmin', role: 'ADMIN' },
        'system',
      );
      return { h, ...created };
    }

    it('signs in but blocks everything except me/logout/change-password', async () => {
      const { h, temporaryPassword } = await temporaryUser();
      const { response, cookie } = await signIn(h.app, 'test.newadmin', temporaryPassword);
      expect(response.statusCode).toBe(200);
      expect(response.json().data.user.mustChangePassword).toBe(true);

      expect((await me(h, cookie)).statusCode).toBe(200);
      const blocked = await h.app.inject({
        method: 'GET',
        url: '/api/v1/__test/protected',
        headers: { cookie: cookie! },
      });
      expect(blocked.statusCode).toBe(403);
      expect(blocked.json().error.code).toBe(ErrorCode.PASSWORD_CHANGE_REQUIRED);
    });

    it('change-password validates input, current password and policy', async () => {
      const { h, temporaryPassword } = await temporaryUser();
      const { cookie } = await signIn(h.app, 'test.newadmin', temporaryPassword);
      const change = (payload: object) =>
        h.app.inject({
          method: 'POST',
          url: '/api/v1/auth/change-password',
          headers: { cookie: cookie! },
          payload,
        });

      const mismatch = await change({
        currentPassword: temporaryPassword,
        newPassword: 'River-stone-42',
        confirmPassword: 'River-stone-43',
      });
      expect(mismatch.statusCode).toBe(400);
      expect(mismatch.json().error.details).toContainEqual({
        path: 'body.confirmPassword',
        message: 'Passwords do not match',
      });

      const weak = await change({
        currentPassword: temporaryPassword,
        newPassword: 'short1',
        confirmPassword: 'short1',
      });
      expect(weak.statusCode).toBe(400);

      const withUsername = await change({
        currentPassword: temporaryPassword,
        newPassword: 'test.newadmin9',
        confirmPassword: 'test.newadmin9',
      });
      expect(withUsername.statusCode).toBe(400);
      expect(JSON.stringify(withUsername.json().error.details)).toContain('username');

      const wrongCurrent = await change({
        currentPassword: 'Not-the-temp-1',
        newPassword: 'River-stone-42',
        confirmPassword: 'River-stone-42',
      });
      expect(wrongCurrent.statusCode).toBe(400);
      expect(wrongCurrent.json().error.details).toEqual([
        { path: 'body.currentPassword', message: 'Current password is incorrect.' },
      ]);
    });

    it('after changing, access is normal, old sessions and the temporary password stop working', async () => {
      const { h, temporaryPassword } = await temporaryUser();
      const first = await signIn(h.app, 'test.newadmin', temporaryPassword);
      const second = await signIn(h.app, 'test.newadmin', temporaryPassword);

      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/auth/change-password',
        headers: { cookie: first.cookie! },
        payload: {
          currentPassword: temporaryPassword,
          newPassword: 'River-stone-42',
          confirmPassword: 'River-stone-42',
        },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.user.mustChangePassword).toBe(false);
      expect(res.body).not.toContain('River-stone-42');
      const fresh = sessionCookieFrom(res);
      expect(fresh).not.toBe(first.cookie);

      // Session rotated: old cookies (including this client's previous one) are dead.
      expect((await me(h, first.cookie)).statusCode).toBe(401);
      expect((await me(h, second.cookie)).statusCode).toBe(401);
      const ok = await h.app.inject({
        method: 'GET',
        url: '/api/v1/__test/protected',
        headers: { cookie: fresh },
      });
      expect(ok.statusCode).toBe(200);

      expect((await signIn(h.app, 'test.newadmin', temporaryPassword)).response.statusCode).toBe(
        401,
      );
      expect((await signIn(h.app, 'test.newadmin', 'River-stone-42')).response.statusCode).toBe(
        200,
      );

      const stored = await h.db
        .selectFrom('user_credentials')
        .select(['password_status', 'password_hash'])
        .executeTakeFirstOrThrow();
      expect(stored.password_status).toBe('SET');
      expect(stored.password_hash).toMatch(/^\$argon2id\$/);
    });

    it('a password reset issues a new temporary password and ends existing sessions', async () => {
      const h = await setup();
      const userId = await seedAccount(h.deps, { username: 'test.teacher', role: 'TEACHER' });
      const { cookie } = await signIn(h.app, 'test.teacher', PASSWORD);
      const issued = await createAccountCredentialsService(h.deps).issueTemporaryPassword(
        userId,
        'system',
      );
      expect((await me(h, cookie)).statusCode).toBe(401);
      const again = await signIn(h.app, 'test.teacher', issued.temporaryPassword);
      expect(again.response.json().data.user.mustChangePassword).toBe(true);
    });
  });

  describe('abuse protection', () => {
    it('locks a username after repeated failures — including unknown usernames — then recovers', async () => {
      const clock = new MutableClock();
      const h = await setup(clock, {
        env: {
          LOGIN_RATE_LIMIT_PER_MINUTE: '1000',
          LOGIN_MAX_FAILED_ATTEMPTS: '3',
          LOGIN_LOCKOUT_MINUTES: '10',
        },
      });
      await seedAccount(h.deps, { username: 'test.admin', role: 'ADMIN' });

      for (const username of ['test.admin', 'test.ghost']) {
        for (let i = 0; i < 3; i++) {
          expect((await signIn(h.app, username, 'Wrong-password-1')).response.statusCode).toBe(401);
        }
        const locked = await signIn(h.app, username, PASSWORD);
        expect(locked.response.statusCode).toBe(429);
        expect(locked.response.json().error.code).toBe(ErrorCode.TOO_MANY_REQUESTS);
      }
      clock.advance(10 * 60_000 + 1);
      expect((await signIn(h.app, 'test.admin', PASSWORD)).response.statusCode).toBe(200);
    });

    it('rate-limits sign-in requests per client IP with the standard error envelope', async () => {
      const h = await setup(undefined, { env: { LOGIN_RATE_LIMIT_PER_MINUTE: '3' } });
      const statuses: number[] = [];
      for (let i = 0; i < 4; i++)
        statuses.push(
          (await signIn(h.app, `test.user${i}`, 'Wrong-password-1')).response.statusCode,
        );
      expect(statuses).toEqual([401, 401, 401, 429]);
      const limited = await signIn(h.app, 'test.user9', 'x');
      expect(limited.response.json().error).toMatchObject({ code: ErrorCode.TOO_MANY_REQUESTS });
    });

    it('blocks cross-site state-changing requests (CSRF defence)', async () => {
      const h = await setup();
      await seedAccount(h.deps, { username: 'test.admin', role: 'ADMIN' });
      const { cookie } = await signIn(h.app, 'test.admin', PASSWORD);

      const forged = await h.app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        headers: { cookie: cookie!, origin: 'https://evil.example' },
      });
      expect(forged.statusCode).toBe(403);
      const crossSite = await h.app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        headers: { cookie: cookie!, 'sec-fetch-site': 'cross-site' },
      });
      expect(crossSite.statusCode).toBe(403);
      expect((await me(h, cookie)).statusCode).toBe(200); // still signed in

      const sameOrigin = await h.app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        headers: { cookie: cookie!, origin: 'http://localhost:80' },
      });
      expect(sameOrigin.statusCode).toBe(200);
    });

    it('never writes passwords or session tokens to the log', async () => {
      const lines: string[] = [];
      const stream = new Writable({
        write(chunk, _enc, done) {
          lines.push(String(chunk));
          done();
        },
      });
      harness = await buildTestApp({}, { logger: { level: 'trace', stream } });
      const h = harness;
      await seedAccount(h.deps, { username: 'test.admin', role: 'ADMIN' });
      await signIn(h.app, 'test.admin', 'Wrong-password-1');
      const { cookie } = await signIn(h.app, 'test.admin', PASSWORD);
      await me(h, cookie);
      await h.app.inject({
        method: 'POST',
        url: '/api/v1/auth/change-password',
        headers: { cookie: cookie! },
        payload: {
          currentPassword: PASSWORD,
          newPassword: 'River-stone-42',
          confirmPassword: 'River-stone-42',
        },
      });

      const log = lines.join('');
      expect(log.length).toBeGreaterThan(0);
      for (const secret of [
        PASSWORD,
        'Wrong-password-1',
        'River-stone-42',
        cookie!.split('=')[1]!,
        TEST_SESSION_SECRET,
      ]) {
        expect(log).not.toContain(secret);
      }
    });
  });
});
