// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ROLE_PERMISSIONS_FOR_TESTS } from './support/admin-fixtures';
import { describe, expect, it } from 'vitest';
import { admin, installFetch, renderApp, signedInAs, user } from './support/render-app';

/*
 * Admin configuration UI (Phase 4). The network is stubbed: these tests check what the pages show
 * and send. The API itself (validation, authorization, audit) is covered by the API test suite and
 * the browser end-to-end tests.
 */

const SETTINGS = {
  fullName: 'Thiruthangal Lions Matriculation Higher Secondary School',
  shortName: 'TTLMHSS',
  motto: null,
  address: null,
  phone: null,
  email: null,
  website: null,
  principalName: null,
  logoUrl: '/brand/ttlmhss-logo.webp',
  primaryColor: '#003300',
  updatedAt: '2026-06-01T09:00:00.000Z',
  currentAcademicYear: null,
};

const ok = (data: unknown) => ({ status: 200, body: { data } });

describe('admin navigation and access', () => {
  it('teachers see no School setup entry and get "no access" on admin pages', async () => {
    installFetch(signedInAs(user()));
    renderApp('/admin/school');
    expect(await screen.findByText("You don't have access to this page")).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).queryByRole('link', { name: 'School setup' })).not.toBeInTheDocument();
  });

  it('administrators get the School setup area with a link to every setup page', async () => {
    installFetch(signedInAs(admin()));
    renderApp('/admin');
    expect(
      await screen.findByRole('heading', { name: 'School setup', level: 1 }),
    ).toBeInTheDocument();
    const main = screen.getByRole('main');
    for (const name of [
      'School details',
      'Academic years',
      'Classes & sections',
      'Subjects',
      'Periods & breaks',
      'Attendance locking',
      'Grade scales',
      'Exams',
      'Behaviour',
      'Achievement categories',
      'Role permissions',
    ]) {
      expect(within(main).getByRole('link', { name: new RegExp(`^${name}`) })).toBeInTheDocument();
    }
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'School setup' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});

describe('school details', () => {
  it('checks fields before sending and shows the problem next to the field', async () => {
    const { calls } = installFetch(
      signedInAs(admin(), { 'GET /admin/school-settings': () => ok(SETTINGS) }),
    );
    renderApp('/admin/school');
    const email = await screen.findByLabelText('Email');
    await userEvent.type(email, 'not-an-email');
    await userEvent.click(screen.getByRole('button', { name: 'Save school details' }));
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(calls).not.toContain('PUT /admin/school-settings');
  });

  it('saves, confirms with a toast and reloads the school identity everywhere', async () => {
    let sent: Record<string, unknown> | null = null;
    const { calls } = installFetch(
      signedInAs(admin(), {
        'GET /admin/school-settings': () => ok(SETTINGS),
        'PUT /admin/school-settings': (init) => {
          sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return ok({ ...SETTINGS, ...sent });
        },
      }),
    );
    renderApp('/admin/school');
    const motto = await screen.findByLabelText('Motto');
    await userEvent.type(motto, 'Test motto');
    await userEvent.click(screen.getByRole('button', { name: 'Save school details' }));
    expect(await screen.findByText('School details saved')).toBeInTheDocument();
    expect(sent).toMatchObject({ motto: 'Test motto', address: null, phone: null });
    await waitFor(() =>
      expect(calls.filter((c) => c === 'GET /school/branding').length).toBeGreaterThan(1),
    );
  });
});

describe('academic years', () => {
  it('shows a conflict from the server next to the field it concerns', async () => {
    installFetch(
      signedInAs(admin(), {
        'GET /admin/academic-years': () => ok([]),
        'POST /admin/academic-years': () => ({
          status: 409,
          body: {
            error: {
              code: 'CONFLICT',
              message: 'These dates overlap 2025-26.',
              details: [{ path: 'body.startDate', message: 'These dates overlap 2025-26.' }],
            },
          },
        }),
      }),
    );
    renderApp('/admin/academic-years');
    expect(await screen.findByText('No academic years yet')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add academic year' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add academic year' });
    await userEvent.type(within(dialog).getByLabelText('Name'), '2026-27');
    await userEvent.type(within(dialog).getByLabelText('First day'), '2026-06-01');
    await userEvent.type(within(dialog).getByLabelText('Last day'), '2027-04-30');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add year' }));
    expect(await within(dialog).findByText('These dates overlap 2025-26.')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('First day')).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('role permissions', () => {
  it('locks administrator-only permissions and sends only the chosen list after confirming', async () => {
    let sent: unknown = null;
    const view = ROLE_PERMISSIONS_FOR_TESTS;
    installFetch(
      signedInAs(admin(), {
        'GET /admin/permissions': () => ok(view),
        'PUT /admin/permissions/TEACHER': (init) => {
          sent = JSON.parse(String(init?.body));
          return ok(view);
        },
      }),
    );
    renderApp('/admin/permissions');
    const configManage = await screen.findByRole('checkbox', {
      name: 'Change school configuration',
    });
    expect(configManage).toBeDisabled();
    expect(configManage).not.toBeChecked();
    expect(screen.getAllByText('Administrators only').length).toBeGreaterThan(3);

    const marksEnter = screen.getByRole('checkbox', { name: 'Enter marks' });
    expect(marksEnter).toBeChecked();
    await userEvent.click(marksEnter);
    expect(screen.getByText('Removed (on by default)')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Save Teacher permissions' }));
    const confirm = await screen.findByRole('dialog', { name: 'Change Teacher permissions?' });
    expect(within(confirm).getByText(/Enter marks/)).toBeInTheDocument();
    await userEvent.click(within(confirm).getByRole('button', { name: 'Save permissions' }));
    await waitFor(() => expect(sent).not.toBeNull());
    const list = (sent as { permissions: string[] }).permissions;
    expect(list).not.toContain('marks.enter');
    expect(list).not.toContain('config.manage');
  });

  it('class teachers show permissions they already hold as teachers as included', async () => {
    installFetch(
      signedInAs(admin(), { 'GET /admin/permissions': () => ok(ROLE_PERMISSIONS_FOR_TESTS) }),
    );
    renderApp('/admin/permissions');
    await userEvent.click(await screen.findByRole('tab', { name: 'Class Teacher' }));
    const marksEnter = screen.getByRole('checkbox', { name: 'Enter marks' });
    expect(marksEnter).toBeChecked();
    expect(marksEnter).toBeDisabled();
    expect(screen.getAllByText('Included as a teacher').length).toBeGreaterThan(0);
  });
});

describe('grade scales', () => {
  it('previews the ranges that the grades will cover', async () => {
    installFetch(signedInAs(admin(), { 'GET /admin/grade-scales': () => ok([]) }));
    renderApp('/admin/grade-scales');
    await userEvent.click(await screen.findByRole('button', { name: 'Add grade scale' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add grade scale' });
    await userEvent.type(within(dialog).getByLabelText('Grade 1'), 'A');
    await userEvent.type(within(dialog).getAllByLabelText('From %')[0]!, '60');
    await userEvent.type(within(dialog).getByLabelText('Grade 2'), 'B');
    expect(within(dialog).getByText('A: 60%–100% · B: 0%–<60%')).toBeInTheDocument();
  });
});
