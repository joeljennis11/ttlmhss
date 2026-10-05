/* eslint-disable @typescript-eslint/no-explicit-any -- e2e reads untyped API bodies */
import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';

/*
 * End-to-end: Student portal, behaviour and achievements (Phase 9) through the real browser →
 * Vite → real API → the throwaway SQLite database seeded by apps/api/test/e2e/seed.ts
 * (TEST-CURRENT; e2e.student "Test Student" in TEST-CLASS A; e2e.classteacher is its class
 * teacher). Everything this file needs is created here; every name is synthetic.
 */
const PASSWORD = 'E2e-test-pass-1';
const BASE = 'http://localhost:5174';
const EXAM = 'E2E Portal Exam';
const SUBJECT = 'E2E Portal Maths';

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
const nav = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name, exact: true }).click();

let api: APIRequestContext;
const ids = {} as { year: string; sectionA: string; sectionB: string; exam: string; other: string };

async function ok(method: 'get' | 'post' | 'put' | 'patch', path: string, data?: object) {
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
  const classes = (await ok('get', '/admin/classes')) as any[];
  const cls = classes.find((c) => c.name === 'TEST-CLASS');
  ids.sectionA = cls.sections.find((s: any) => s.name === 'A').id;
  ids.sectionB = cls.sections.find((s: any) => s.name === 'B').id;
  const subject = await ok('post', '/admin/subjects', {
    name: SUBJECT,
    code: null,
    displayOrder: 95,
  });
  const teacher = (await ok('get', '/admin/teachers?q=Test%20Subject%20Teacher')).items[0].id;
  await ok('post', `/admin/teachers/${teacher}/subjects`, { subjectId: subject.id });

  // Wednesday must be a working day (kept as other specs left it, plus Wednesday).
  const days = new Set<string>([...(year.workingDays ?? []), 'WED']);
  await ok('put', `/admin/academic-years/${year.id}/working-days`, { workingDays: [...days] });
  // A published lesson for TEST-CLASS A in a period of its own (Period 12, after every other).
  const day = await ok('post', `/admin/academic-years/${year.id}/periods`, {
    kind: 'LESSON',
    label: 'Period 12',
    periodNumber: 12,
    startTime: '19:00',
    endTime: '19:45',
  });
  const period = day.slots.find((s: any) => s.label === 'Period 12').id;
  await api.post(`/api/v1/timetable/years/${year.id}/draft`);
  await ok('post', `/timetable/years/${year.id}/draft/changes`, {
    sectionId: ids.sectionA,
    operations: [
      {
        op: 'create',
        id: crypto.randomUUID(),
        day: 'WED',
        periodId: period,
        sectionId: ids.sectionA,
        subjectId: subject.id,
        teacherId: teacher,
      },
    ],
  });
  await ok('post', `/timetable/years/${year.id}/draft/publish`);

  // An open exam with submitted marks for the class.
  const exam = await ok('post', '/admin/exams', {
    academicYearId: year.id,
    name: EXAM,
    weightagePercent: 0,
    rankScope: 'SECTION',
    displayOrder: 50,
  });
  ids.exam = exam.id;
  const subjects = await ok('put', `/admin/exams/${exam.id}/classes/${cls.id}/subjects`, {
    subjects: [{ subjectId: subject.id, theoryMax: 100, passMarks: 35 }],
  });
  await ok('put', `/admin/exams/${exam.id}/stage`, { stage: 'OPEN' });
  const sheet = await ok(
    'get',
    `/marks/sheet?examSubjectId=${subjects[0].id}&sectionId=${ids.sectionA}`,
  );
  const saved = await ok('put', '/marks/sheet', {
    examSubjectId: subjects[0].id,
    sectionId: ids.sectionA,
    revision: sheet.revision,
    marks: sheet.rows.map((r: any) => ({
      studentId: r.studentId,
      theory: 64,
      internal: null,
      practical: null,
    })),
  });
  await ok('post', '/marks/sheet/submit', {
    examSubjectId: subjects[0].id,
    sectionId: ids.sectionA,
    revision: saved.revision,
  });

  // Behaviour and achievement configuration (Phase 4).
  await ok('post', '/admin/behaviour/categories', {
    name: 'E2E Respect',
    description: null,
    displayOrder: 1,
  });
  await ok('put', '/admin/behaviour/rating-labels', {
    labels: ['Needs Improvement', 'Below Expectations', 'Satisfactory', 'Good', 'Excellent'].map(
      (label, i) => ({ rating: i + 1, label, description: null }),
    ),
  });
  await ok('post', '/admin/achievement-categories', {
    name: 'E2E Portal Sports',
    description: null,
    displayOrder: 1,
  });

  // Another student (in B), to prove a student cannot reach someone else's data.
  const other = await ok('post', '/admin/students', {
    fullName: 'E2E Portal Other',
    admissionNumber: 'E2E-P-OTHER',
    admissionDate: '2026-06-01',
    academicYearId: year.id,
    sectionId: ids.sectionB,
    rollNumber: '41',
  });
  ids.other = other.id;
});

test.afterAll(async () => {
  await api.dispose();
});

test('the class teacher records behaviour; a draft is hidden until submitted', async ({ page }) => {
  await signIn(page, 'e2e.classteacher');
  await nav(page, 'Behaviour');
  await expect(page.getByRole('heading', { level: 1, name: 'Behaviour' })).toBeVisible();
  await page.getByLabel('Exam').selectOption({ label: EXAM });
  const table = page.getByRole('table', { name: 'Behaviour' });
  await expect(table.getByRole('columnheader', { name: 'E2E Respect' })).toBeVisible();
  const row = table.getByRole('row').filter({ hasText: 'Test Student' });
  // Rate every student in every configured category (other specs may have added students and
  // categories to this class); Test Student gets 4 everywhere.
  for (const select of await table.getByRole('combobox').all()) await select.selectOption('4');
  await row.getByLabel('Remark for Test Student').fill('Always helpful');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(toast(page, /Draft saved/)).toBeVisible();

  // The student cannot see a draft.
  const student = await playwrightRequest.newContext({ baseURL: BASE });
  await student.post('/api/v1/auth/login', {
    data: { username: 'e2e.student', password: PASSWORD },
  });
  const before = await (await student.get('/api/v1/portal/behaviour')).json();
  expect(before.data.assessments.some((a: any) => a.exam.name === EXAM)).toBe(false);

  await page.getByRole('button', { name: 'Submit behaviour' }).click();
  await page
    .getByRole('dialog', { name: 'Submit behaviour?' })
    .getByRole('button', { name: 'Submit' })
    .click();
  await expect(toast(page, /students can now see it/)).toBeVisible();
  await expect(page.getByText('Submitted · visible to students')).toBeVisible();
  const after = await (await student.get('/api/v1/portal/behaviour')).json();
  expect(after.data.assessments.some((a: any) => a.exam.name === EXAM)).toBe(true);
  await student.dispose();
});

test('the class teacher adds an achievement for a student of their class', async ({ page }) => {
  await signIn(page, 'e2e.classteacher');
  await nav(page, 'Achievements');
  await page.getByRole('button', { name: 'Add achievement' }).click();
  const dialog = page.getByRole('dialog', { name: /Add an achievement/ });
  await dialog.getByLabel('Find a student').fill('Test Student');
  const studentSelect = dialog.getByLabel('Student', { exact: true });
  await expect(studentSelect.locator('option', { hasText: 'Test Student' })).toHaveCount(1);
  const value = await studentSelect
    .locator('option', { hasText: 'Test Student' })
    .getAttribute('value');
  await studentSelect.selectOption(value!);
  await dialog.getByLabel('Category').selectOption({ label: 'E2E Portal Sports' });
  await dialog.getByLabel('Title').fill('E2E Inter-school relay winner');
  await dialog.getByLabel('Date').fill(new Date().toISOString().slice(0, 10));
  await dialog.getByRole('button', { name: 'Add achievement' }).click();
  await expect(toast(page, 'Achievement added for Test Student')).toBeVisible();
  await expect(page.getByRole('article', { name: 'E2E Inter-school relay winner' })).toBeVisible();
});

test('the student sees only their own portal data, read-only', async ({ page }) => {
  await signIn(page, 'e2e.student');
  await nav(page, 'My portal');
  await expect(page.getByText('Hello, Test Student')).toBeVisible();

  await nav(page, 'My profile');
  await expect(page.getByRole('heading', { level: 1, name: 'My profile' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Test Student' })).toBeVisible();
  await expect(page.getByRole('table')).toContainText('TEST-CLASS A');

  await nav(page, 'Timetable');
  const subjects = page.getByRole('list', { name: 'Subjects and teachers' });
  await expect(subjects.getByText(SUBJECT)).toBeVisible();
  await expect(subjects).toContainText('Test Subject Teacher');

  await nav(page, 'Attendance');
  await expect(page.getByRole('heading', { level: 1, name: 'My attendance' })).toBeVisible();
  await expect(page.getByText('Attendance', { exact: true }).first()).toBeVisible();

  await nav(page, 'Marks & results');
  await page.getByLabel('Exam').selectOption({ label: EXAM });
  await expect(
    page
      .getByRole('table', { name: 'Subject results' })
      .getByRole('row')
      .filter({ hasText: SUBJECT }),
  ).toContainText('64');

  await nav(page, 'Behaviour');
  const card = page.getByRole('article', { name: `Behaviour — ${EXAM}` });
  await expect(card).toContainText('E2E Respect');
  await expect(card).toContainText('Good');
  await expect(card).toContainText('Always helpful');

  await nav(page, 'Achievements');
  await expect(page.getByRole('article', { name: 'E2E Inter-school relay winner' })).toBeVisible();

  // Another student's data is refused the same way as a missing record; no writes.
  for (const url of [
    `/api/v1/admin/students/${ids.other}`,
    `/api/v1/behaviour/students/${ids.other}`,
    `/api/v1/results/exams/${ids.exam}/students/${ids.other}`,
    `/api/v1/timetable/students/${ids.other}`,
  ]) {
    expect((await page.request.get(url)).status(), url).toBe(403);
  }
  const write = await page.request.post('/api/v1/achievements', {
    headers: { origin: BASE },
    data: {},
  });
  expect(write.status()).toBe(403);
  // Staff pages are not available.
  await page.goto('/behaviour');
  await expect(page.getByText("You don't have access to this page")).toBeVisible();
});

test('portal and behaviour sheet on tablet and phone: no sideways scroll', async ({ page }) => {
  test.setTimeout(90_000); // ten page loads at two widths
  await signIn(page, 'e2e.student');
  for (const width of [820, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const path of [
      '/portal',
      '/portal/profile',
      '/portal/timetable',
      '/portal/behaviour',
      '/portal/achievements',
    ]) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByText('Loading…')).toHaveCount(0);
      expect(await overflow(page), `${path} at ${width}`).toBeLessThanOrEqual(0);
    }
  }
  await page.context().clearCookies();
  await signIn(page, 'e2e.classteacher');
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.goto('/behaviour');
  await page.getByLabel('Exam').selectOption({ label: EXAM });
  await expect(page.getByRole('list', { name: 'Behaviour' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Behaviour' })).toHaveCount(0);
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});
