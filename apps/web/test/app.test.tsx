// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ShieldCheck, Users } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { SHELL_ROUTES, type ShellRoute } from '../src/app/routes';
import {
  admin,
  installFetch,
  renderApp,
  signedInAs,
  unauthorized,
  user,
} from './support/render-app';

/**
 * Hypothetical module pages that exist ONLY in this test, to exercise permission- and role-gated
 * routing before real modules exist (Phase 4+). They are not part of the application.
 */
const TEST_ROUTES: readonly ShellRoute[] = [
  ...SHELL_ROUTES,
  {
    path: 'test-accounts',
    title: 'Accounts',
    element: <p>accounts module content</p>,
    permission: 'users.create',
    nav: { label: 'Accounts', icon: Users, section: 'main' },
  },
  {
    path: 'test-my-class',
    title: 'My class',
    element: <p>my class content</p>,
    roles: ['CLASS_TEACHER'],
    nav: { label: 'My class', icon: ShieldCheck, section: 'main' },
  },
];

const navLinks = () =>
  Array.from(
    screen.getByRole('navigation', { name: 'Main' }).querySelectorAll('a'),
    (a) => a.textContent,
  );

describe('routing and role-aware navigation', () => {
  it('unauthenticated users land on the sign-in page', async () => {
    installFetch(signedInAs(null));
    renderApp('/test-accounts', TEST_ROUTES);
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByText('accounts module content')).not.toBeInTheDocument();
  });

  it('a user without the permission gets "no access", and the link is not offered', async () => {
    installFetch(signedInAs(user()));
    renderApp('/test-accounts', TEST_ROUTES);
    expect(await screen.findByText("You don't have access to this page")).toBeInTheDocument();
    expect(screen.queryByText('accounts module content')).not.toBeInTheDocument();
    expect(navLinks()).toEqual(['Home', 'Change password']);
  });

  it('a user with the permission sees the page and its menu entry', async () => {
    installFetch(signedInAs(admin()));
    renderApp('/test-accounts', TEST_ROUTES);
    expect(await screen.findByText('accounts module content')).toBeInTheDocument();
    expect(navLinks()).toEqual(['Home', 'Accounts', 'School setup', 'Change password']);
  });

  it('role-restricted pages follow the effective role (class teacher)', async () => {
    installFetch(
      signedInAs(
        user({
          roles: ['TEACHER', 'CLASS_TEACHER'],
          classTeacherOf: [{ academicYearId: 'y', sectionId: 's' }],
        }),
      ),
    );
    renderApp('/test-my-class', TEST_ROUTES);
    expect(await screen.findByText('my class content')).toBeInTheDocument();
    expect(navLinks()).toContain('My class');
  });

  it('hiding a link is not the protection: the gate still applies when the URL is typed', async () => {
    installFetch(
      signedInAs(
        user({ roles: ['STUDENT'], accountRole: 'STUDENT', permissions: ['students.view'] }),
      ),
    );
    renderApp('/test-my-class', TEST_ROUTES);
    expect(await screen.findByText("You don't have access to this page")).toBeInTheDocument();
  });

  it('a temporary password always routes to the change-password page', async () => {
    installFetch(signedInAs(user({ mustChangePassword: true })));
    renderApp('/', TEST_ROUTES);
    expect(
      await screen.findByRole('heading', { name: 'Choose your own password' }),
    ).toBeInTheDocument();
  });
});

describe('sign-in page behaviour', () => {
  it('shows field errors and does not call the API for empty input', async () => {
    const { calls } = installFetch(signedInAs(null));
    renderApp('/login');
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(screen.getByText('Enter your username.')).toBeInTheDocument();
    expect(screen.getByText('Enter your password.')).toBeInTheDocument();
    expect(screen.getByLabelText('Username')).toHaveFocus();
    expect(calls).not.toContain('POST /auth/login');
  });

  it('explains a network failure in plain words', async () => {
    installFetch(signedInAs(null, { 'POST /auth/login': () => new TypeError('Failed to fetch') }));
    renderApp('/login');
    await userEvent.type(await screen.findByLabelText('Username'), 'test.user');
    await userEvent.type(screen.getByLabelText('Password'), 'whatever-1');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(
      await screen.findByText('Cannot reach the server. Check your connection.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('warns when the system itself is unavailable', async () => {
    installFetch(
      signedInAs(null, {
        'GET /health': () => ({
          status: 503,
          body: { data: { status: 'degraded', database: 'down', time: 't' } },
        }),
      }),
    );
    renderApp('/login');
    expect(await screen.findByText(/having a problem right now/)).toBeInTheDocument();
  });

  it('server down at start-up shows an error with a working retry', async () => {
    let up = false;
    installFetch(
      signedInAs(admin(), {
        'GET /auth/me': () =>
          up
            ? { status: 200, body: { data: { user: admin() } } }
            : { status: 502, body: '<html>Bad gateway</html>' },
      }),
    );
    renderApp('/');
    expect(await screen.findByText('TTLMHSS could not start')).toBeInTheDocument();
    expect(screen.getByText(/not responding right now/)).toBeInTheDocument();
    up = true;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: /Welcome, Test Admin/ })).toBeInTheDocument();
  });
});

describe('shell', () => {
  it('shows the user and role, and signing out returns to sign-in with a confirmation', async () => {
    let signedIn = true;
    installFetch(
      signedInAs(admin(), {
        'GET /auth/me': () =>
          signedIn ? { status: 200, body: { data: { user: admin() } } } : unauthorized,
        'POST /auth/logout': () => {
          signedIn = false;
          return { status: 200, body: { data: { signedOut: true } } };
        },
      }),
    );
    renderApp('/');
    const menu = await screen.findByRole('button', {
      name: 'Account menu: Test Admin, Administrator',
    });
    await userEvent.click(menu);
    expect(within(screen.getByRole('banner')).getByText('test.admin')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByText('You have signed out.')).toBeInTheDocument();
  });

  it('Escape closes the account menu and returns focus to its button', async () => {
    installFetch(signedInAs(admin()));
    renderApp('/');
    const menu = await screen.findByRole('button', { name: /Account menu/ });
    await userEvent.click(menu);
    expect(menu).toHaveAttribute('aria-expanded', 'true');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(menu).toHaveAttribute('aria-expanded', 'false'));
    expect(menu).toHaveFocus();
  });
});
