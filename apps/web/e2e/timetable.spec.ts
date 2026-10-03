/* eslint-disable @typescript-eslint/no-explicit-any -- e2e reads untyped API bodies */
import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';

/*
 * End-to-end: timetable (Phase 6) through the real browser → Vite → real API → the throwaway SQLite
 * database seeded by apps/api/test/e2e/seed.ts (TEST-CURRENT year, TEST-CLASS sections A and B;
 * e2e.classteacher is class teacher of A). Periods 7–8, subjects and Teacher → Subject links are
 * created below through the admin API. Every name is synthetic test data.
 */
const PASSWORD = 'E2e-test-pass-1';
const BASE = 'http://localhost:5174';

async function signIn(page: Page, username: string) {
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

const toast = (page: Page, text: string | RegExp) =>
  page.locator('[aria-live="polite"]').getByText(text).last();
const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

let api: APIRequestContext;

async function ok(method: 'get' | 'post' | 'put', path: string, data?: object) {
  const res = await api[method](`/api/v1${path}`, data ? { data } : {});
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return (await res.json()).data;
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  api = await playwrightRequest.newContext({ baseURL: BASE });
  await ok('post', '/auth/login', { username: 'e2e.admin', password: PASSWORD });
  const years = (await ok('get', '/admin/academic-years')) as any[];
  const year = years.find((y) => y.status === 'CURRENT');
  await ok('put', `/admin/academic-years/${year.id}/working-days`, {
    workingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
  });
  // Periods 7 and 8 with a break between, late in the day (clear of other test files' periods).
  const day = await ok('get', `/admin/academic-years/${year.id}/day-structure`);
  const has = (label: string) => day.slots.some((s: any) => s.label === label);
  if (!has('Period 7'))
    await ok('post', `/admin/academic-years/${year.id}/periods`, {
      kind: 'LESSON',
      label: 'Period 7',
      periodNumber: 7,
      startTime: '14:00',
      endTime: '14:45',
    });
  if (!has('Tea break'))
    await ok('post', `/admin/academic-years/${year.id}/periods`, {
      kind: 'BREAK',
      label: 'Tea break',
      periodNumber: null,
      startTime: '14:45',
      endTime: '15:00',
    });
  if (!has('Period 8'))
    await ok('post', `/admin/academic-years/${year.id}/periods`, {
      kind: 'LESSON',
      label: 'Period 8',
      periodNumber: 8,
      startTime: '15:00',
      endTime: '15:45',
    });
  const subjects = (await ok('get', '/admin/subjects')) as any[];
  const subject = async (name: string, displayOrder: number) =>
    subjects.find((s) => s.name === name) ??
    (await ok('post', '/admin/subjects', { name, code: null, displayOrder }));
  const maths = await subject('E2E TT Maths', 60);
  const english = await subject('E2E TT English', 61);
  const teachers = (await ok('get', '/admin/teachers?pageSize=100')).items as any[];
  const link = async (name: string, subjectId: string) => {
    const t = teachers.find((x) => x.fullName === name);
    if (!t.subjects.some((s: any) => s.id === subjectId))
      await ok('post', `/admin/teachers/${t.id}/subjects`, { subjectId });
  };
  await link('Test Subject Teacher', maths.id);
  await link('Test Class Teacher', english.id);
});

test.afterAll(async () => {
  await api.dispose();
});

test('administrator: draft, add, clash refused, drag to move, remove, save and publish', async ({
  page,
}) => {
  await signIn(page, 'e2e.admin');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Timetable' })
    .click();
  await expect(page).toHaveURL(/\/timetable\/classes/);
  await page
    .getByRole('navigation', { name: 'Timetable' })
    .getByRole('link', { name: 'Edit timetable' })
    .click();
  await page.getByLabel('Class and section').selectOption({ label: 'TEST-CLASS A' });

  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(toast(page, 'Draft started')).toBeVisible();
  const grid = page.getByRole('table', { name: /Draft timetable of TEST-CLASS A/ });
  await expect(grid.getByRole('columnheader', { name: /Tea break/ })).toBeVisible();

  const add = async (slot: string, subject: string, teacher: string) => {
    await grid.getByRole('button', { name: `Free — add a lesson on ${slot}` }).click();
    const dialog = page.getByRole('dialog', { name: 'Add lesson' });
    await dialog.getByLabel('Subject').selectOption({ label: subject });
    const teacherSelect = dialog.getByLabel('Teacher');
    const value = await teacherSelect.locator('option', { hasText: teacher }).getAttribute('value');
    await teacherSelect.selectOption(value!);
    await dialog.getByRole('button', { name: 'Add lesson' }).click();
    await expect(dialog).toBeHidden();
  };
  await add('Monday, Period 7', 'E2E TT Maths', 'Test Subject Teacher');
  await add('Tuesday, Period 7', 'E2E TT English', 'Test Class Teacher');
  await expect(page.getByText('2 unsaved changes', { exact: true })).toBeVisible();

  // A clash is refused by the server and explained; nothing changes.
  await grid
    .getByRole('button', { name: /E2E TT English, Test Class Teacher, Tuesday, Period 7/ })
    .click();
  const edit = page.getByRole('dialog', { name: /Edit lesson/ });
  await edit.getByLabel('Day').selectOption('MON');
  await edit.getByRole('button', { name: 'Apply change' }).click();
  await expect(edit.getByText(/TEST-CLASS A already has E2E TT Maths/)).toBeVisible();
  await edit.getByRole('button', { name: 'Cancel' }).click();

  // Drag the Monday lesson to Wednesday, Period 8 (validated by the server first).
  await grid
    .getByRole('button', { name: /E2E TT Maths, Test Subject Teacher, Monday, Period 7/ })
    .dragTo(grid.getByRole('button', { name: 'Free — add a lesson on Wednesday, Period 8' }));
  await expect(toast(page, /moved to Wednesday, Period 8/)).toBeVisible();
  await expect(
    grid.getByRole('button', { name: /E2E TT Maths, Test Subject Teacher, Wednesday, Period 8/ }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(toast(page, 'Draft saved')).toBeVisible();

  // Remove with confirmation.
  await grid
    .getByRole('button', { name: /E2E TT English, Test Class Teacher, Tuesday, Period 7/ })
    .click();
  await page
    .getByRole('dialog', { name: /Edit lesson/ })
    .getByRole('button', { name: 'Remove lesson' })
    .click();
  const confirm = page.getByRole('dialog', { name: 'Remove lesson?' });
  await expect(confirm).toContainText('Remove E2E TT English from TEST-CLASS A, Tuesday Period 7?');
  await confirm.getByRole('button', { name: 'Remove' }).click();
  await expect(
    grid.getByRole('button', { name: 'Free — add a lesson on Tuesday, Period 7' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(toast(page, 'Draft saved')).toBeVisible();

  await page.getByRole('button', { name: 'Publish timetable' }).click();
  await page
    .getByRole('dialog', { name: /Publish the TEST-CURRENT timetable/ })
    .getByRole('button', { name: 'Publish' })
    .click();
  await expect(toast(page, 'Timetable published (version 1)')).toBeVisible();
  await expect(page.getByRole('table', { name: 'Timetable versions' })).toContainText('Published');

  await page
    .getByRole('navigation', { name: 'Timetable' })
    .getByRole('link', { name: 'Class timetables' })
    .click();
  await expect(page).toHaveURL(/\/timetable\/classes/);
  await page.getByLabel('Class and section').selectOption({ label: 'TEST-CLASS A' });
  const live = page.getByRole('table', { name: /Timetable of TEST-CLASS A/ });
  await expect(live.getByText('E2E TT Maths')).toBeVisible();
  await expect(live.getByText('Free').first()).toBeVisible();
});

test('a teacher sees their own published week and cannot edit', async ({ page }) => {
  await signIn(page, 'e2e.teacher');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Timetable' })
    .click();
  await expect(page).toHaveURL(/\/timetable\/my/);
  const week = page.getByRole('table', { name: /Timetable of Test Subject Teacher/ });
  await expect(week.getByText('E2E TT Maths')).toBeVisible();
  await expect(week.getByText('TEST-CLASS A')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Edit timetable' })).toHaveCount(0);
  await page.goto('/timetable/edit');
  await expect(page.getByText("You don't have access to this page")).toBeVisible();
  const years = (await (await page.request.get('/api/v1/timetable/years')).json()).data.items;
  const year = years.find((y: any) => y.status === 'CURRENT');
  expect((await page.request.post(`/api/v1/timetable/years/${year.id}/draft`)).status()).toBe(403);
});

test('class teacher editing follows the permission setting and stays in their own class', async ({
  page,
}) => {
  await signIn(page, 'e2e.classteacher');
  await page.goto('/timetable/edit');
  await expect(page.getByText("You don't have access to this page")).toBeVisible();

  const current = (await ok('get', '/admin/permissions')) as any;
  const base: string[] = current.roles.find((r: any) => r.role === 'CLASS_TEACHER').effective;
  await ok('put', '/admin/permissions/CLASS_TEACHER', {
    permissions: [...new Set([...base, 'timetable.manage'])],
  });
  try {
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Edit timetable' })).toBeVisible();
    const section = page.getByLabel('Class and section');
    await expect(section.locator('option')).toHaveText(['TEST-CLASS A']);
    await expect(page.getByRole('button', { name: 'Publish timetable' })).toHaveCount(0);
  } finally {
    await ok('put', '/admin/permissions/CLASS_TEACHER', { permissions: base });
  }
});

test('timetable pages fit tablet and phone screens; phones show one day at a time', async ({
  page,
}) => {
  await signIn(page, 'e2e.admin');
  for (const [width, height] of [
    [820, 1180],
    [390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    for (const path of ['/timetable/classes', '/timetable/edit']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      if (width < 768) await page.getByRole('tab', { name: /Wed/ }).click();
      await expect(page.getByText(/E2E TT Maths/).first()).toBeVisible();
      expect(await overflow(page), `${path} at ${width}px`).toBeLessThanOrEqual(0);
    }
  }
  // Phone: day tabs; tapping a lesson opens the form.
  await page.goto('/timetable/edit');
  await page.getByRole('tab', { name: /Wed/ }).click();
  await page.getByRole('button', { name: /Edit timetable \(new draft\)/ }).click();
  await expect(toast(page, /Draft started/)).toBeVisible();
  await page.getByRole('tab', { name: /Wed/ }).click();
  await page
    .getByRole('button', { name: /E2E TT Maths, Test Subject Teacher, Wednesday, Period 8/ })
    .click();
  await expect(page.getByRole('dialog', { name: /Edit lesson/ })).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});
