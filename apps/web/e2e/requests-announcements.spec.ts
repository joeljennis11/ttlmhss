/* eslint-disable @typescript-eslint/no-explicit-any -- e2e reads untyped API bodies */
import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';

/*
 * End-to-end: role dashboards, announcements and structured requests (Phase 10) through the real
 * browser → Vite → real API → the throwaway SQLite database seeded by apps/api/test/e2e/seed.ts
 * (TEST-CURRENT; e2e.student "Test Student" in TEST-CLASS A; e2e.classteacher is its class
 * teacher; e2e.teacher is "Test Subject Teacher"). Everything else is created here; every name is
 * synthetic. Today's lesson (Period 13, late evening) is published for TEST-CLASS A so the
 * dashboards have real lessons whatever the weekday.
 */
const PASSWORD = 'E2e-test-pass-1';
const OTHER_PASSWORD = 'E2e-dash-pass-2';
const BASE = 'http://localhost:5174';
const SUBJECT = 'E2E Dash Science';
const WEEK = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());
const weekday = WEEK[new Date(`${today}T00:00:00Z`).getUTCDay()]!;

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
const nav = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name, exact: true }).click();

let api: APIRequestContext;
const ids = {} as { year: string; sectionA: string; sectionB: string; otherUser: string };

async function ok(method: 'get' | 'post' | 'put', path: string, data?: object) {
  const res = await api[method](`/api/v1${path}`, data ? { data } : {});
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return (await res.json()).data;
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  api = await playwrightRequest.newContext({ baseURL: BASE });
  await ok('post', '/auth/login', { username: 'e2e.admin', password: PASSWORD });
  const year = ((await ok('get', '/admin/academic-years')) as any[]).find(
    (y) => y.status === 'CURRENT',
  );
  ids.year = year.id;
  const cls = ((await ok('get', '/admin/classes')) as any[]).find((c) => c.name === 'TEST-CLASS');
  ids.sectionA = cls.sections.find((s: any) => s.name === 'A').id;
  ids.sectionB = cls.sections.find((s: any) => s.name === 'B').id;

  // Today is a working day (union with what other spec files set).
  const days = new Set<string>([...(year.workingDays ?? []), weekday]);
  await ok('put', `/admin/academic-years/${year.id}/working-days`, { workingDays: [...days] });
  const subject = await ok('post', '/admin/subjects', {
    name: SUBJECT,
    code: null,
    displayOrder: 96,
  });
  const teacher = (await ok('get', '/admin/teachers?q=Test%20Subject%20Teacher')).items[0].id;
  await ok('post', `/admin/teachers/${teacher}/subjects`, { subjectId: subject.id });
  const day = await ok('post', `/admin/academic-years/${year.id}/periods`, {
    kind: 'LESSON',
    label: 'Period 13',
    periodNumber: 13,
    startTime: '20:00',
    endTime: '20:45',
  });
  const period = day.slots.find((s: any) => s.label === 'Period 13').id;
  await api.post(`/api/v1/timetable/years/${year.id}/draft`);
  await ok('post', `/timetable/years/${year.id}/draft/changes`, {
    sectionId: ids.sectionA,
    operations: [
      {
        op: 'create',
        id: crypto.randomUUID(),
        day: weekday,
        periodId: period,
        sectionId: ids.sectionA,
        subjectId: subject.id,
        teacherId: teacher,
      },
    ],
  });
  await ok('post', `/timetable/years/${year.id}/draft/publish`);

  // A student of TEST-CLASS B who can sign in (temporary password changed through the API).
  const other = await ok('post', '/admin/students', {
    fullName: 'E2E Dash Other',
    admissionNumber: 'E2E-D-OTHER',
    admissionDate: '2026-06-01',
    academicYearId: year.id,
    sectionId: ids.sectionB,
    rollNumber: '51',
  });
  const cred = await ok('post', `/admin/students/${other.id}/temporary-password`);
  ids.otherUser = cred.username;
  const first = await playwrightRequest.newContext({ baseURL: BASE });
  const login = await first.post('/api/v1/auth/login', {
    data: { username: cred.username, password: cred.temporaryPassword },
  });
  expect(login.ok()).toBe(true);
  const change = await first.post('/api/v1/auth/change-password', {
    headers: { origin: BASE },
    data: {
      currentPassword: cred.temporaryPassword,
      newPassword: OTHER_PASSWORD,
      confirmPassword: OTHER_PASSWORD,
    },
  });
  expect(change.ok(), await change.text()).toBe(true);
  await first.dispose();
});

test.afterAll(async () => {
  await api.dispose();
});

test('administrator dashboard shows real counts and today', async ({ page }) => {
  const students = (await ok('get', '/admin/students?status=ACTIVE&pageSize=5')).total;
  await signIn(page, 'e2e.admin');
  const stats = page.getByRole('list', { name: 'School at a glance' });
  await expect(stats.getByRole('link', { name: /Active students/ })).toContainText(
    String(students),
  );
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await expect(page.getByText(/registers taken in \d+ working section/)).toBeVisible();
  const quick = page.getByRole('navigation', { name: 'Quick actions' });
  await quick.getByRole('link', { name: 'Academic calendar' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Academic calendar' })).toBeVisible();
});

test('teacher dashboard lists today’s lessons and opens the attendance register', async ({
  page,
}) => {
  await signIn(page, 'e2e.teacher');
  await expect(page.getByRole('heading', { name: /Today's lessons/ })).toBeVisible();
  await expect(page.getByText(`TEST-CLASS A · ${SUBJECT}`)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Mark entry' })).toBeVisible();
  await page
    .getByRole('link', { name: new RegExp(`(Take|Open) attendance for TEST-CLASS A, ${SUBJECT}`) })
    .click();
  await expect(page).toHaveURL(/\/attendance\/register\?/);
  await expect(page.getByRole('heading', { level: 1, name: 'Attendance register' })).toBeVisible();
  await expect(page.getByText(SUBJECT).first()).toBeVisible();
});

test('class teacher dashboard shows only their own class', async ({ page }) => {
  await signIn(page, 'e2e.classteacher');
  await expect(page.getByRole('heading', { name: 'My class — TEST-CLASS A' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /My class — TEST-CLASS B/ })).toHaveCount(0);
  await expect(page.getByText(/students? in the class this year/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Open requests' })).toBeVisible();
});

test('student dashboard shows their own day and nothing about others', async ({ page }) => {
  await signIn(page, 'e2e.student');
  await expect(page.getByRole('region', { name: 'My class' })).toContainText('TEST-CLASS A');
  await expect(page.getByRole('list', { name: "Today's lessons" })).toContainText(SUBJECT);
  await expect(page.getByRole('heading', { name: 'Latest result' })).toBeVisible();
  // Not the administrator's layout.
  await expect(page.getByRole('navigation', { name: 'Quick actions' })).toHaveCount(0);
  const raw = await (await page.request.get('/api/v1/dashboard')).text();
  expect(raw).not.toContain('E2E Dash Other');
  expect(raw).toContain('Test Student');
  await expect(page.getByText('E2E Dash Other')).toHaveCount(0);
});

test('administrator posts a school-wide announcement; students read it', async ({ page }) => {
  await signIn(page, 'e2e.admin');
  await nav(page, 'Announcements');
  await page.getByRole('link', { name: 'Manage announcements' }).click();
  await page.getByRole('button', { name: 'New announcement' }).click();
  const dialog = page.getByRole('dialog', { name: 'New announcement' });
  await dialog.getByLabel('Title').fill('E2E Sports day on Friday');
  await dialog.getByLabel('Message').fill('All classes assemble on the ground at 8:30.');
  await dialog.getByLabel('Audience').selectOption('SCHOOL');
  await dialog.getByRole('button', { name: 'Publish' }).click();
  await expect(toast(page, '“E2E Sports day on Friday” published')).toBeVisible();

  await page.context().clearCookies();
  await signIn(page, 'e2e.student');
  const card = page.getByRole('link', { name: 'E2E Sports day on Friday' });
  await expect(card).toBeVisible();
  await card.click();
  await expect(page.getByText('All classes assemble on the ground at 8:30.')).toBeVisible();
});

test('class teacher posts to their own section; another class cannot see it', async ({ page }) => {
  await signIn(page, 'e2e.classteacher');
  await page.goto('/announcements/manage');
  await page.getByRole('button', { name: 'New announcement' }).click();
  const dialog = page.getByRole('dialog', { name: 'New announcement' });
  await expect(dialog.getByLabel('Audience').locator('option')).toHaveText(['A class section']);
  await dialog.getByLabel('Title').fill('E2E Class A lab coats');
  await dialog.getByLabel('Message').fill('Bring your lab coat tomorrow.');
  await dialog.getByRole('button', { name: 'Publish' }).click();
  await expect(toast(page, '“E2E Class A lab coats” published')).toBeVisible();
  const created = (await (await page.request.get('/api/v1/announcements?q=E2E%20Class%20A')).json())
    .data.items[0];
  expect(created).toMatchObject({ audience: 'SECTION', audienceLabel: 'TEST-CLASS A' });
  // Posting to another section is refused by the server.
  const refused = await page.request.post('/api/v1/announcements', {
    headers: { origin: BASE },
    data: {
      announcement: {
        title: 'x',
        body: 'x',
        audience: 'SECTION',
        sectionId: ids.sectionB,
        classId: null,
        expiresOn: null,
      },
      publish: true,
    },
  });
  expect(refused.status()).toBe(403);

  // A student of TEST-CLASS A sees it …
  await page.context().clearCookies();
  await signIn(page, 'e2e.student');
  await nav(page, 'Announcements');
  await expect(page.getByRole('link', { name: 'E2E Class A lab coats' })).toBeVisible();
  // … a student of TEST-CLASS B does not, not even by its address.
  await page.context().clearCookies();
  await signIn(page, ids.otherUser, OTHER_PASSWORD);
  await nav(page, 'Announcements');
  await expect(page.getByRole('link', { name: 'E2E Sports day on Friday' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'E2E Class A lab coats' })).toHaveCount(0);
  expect((await page.request.get(`/api/v1/announcements/${created.id}`)).status()).toBe(403);
  await page.goto(`/announcements/${created.id}`);
  await expect(page.getByText('You do not have access to this announcement.')).toBeVisible();
});

test('a student sends an attendance issue and follows it to its resolution', async ({
  page,
  browser,
}) => {
  // 11. The student creates the request about today's lesson.
  await signIn(page, 'e2e.student');
  await nav(page, 'My requests');
  await page.getByRole('button', { name: 'New request' }).click();
  const dialog = page.getByRole('dialog', { name: 'New request' });
  await dialog.getByLabel('What is it about?').selectOption('ATTENDANCE_ISSUE');
  await dialog.getByLabel('Date').fill(today);
  const periodSelect = dialog.getByLabel('Period');
  await expect(periodSelect.locator('option', { hasText: SUBJECT })).toHaveCount(1);
  const value = await periodSelect.locator('option', { hasText: SUBJECT }).getAttribute('value');
  await periodSelect.selectOption(value!);
  await dialog.getByLabel('Describe the problem').fill('I was present in this lesson.');
  await dialog.getByRole('button', { name: 'Send request' }).click();
  await expect(toast(page, /Request RQ-\w+ sent/)).toBeVisible();
  await expect(page.getByText(/waiting to be reviewed/)).toBeVisible();
  const requestUrl = page.url();

  // 12. Its status in My requests.
  await nav(page, 'My requests');
  const mine = page.getByRole('list', { name: 'My requests' });
  await expect(mine.getByRole('listitem').filter({ hasText: SUBJECT }).first()).toContainText(
    'Open',
  );

  // 13–15. The class teacher opens it, reviews and resolves it.
  const ctContext = await browser.newContext();
  const ct = await ctContext.newPage();
  await signIn(ct, 'e2e.classteacher');
  await nav(ct, 'Requests');
  await ct
    .getByRole('list', { name: 'Requests' })
    .getByRole('link', { name: new RegExp(SUBJECT) })
    .first()
    .click();
  await expect(ct.getByRole('heading', { level: 1 })).toContainText(SUBJECT);
  await expect(
    ct.getByRole('link', { name: 'Open the class attendance for that day' }),
  ).toBeVisible();
  await ct.getByRole('button', { name: 'Start review' }).click();
  await expect(toast(ct, 'Request taken into review')).toBeVisible();
  await expect(ct.getByText('In review').first()).toBeVisible();
  await ct.getByRole('button', { name: 'Resolve' }).click();
  const resolve = ct.getByRole('dialog', { name: 'Resolve this request' });
  await resolve.getByLabel('Resolution').fill('Checked the register with the subject teacher.');
  await resolve.getByRole('button', { name: 'Resolve' }).click();
  await expect(toast(ct, 'Request resolved')).toBeVisible();
  const history = ct.getByRole('list', { name: 'Request history' });
  await expect(history).toContainText('Review started');
  await expect(history).toContainText('Resolved');
  await ctContext.close();

  // 16. The student sees the resolution.
  await page.goto(requestUrl);
  await expect(page.getByText('Resolved').first()).toBeVisible();
  await expect(page.getByText('Checked the register with the subject teacher.')).toBeVisible();
  // Students cannot change it.
  const id = requestUrl.split('/').pop();
  const write = await page.request.post(`/api/v1/requests/${id}/status`, {
    headers: { origin: BASE },
    data: { status: 'CLOSED', note: 'Closing myself', revision: 3 },
  });
  expect(write.status()).toBe(403);
});

test('dashboards and request pages fit tablet and phone screens', async ({ page }) => {
  test.setTimeout(90_000);
  for (const [username, paths] of [
    ['e2e.student', ['/', '/announcements', '/portal/requests']],
    ['e2e.teacher', ['/']],
    ['e2e.classteacher', ['/', '/requests', '/announcements/manage']],
  ] as const) {
    await page.context().clearCookies();
    await page.setViewportSize({ width: 1280, height: 900 });
    await signIn(page, username);
    for (const width of [820, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const path of paths) {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expect(page.getByText('Loading…')).toHaveCount(0);
        expect(await overflow(page), `${username} ${path} at ${width}`).toBeLessThanOrEqual(0);
      }
    }
  }
});
