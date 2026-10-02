import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import { PERMISSIONS, type AuthUser } from '@ttlmhss/shared';
import { AppRoutes } from '../../src/app/AppRoutes';
import type { ShellRoute } from '../../src/app/routes';
import { BrandingProvider } from '../../src/brand/BrandingProvider';
import { ToastProvider } from '../../src/components/ui';
import { AuthProvider } from '../../src/features/auth/auth-context';

/*
 * Test-only stand-in for the network: routes fetch() calls to handlers. The real API is exercised
 * by the API test suite and by the browser end-to-end tests; these tests focus on UI behaviour.
 */
type Reply = { status: number; body?: unknown } | Error;
export type Handlers = Record<string, (init: RequestInit | undefined) => Reply | Promise<Reply>>;

export function installFetch(handlers: Handlers) {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const key = `${init?.method ?? 'GET'} ${url.replace('/api/v1', '')}`;
    calls.push(key);
    const handler = handlers[key];
    const reply: Reply = handler
      ? await handler(init)
      : { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not found' } } };
    if (reply instanceof Error) throw reply;
    return new Response(
      reply.body === undefined
        ? ''
        : typeof reply.body === 'string'
          ? reply.body
          : JSON.stringify(reply.body),
      {
        status: reply.status,
        headers: { 'content-type': 'application/json' },
      },
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls };
}

export const unauthorized: Reply = {
  status: 401,
  body: { error: { code: 'UNAUTHORIZED', message: 'You need to sign in to continue.' } },
};

export function user(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'u1',
    username: 'test.user',
    displayName: 'Test User',
    accountRole: 'TEACHER',
    roles: ['TEACHER'],
    permissions: ['students.view', 'attendance.mark'],
    teacherId: 't1',
    studentId: null,
    classTeacherOf: [],
    mustChangePassword: false,
    ...overrides,
  };
}

export const admin = () =>
  user({
    username: 'test.admin',
    displayName: 'Test Admin',
    accountRole: 'ADMIN',
    roles: ['ADMIN'],
    permissions: [...PERMISSIONS],
    teacherId: null,
  });

export function signedInAs(u: AuthUser | null, extra: Handlers = {}): Handlers {
  return {
    'GET /auth/me': () => (u ? { status: 200, body: { data: { user: u } } } : unauthorized),
    'GET /school/branding': () => ({
      status: 200,
      body: {
        data: {
          shortName: 'TTLMHSS',
          fullName: 'Thiruthangal Lions Matriculation Higher Secondary School',
          primaryColor: '#003300',
          logoUrl: '/brand/ttlmhss-logo.webp',
        },
      },
    }),
    'GET /health': () => ({
      status: 200,
      body: { data: { status: 'ok', database: 'up', time: 't' } },
    }),
    'POST /auth/logout': () => ({ status: 200, body: { data: { signedOut: true } } }),
    ...extra,
  };
}

export function renderApp(path: string, routes?: readonly ShellRoute[]) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <BrandingProvider>
          <AuthProvider>
            <AppRoutes {...(routes ? { routes } : {})} />
          </AuthProvider>
        </BrandingProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}
