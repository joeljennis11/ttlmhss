/* eslint-disable @typescript-eslint/no-explicit-any -- e2e reads untyped API bodies */
import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';

/*
 * End-to-end: period-wise attendance (Phase 7) through the real browser → Vite → real API → the
 * throwaway SQLite database seeded by apps/api/test/e2e/seed.ts (TEST-CURRENT year, TEST-CLASS
 * sections A and B; e2e.teacher teaches, e2e.classteacher is class teacher of A, e2e.student is in A).
 *
 * Lessons are taken "today", whatever day the tests run: the setup makes every weekday a working
 * day of TEST-CURRENT and publishes two lessons in a dedicated Period 9 on today's weekday:
 *   TEST-CLASS A — E2E ATT Maths — Test Subject Teacher (e2e.teacher)
 *   TEST-CLASS B — E2E ATT English — Test Class Teacher (e2e.classteacher)
 * Every name is synthetic test data.
 */
const PASSWORD = 'E2e-test-pass-1';
const BASE = 'http://localhost:5174';
const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

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

const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());
const todayCode = WEEKDAYS[new Date(`${today}T00:00:00Z`).getUTCDay()]!;

let api: APIRequestContext;
const ids: { year: string; period9: string; sectionA: string; sectionB: string } = {
  year: '',
  period9: '',
  sectionA: '',
  sectionB: '',
};

async function ok(method: 'get' | 'post' | 'put' | 'delete', path: string, data?: object) {
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
  await ok('put', `/admin/academic-years/${year.id}/working-days`, {
    workingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
  });
  const day = await ok('get', `/admin/academic-years/${year.id}/day-structure`);
  let p9 = day.slots.find((s: any) => s.label === 'Period 9');
  if (!p9) {
    const after = await ok('post', `/admin/academic-years/${year.id}/periods`, {
      kind: 'LESSON',
      label: 'Period 9',
      periodNumber: 9,
      startTime: '16:00',
      endTime: '16:45',
    });
    p9 = after.slots.find((s: any) => s.label === 'Period 9');
  }
  ids.period9 = p9.id;

  const subjects = (await ok('get', '/admin/subjects')) as any[];
  const subject = async (name: string, displayOrder: number) =>
    subjects.find((s) => s.name === name) ??
    (await ok('post', '/admin/subjects', { name, code: null, displayOrder }));
  const maths = await subject('E2E ATT Maths', 70);
  const english = await subject('E2E ATT English', 71);
  const teachers = (await ok('get', '/admin/teachers?pageSize=100')).items as any[];
  const teacherOf = async (name: string, subjectId: string) => {
    const t = teachers.find((x) => x.fullName === name);
    if (!t.subjects.some((s: any) => s.id === subjectId))
      await ok('post', `/admin/teachers/${t.id}/subjects`, { subjectId });
    return t.id as string;
  };
  const subjectTeacher = await teacherOf('Test Subject Teacher', maths.id);
  const classTeacher = await teacherOf('Test Class Teacher', english.id);

  const options = await ok('get', `/timetable/years/${year.id}/options`);
  ids.sectionA = options.sections.find((s: any) => s.sectionName === 'A').sectionId;
  ids.sectionB = options.sections.find((s: any) => s.sectionName === 'B').sectionId;

  // Publish the two Period 9 lessons for today (only what is missing).
  const versions = await ok('get', `/timetable/years/${year.id}/versions`);
  if (versions.items.some((v: any) => v.status === 'DRAFT'))
    await ok('delete', `/timetable/years/${year.id}/draft`);
  await ok('post', `/timetable/years/${year.id}/draft`);
  const operations: object[] = [];
  for (const [sectionId, subjectId, teacherId] of [
    [ids.sectionA, maths.id, subjectTeacher],
    [ids.sectionB, english.id, classTeacher],
  ] as const) {
    const ed = await ok('get', `/timetable/years/${year.id}/editor?sectionId=${sectionId}`);
    if (!ed.entries.some((e: any) => e.day === todayCode && e.periodId === ids.period9)) {
      operations.push({
        op: 'create',
        id: crypto.randomUUID(),
        day: todayCode,
        periodId: ids.period9,
        sectionId,
        subjectId,
        teacherId,
      });
    }
  }
  if (operations.length) {
    await ok('post', `/timetable/years/${year.id}/draft/changes`, {
      sectionId: ids.sectionA,
      operations,
    });
  }
  await ok('post', `/timetable/years/${year.id}/draft/publish`);
});

test.afterAll(async () => {
  await api.dispose();
});

test('teacher: today’s timetable → Take attendance → mark → save → reopen shows saved values', async ({
  page,
}) => {
  await signIn(page, 'e2e.teacher');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Timetable' })
    .click();
  await expect(page).toHaveURL(/\/timetable\/my/);
  const take = page.getByRole('link', {
    name: /Take attendance for TEST-CLASS A, E2E ATT Maths, Period 9/,
  });
  await take.click();
  await expect(page).toHaveURL(/\/attendance\/register/);

  // The lesson comes from the timetable, not from the user.
  const context = page.locator('dl').first();
  await expect(context).toContainText('TEST-CLASS A');
  await expect(context).toContainText('E2E ATT Maths');
  await expect(context).toContainText('Test Subject Teacher');
  await expect(context).toContainText('Period 9 · 4:00 PM – 4:45 PM');

  const students = page.getByRole('list', { name: 'Students' });
  const first = students.getByRole('group', { name: 'Attendance for Test Student' });
  await expect(first.getByRole('radio', { name: 'Not marked' })).toBeChecked();
  // Subject teachers mark P / A / - only.
  await expect(first.getByRole('radio', { name: 'Leave' })).toHaveCount(0);
  await first.getByRole('radio', { name: 'Absent' }).check({ force: true });
  await expect(page.getByText('1 unsaved change', { exact: true })).toBeVisible();
  // Mark all present keeps the deliberate Absent.
  await page.getByRole('button', { name: 'Mark all present' }).click();
  await expect(first.getByRole('radio', { name: 'Absent' })).toBeChecked();
  await page.getByRole('button', { name: 'Save attendance' }).click();
  await expect(toast(page, 'Attendance saved')).toBeVisible();
  await expect(page.getByText(/Saved .* by e2e\.teacher/)).toBeVisible();

  await page.reload();
  await expect(
    page
      .getByRole('group', { name: 'Attendance for Test Student' })
      .getByRole('radio', { name: 'Absent' }),
  ).toBeChecked();
});

test('a teacher cannot open another teacher’s period, even by editing the address', async ({
  page,
}) => {
  await signIn(page, 'e2e.teacher');
  await page.goto(
    `/attendance/register?date=${today}&periodId=${ids.period9}&sectionId=${ids.sectionB}`,
  );
  await expect(
    page.getByText('You can take attendance only for your own timetabled lessons.'),
  ).toBeVisible();
  const res = await page.request.put('/api/v1/attendance/register', {
    data: {
      date: today,
      periodId: ids.period9,
      sectionId: ids.sectionB,
      revision: null,
      marks: [{ studentId: crypto.randomUUID(), status: 'P' }],
    },
  });
  expect(res.status()).toBe(403);
});

test('class teacher: class day, student day with Leave across periods; the subject teacher sees it read-only', async ({
  page,
  browser,
}) => {
  await signIn(page, 'e2e.classteacher');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Attendance' })
    .click();
  await page
    .getByRole('navigation', { name: 'Attendance' })
    .getByRole('link', { name: 'Class attendance' })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Class attendance' })).toBeVisible();
  // Only their own class is offered.
  await expect(page.getByLabel('Class and section').locator('option')).toHaveText(['TEST-CLASS A']);
  const matrix = page.getByRole('table', { name: /Attendance of TEST-CLASS A/ });
  await expect(matrix.getByRole('columnheader', { name: /Period 9/ })).toBeVisible();

  await matrix.getByRole('button', { name: 'Test Student' }).click();
  const dialog = page.getByRole('dialog', { name: /Test Student —/ });
  await dialog.getByRole('checkbox', { name: /Period 9/ }).check();
  await dialog.getByLabel('Leave reason').selectOption('MEDICAL');
  await dialog.getByRole('button', { name: 'Apply leave' }).click();
  await expect(toast(page, 'Attendance updated for Test Student')).toBeVisible();
  await expect(matrix.getByRole('row', { name: /Test Student/ })).toContainText('L');

  // The subject teacher now sees the Leave as set by the class teacher, not editable.
  const teacher = await browser.newContext();
  const tPage = await teacher.newPage();
  await signIn(tPage, 'e2e.teacher');
  await tPage.goto(
    `/attendance/register?date=${today}&periodId=${ids.period9}&sectionId=${ids.sectionA}`,
  );
  await expect(tPage.getByText(/Leave \(Medical\) — set by the class teacher/)).toBeVisible();
  await teacher.close();
});

test('administrator finds the register; student sees only their own attendance', async ({
  page,
  browser,
}) => {
  await signIn(page, 'e2e.admin');
  await page.goto('/attendance/registers');
  await expect(page.getByRole('table', { name: 'Saved registers' })).toContainText('E2E ATT Maths');

  const student = await browser.newContext();
  const sPage = await student.newPage();
  await signIn(sPage, 'e2e.student');
  await sPage
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Attendance' })
    .click();
  await expect(sPage).toHaveURL(/\/attendance\/me/);
  await expect(sPage.getByRole('heading', { level: 1, name: 'My attendance' })).toBeVisible();
  await expect(sPage.getByText('Leave', { exact: true }).first()).toBeVisible();
  const tiles = sPage.locator('dl').first();
  await expect(tiles).toContainText('Leave');
  // No editing, no other students.
  expect(
    (
      await sPage.request.get(
        `/api/v1/attendance/register?date=${today}&periodId=${ids.period9}&sectionId=${ids.sectionA}`,
      )
    ).status(),
  ).toBe(403);
  await student.close();
});

test('attendance pages fit tablet and phone screens', async ({ page }) => {
  await signIn(page, 'e2e.admin');
  const register = `/attendance/register?date=${today}&periodId=${ids.period9}&sectionId=${ids.sectionA}`;
  for (const [width, height] of [
    [820, 1180],
    [390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    for (const path of [
      register,
      `/attendance/class?section=${ids.sectionA}`,
      '/attendance/registers',
    ]) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await page.waitForLoadState('networkidle');
      expect(await overflow(page), `${path} at ${width}px`).toBeLessThanOrEqual(0);
    }
  }
  // Phone: the status control stays large enough to tap.
  await page.goto(register);
  const radio = page
    .getByRole('group', { name: 'Attendance for Test Student' })
    .locator('label')
    .first();
  const box = await radio.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);

  // Phone, read-only row (the subject teacher sees the class teacher's Leave): the student's name
  // keeps a readable width instead of being squeezed by the status text.
  await page.context().clearCookies();
  await signIn(page, 'e2e.teacher');
  await page.goto(register);
  const name = page
    .getByRole('listitem')
    .filter({ hasText: 'set by the class teacher' })
    .locator('span', { hasText: /^Test Student/ })
    .first();
  expect((await name.boundingBox())!.width).toBeGreaterThan(80);
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});
