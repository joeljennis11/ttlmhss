/* eslint-disable @typescript-eslint/no-explicit-any -- e2e reads untyped API bodies */
import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';

/*
 * End-to-end: student & teacher management (Phase 5) through the real browser → Vite → real API →
 * the throwaway SQLite database seeded by apps/api/test/e2e/seed.ts (TEST-CURRENT year,
 * TEST-CLASS sections A and B). Every name entered below is synthetic test data.
 */
const PASSWORD = 'E2e-test-pass-1';
const BASE = 'http://localhost:5174';

async function signIn(page: Page, username: string, password = PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

const toast = (page: Page, text: string | RegExp) =>
  page.locator('[aria-live="polite"]').getByText(text).last();
const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

let api: APIRequestContext;

/** Data this spec needs regardless of the order spec files run in, created through the API. */
async function ensure(path: string, find: (rows: any[]) => any, body: object) {
  const list = await (await api.get(`/api/v1${path}`)).json();
  const found = find(list.data);
  if (found) return found;
  const res = await api.post(`/api/v1${path}`, { data: body });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()).data;
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  api = await playwrightRequest.newContext({ baseURL: BASE });
  const login = await api.post('/api/v1/auth/login', {
    data: { username: 'e2e.admin', password: PASSWORD },
  });
  expect(login.ok()).toBe(true);
  // A later academic year to promote into, and a subject to assign.
  const years = (await (await api.get('/api/v1/admin/academic-years')).json()).data as any[];
  const current = years.find((y) => y.status === 'CURRENT');
  if (!years.some((y) => y.startDate > current.startDate && y.status !== 'CLOSED')) {
    await api.post('/api/v1/admin/academic-years', {
      data: { label: 'E2E-NEXT', startDate: '2027-06-01', endDate: '2028-04-30' },
    });
  }
  await ensure(
    '/admin/subjects',
    (rows) => rows.find((s: any) => s.name === 'E2E People Subject'),
    {
      name: 'E2E People Subject',
      code: null,
      displayOrder: 50,
    },
  );
});

test.afterAll(async () => {
  await api.dispose();
});

test('teachers and students cannot open student or teacher management', async ({ page }) => {
  for (const username of ['e2e.teacher', 'e2e.student']) {
    await page.context().clearCookies();
    await signIn(page, username);
    await expect(page.getByRole('link', { name: 'Students', exact: true })).toHaveCount(0);
    await page.goto('/teachers');
    await expect(page.getByText("You don't have access to this page")).toBeVisible();
    expect((await page.request.get('/api/v1/admin/teachers')).status()).toBe(403);
    expect((await page.request.post('/api/v1/admin/students', { data: {} })).status()).toBe(403);
  }
});

test.describe('administrator', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'e2e.admin');
  });

  let tempPassword = '';

  test('admits a student, issues the first password, finds and edits them', async ({ page }) => {
    await page.getByRole('link', { name: 'Students', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Students' })).toBeVisible();
    await page.getByRole('link', { name: 'Admit student' }).click();

    await page.getByRole('button', { name: 'Admit student' }).click();
    await expect(page.getByText('Admission number is required')).toBeVisible();

    await page.getByLabel(/Admission number/).fill('E2E/001');
    await page.getByLabel(/Admission date/).fill('2026-06-02');
    await page.getByLabel(/Class and section/).selectOption({ label: 'TEST-CLASS B' });
    await page.getByLabel(/Roll number/).fill('41');
    await page.getByLabel(/Full name/).fill('E2E Admitted Student');
    await page.getByLabel('Father’s name').fill('E2E Father');
    await page.getByRole('button', { name: 'Admit student' }).click();

    await expect(
      page.getByRole('heading', { level: 1, name: 'E2E Admitted Student' }),
    ).toBeVisible();
    await expect(page.getByText('The sign-in account e2e-001 was created')).toBeVisible();
    await expect(page.getByText('First sign-in pending')).toBeVisible();

    await page.getByRole('button', { name: 'Issue temporary password' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Issue password' }).click();
    tempPassword = (await page.getByTestId('temporary-password').textContent()) ?? '';
    expect(tempPassword.length).toBeGreaterThan(8);
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByTestId('temporary-password')).toHaveCount(0);

    await page.goto('/students');
    await page.getByLabel('Search').fill('E2E/001');
    await expect(
      page.getByRole('link', { name: 'E2E Admitted Student', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('cell', { name: 'TEST-CLASS B' })).toBeVisible();

    await page.getByRole('link', { name: 'Edit E2E Admitted Student' }).click();
    await page.getByLabel('Phone', { exact: true }).fill('+91 90000 11111');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(toast(page, 'Student details saved')).toBeVisible();
    await expect(page.getByText('+91 90000 11111')).toBeVisible();
  });

  test('deactivation blocks sign-in; reactivation restores it', async ({ page, browser }) => {
    await page.goto('/students?q=E2E%2F001&status=ALL');
    await page.getByRole('link', { name: 'E2E Admitted Student', exact: true }).click();
    await page.getByRole('button', { name: 'Deactivate' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Deactivate' }).click();
    await expect(toast(page, 'Student deactivated')).toBeVisible();
    await expect(page.getByText('Sign-in disabled')).toBeVisible();

    const other = await browser.newContext();
    const res = await other.request.post(`${BASE}/api/v1/auth/login`, {
      data: { username: 'e2e-001', password: tempPassword },
    });
    expect(res.status()).toBe(401);

    await page.getByRole('button', { name: 'Reactivate' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Reactivate' }).click();
    await expect(toast(page, 'Student reactivated')).toBeVisible();
    const again = await other.request.post(`${BASE}/api/v1/auth/login`, {
      data: { username: 'e2e-001', password: tempPassword },
    });
    expect(again.status()).toBe(200);
    expect((await again.json()).data.user.mustChangePassword).toBe(true);
    await other.close();
  });

  test('changes class with history kept, then promotes into the next year', async ({ page }) => {
    await page.goto('/students?q=E2E%2F001');
    await page.getByRole('link', { name: 'E2E Admitted Student', exact: true }).click();
    await page.getByRole('button', { name: 'Change class' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/New class and section/).selectOption({ label: 'TEST-CLASS A' });
    await dialog.getByLabel(/From date/).fill('2026-08-01');
    await dialog.getByLabel('New roll number').fill('42');
    await dialog.getByRole('button', { name: 'Change class' }).click();
    await expect(toast(page, 'Class changed')).toBeVisible();
    const history = page.getByRole('table', { name: 'Academic history' });
    await expect(history.getByRole('row')).toHaveCount(3);
    await expect(history.getByText('Moved to another class')).toBeVisible();

    await page.goto('/students');
    await page.getByRole('link', { name: 'Promote students' }).click();
    await page.getByLabel('Class and section').selectOption({ label: 'TEST-CLASS A' });
    await expect(page.getByText('E2E Admitted Student')).toBeVisible();
    // Only our student: leave the seeded one out.
    await page.getByLabel('Include Test Student').uncheck();
    await page
      .getByLabel('Next class for E2E Admitted Student')
      .selectOption({ label: 'TEST-CLASS A' });
    await page.getByRole('button', { name: 'Review 1 student' }).click();
    const confirm = page.getByRole('dialog', { name: 'Confirm promotion' });
    await expect(confirm.getByText('Promoted: 1')).toBeVisible();
    await confirm.getByRole('button', { name: 'Promote now' }).click();
    await expect(page.getByRole('heading', { name: 'Done' })).toBeVisible();

    await page.goto('/students?q=E2E%2F001&status=ALL');
    await page.getByRole('link', { name: 'E2E Admitted Student', exact: true }).click();
    await expect(history.getByText('Promoted')).toBeVisible();
    await expect(history.getByRole('row')).toHaveCount(4);
  });

  test('adds a teacher, assigns a subject and a class-teacher role', async ({ page }) => {
    await page.getByRole('link', { name: 'Teachers', exact: true }).click();
    await page.getByRole('link', { name: 'Add teacher' }).click();
    await page.getByLabel(/Staff ID/).fill('E2E-T1');
    await page.getByLabel(/Full name/).fill('E2E Teacher One');
    await page.getByLabel('Designation').fill('E2E Designation');
    await page.getByRole('button', { name: 'Add teacher' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'E2E Teacher One' })).toBeVisible();

    await page.getByLabel('Add a subject').selectOption({ label: 'E2E People Subject' });
    await page.getByRole('button', { name: 'Assign', exact: true }).click();
    await expect(
      page.getByRole('list', { name: 'Assigned subjects' }).getByText('E2E People Subject'),
    ).toBeVisible();

    await page.goto('/class-teachers');
    const row = page.getByRole('row', { name: /TEST-CLASS B/ });
    await row.getByRole('button', { name: /Assign class teacher for TEST-CLASS B/ }).click();
    const dialog = page.getByRole('dialog');
    await dialog
      .getByRole('combobox', { name: 'Teacher' })
      .selectOption({ label: 'E2E Teacher One (E2E-T1)' });
    await dialog.getByRole('button', { name: 'Assign' }).click();
    await expect(row.getByRole('link', { name: 'E2E Teacher One' })).toBeVisible();

    // Section A already has the seeded class teacher: replacing needs a deliberate choice.
    const rowA = page.getByRole('row', { name: /TEST-CLASS A/ });
    await rowA.getByRole('button', { name: /Replace class teacher for TEST-CLASS A/ }).click();
    const replace = page.getByRole('dialog');
    await replace
      .getByRole('combobox', { name: 'Teacher' })
      .selectOption({ label: 'E2E Teacher One (E2E-T1)' });
    await expect(replace.getByLabel(/Replace Test Class Teacher as class teacher/)).toBeVisible();
    await replace.getByRole('button', { name: 'Cancel' }).click();

    await page.goto('/teachers?q=E2E-T1');
    await expect(page.getByRole('cell', { name: 'E2E People Subject' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'TEST-CLASS B' })).toBeVisible();
  });

  test('management pages fit a phone screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const path of [
      '/students',
      '/students/new',
      '/students/promotion',
      '/teachers',
      '/teachers/new',
      '/class-teachers',
    ]) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(await overflow(page), path).toBeLessThanOrEqual(0);
    }
    await page.goto('/students?q=E2E%2F001&status=ALL');
    await page.getByRole('link', { name: 'E2E Admitted Student', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });
});
