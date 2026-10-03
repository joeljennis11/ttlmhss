/* eslint-disable @typescript-eslint/no-explicit-any -- test helpers read untyped JSON bodies */
import type { FastifyInstance } from 'fastify';
import { PASSWORD, seedAccount } from './auth-fixtures.js';
import { signIn, type TestApp } from './test-harness.js';

/** TEST-ONLY helpers for calling the API as a signed-in user. */
export interface Session {
  app: FastifyInstance;
  cookie: string;
}

export async function call(s: Session, method: string, url: string, payload?: unknown) {
  const res = await s.app.inject({
    method: method as 'GET',
    url: `/api/v1${url}`,
    headers: { cookie: s.cookie },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
  const body = res.body ? (JSON.parse(res.body) as { data?: any; error?: any }) : {};
  return {
    status: res.statusCode,
    data: body.data,
    error: body.error,
    raw: res.body,
    headers: res.headers,
  };
}

export async function sessionFor(
  h: TestApp,
  username: string,
  password = PASSWORD,
): Promise<Session> {
  const { cookie, response } = await signIn(h.app, username, password);
  if (!cookie)
    throw new Error(`sign-in failed for ${username}: ${response.statusCode} ${response.body}`);
  return { app: h.app, cookie };
}

export async function adminSession(h: TestApp, username = 'test.admin'): Promise<Session> {
  await seedAccount(h.deps, { username, role: 'ADMIN' });
  return sessionFor(h, username);
}
