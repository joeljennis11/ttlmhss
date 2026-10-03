/* eslint-disable @typescript-eslint/no-explicit-any -- e2e reads untyped API bodies */
import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';

/*
 * End-to-end: Academic calendar (Phase 8A) through the real browser → Vite → real API → the
 * throwaway SQLite database seeded by apps/api/test/e2e/seed.ts (TEST-CURRENT, TEST-CLASS A/B).
 * Every name is synthetic. The weekly pattern is restored afterwards so other spec files see it
 * unchanged.
 */
const PASSWORD = 'E2e-test-pass-1';
const BASE = 'http://localhost:5174';
const WEEK = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;

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

/** School dates in Asia/Kolkata, as plain 'YYYY-MM-DD' strings. */
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());
const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const weekdayOf = (date: string) => WEEK[new Date(`${date}T00:00:00Z`).getUTCDay()]!;
const formatShort = (date: string) =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));

let api: APIRequestContext;
const ids = {} as {
  year: string;
  sectionA: string;
  sectionB: string;
  period: string;
  closedDay: (typeof WEEK)[number];
  previousDays: string[];
};

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
  ids.year = year.id;
  ids.previousDays = year.workingDays ?? [];
  // Every day works except one weekend day that is not today, so a special working day can be
  // added for it and today's lessons stay possible.
  ids.closedDay = weekdayOf(today) === 'SUN' ? 'SAT' : 'SUN';
  await ok('put', `/admin/academic-years/${year.id}/working-days`, {
    workingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].filter(
      (d) => d !== ids.closedDay,
    ),
  });
  const classes = (await ok('get', '/admin/classes')) as any[];
  const cls = classes.find((c) => c.name === 'TEST-CLASS');
  ids.sectionA = cls.sections.find((s: any) => s.name === 'A').id;
  ids.sectionB = cls.sections.find((s: any) => s.name === 'B').id;

  // A lesson for TEST-CLASS B today (Period 11, published now) taught by the subject teacher.
  const day = await ok('get', `/admin/academic-years/${year.id}/day-structure`);
  let period = day.slots.find((s: any) => s.label === 'Period 11');
  if (!period) {
    const next = await ok('post', `/admin/academic-years/${year.id}/periods`, {
      kind: 'LESSON',
      label: 'Period 11',
      periodNumber: 11,
      startTime: '18:00',
      endTime: '18:45',
    });
    period = next.slots.find((s: any) => s.label === 'Period 11');
  }
  ids.period = period.id;
  const subjects = (await ok('get', '/admin/subjects')) as any[];
  const subject =
    subjects.find((s) => s.name === 'E2E CAL Maths') ??
    (await ok('post', '/admin/subjects', { name: 'E2E CAL Maths', code: null, displayOrder: 70 }));
  const teachers = (await ok('get', '/admin/teachers?pageSize=100')).items as any[];
  const teacher = teachers.find((t) => t.fullName === 'Test Subject Teacher');
  if (!teacher.subjects.some((s: any) => s.id === subject.id)) {
    await ok('post', `/admin/teachers/${teacher.id}/subjects`, { subjectId: subject.id });
  }
  const versions = (await ok('get', `/timetable/years/${year.id}/versions`)).items as any[];
  if (!versions.some((v) => v.status === 'DRAFT')) {
    await ok('post', `/timetable/years/${year.id}/draft`);
  }
  const editor = await ok('get', `/timetable/years/${year.id}/editor?sectionId=${ids.sectionB}`);
  if (!editor.entries.some((e: any) => e.periodId === ids.period && e.day === weekdayOf(today))) {
    await ok('post', `/timetable/years/${year.id}/draft/changes`, {
      sectionId: ids.sectionB,
      operations: [
        {
          op: 'create',
          id: crypto.randomUUID(),
          day: weekdayOf(today),
          periodId: ids.period,
          sectionId: ids.sectionB,
          subjectId: subject.id,
          teacherId: teacher.id,
        },
      ],
    });
  }
  await ok('post', `/timetable/years/${year.id}/draft/publish`);
});

test.afterAll(async () => {
  // Restore the weekly pattern if there was one (a freshly seeded year has none, and "not set"
  // cannot be restored through the API; later spec files set their own working days).
  if (ids.previousDays.length > 0) {
    await ok('put', `/admin/academic-years/${ids.year}/working-days`, {
      workingDays: ids.previousDays,
    });
  }
  await api.dispose();
});

const registerUrl = () =>
  `/api/v1/attendance/register?date=${today}&periodId=${ids.period}&sectionId=${ids.sectionB}`;

test('administrator manages holidays and special working days; attendance follows them', async ({
  page,
}) => {
  await signIn(page, 'e2e.admin');
  await page.goto('/admin');
  await page
    .getByRole('link', { name: /Academic calendar/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Academic calendar' })).toBeVisible();
  await expect(page.getByLabel('Academic year')).toHaveValue(ids.year);

  const list = () => page.getByRole('table', { name: /Calendar entries for TEST-CURRENT/ });
  const dialog = page.getByRole('dialog', { name: 'Add calendar entry' });

  // 4–5. A whole-school holiday two weeks ahead.
  const holiday = addDays(today, 14);
  await page.getByRole('button', { name: 'Add entry' }).click();
  await dialog.getByLabel('Date').fill(holiday);
  await dialog.getByLabel(/^Status/).selectOption('HOLIDAY');
  await dialog.getByLabel(/^Reason/).fill('E2E founders day');
  await dialog.getByRole('button', { name: 'Add entry' }).click();
  await expect(toast(page, `Holiday on ${formatShort(holiday)} added`)).toBeVisible();
  await expect(list().getByRole('row', { name: /E2E founders day/ })).toContainText(
    'Entire school',
  );

  // 6–7. A special working day for TEST-CLASS B on the next closed weekday.
  let special = addDays(today, 1);
  while (weekdayOf(special) !== ids.closedDay) special = addDays(special, 1);
  await page.getByRole('button', { name: 'Add entry' }).click();
  await dialog.getByLabel('Date').fill(special);
  await expect(dialog.getByText(/normally closed/)).toBeVisible();
  await dialog.getByLabel(/^Status/).selectOption('WORKING');
  await dialog.getByLabel(/^Applies to/).selectOption('SECTIONS');
  await dialog.getByRole('checkbox', { name: 'TEST-CLASS B' }).check();
  await dialog.getByLabel(/^Reason/).fill('E2E special class');
  await dialog.getByRole('button', { name: 'Add entry' }).click();
  await expect(toast(page, `Working day on ${formatShort(special)} added`)).toBeVisible();
  await expect(list().getByRole('row', { name: /E2E special class/ })).toContainText(
    'Section TEST-CLASS B',
  );
  // An overlapping entry is refused with an explanation.
  await page.getByRole('button', { name: 'Add entry' }).click();
  await dialog.getByLabel('Date').fill(special);
  await dialog.getByLabel(/^Status/).selectOption('WORKING');
  await dialog.getByLabel(/^Reason/).fill('E2E clash');
  await dialog.getByRole('button', { name: 'Add entry' }).click();
  await expect(dialog.getByText(/already has "Working day — Section TEST-CLASS B"/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await page
    .getByRole('dialog', { name: 'Discard your changes?' })
    .getByRole('button', { name: 'Discard' })
    .click();

  // 8. Edit.
  await list()
    .getByRole('button', { name: /Edit E2E founders day/ })
    .click();
  const edit = page.getByRole('dialog', { name: /Edit entry/ });
  await edit.getByLabel(/^Reason/).fill('E2E founders day (moved)');
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(list()).toContainText('E2E founders day (moved)');

  // 10. A class holiday today for TEST-CLASS B blocks its register; TEST-CLASS A is unaffected.
  expect((await page.request.get(registerUrl())).status()).toBe(200);
  await page.getByRole('button', { name: 'Add entry' }).click();
  await dialog.getByLabel('Date').fill(today);
  await dialog.getByLabel(/^Status/).selectOption('HOLIDAY');
  await dialog.getByLabel(/^Applies to/).selectOption('SECTIONS');
  await dialog.getByRole('checkbox', { name: 'TEST-CLASS B' }).check();
  await dialog.getByLabel(/^Reason/).fill('E2E class trip');
  await dialog.getByRole('button', { name: 'Add entry' }).click();
  await expect(toast(page, `Holiday on ${formatShort(today)} added`)).toBeVisible();
  const blocked = await page.request.get(registerUrl());
  expect(blocked.status()).toBe(409);
  expect((await blocked.json()).error.message).toMatch(
    /holiday for TEST-CLASS B \(E2E class trip\)/,
  );

  // The subject teacher's lessons today no longer include TEST-CLASS B.
  const teacherContext = await page.context().browser()!.newContext();
  const tPage = await teacherContext.newPage();
  await signIn(tPage, 'e2e.teacher');
  await tPage.goto(`/attendance/lessons?date=${today}`);
  await expect(tPage.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(tPage.getByText(/TEST-CLASS B · E2E CAL Maths/)).toHaveCount(0);

  // 9 + 11. Deleting the holiday puts the date back to the weekly pattern: the normal flow returns.
  await list()
    .getByRole('button', { name: /Delete E2E class trip/ })
    .click();
  const confirm = page.getByRole('dialog', { name: 'Delete this calendar entry?' });
  await expect(confirm).toContainText('Attendance already saved is not changed');
  await confirm.getByRole('button', { name: 'Delete entry' }).click();
  await expect(list()).not.toContainText('E2E class trip');
  expect((await page.request.get(registerUrl())).status()).toBe(200);
  await tPage.reload();
  await expect(tPage.getByText(/TEST-CLASS B · E2E CAL Maths/).first()).toBeVisible();
  await teacherContext.close();

  // Clean up the remaining test entries so other spec files see the weekly pattern only.
  for (const name of [/Delete E2E founders day/, /Delete E2E special class/]) {
    await list().getByRole('button', { name }).click();
    await page
      .getByRole('dialog', { name: 'Delete this calendar entry?' })
      .getByRole('button', { name: 'Delete entry' })
      .click();
    await expect(list().getByRole('button', { name })).toHaveCount(0);
  }
});

test('teachers cannot open or change the calendar', async ({ page }) => {
  await signIn(page, 'e2e.teacher');
  await page.goto('/admin/academic-calendar');
  await expect(page.getByText("You don't have access to this page")).toBeVisible();
  expect(
    (await page.request.get(`/api/v1/admin/academic-years/${ids.year}/calendar`)).status(),
  ).toBe(403);
  expect(
    (
      await page.request.post(`/api/v1/admin/academic-years/${ids.year}/calendar`, {
        data: { date: today, status: 'HOLIDAY', scope: 'SCHOOL', reason: 'x' },
      })
    ).status(),
  ).toBe(403);
});

test('the calendar fits tablet and phone screens', async ({ page }) => {
  await signIn(page, 'e2e.admin');
  for (const [width, height] of [
    [820, 1180],
    [390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.goto('/admin/academic-calendar');
    await expect(page.getByRole('heading', { level: 1, name: 'Academic calendar' })).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(await overflow(page), `${width}px`).toBeLessThanOrEqual(0);
  }
});
