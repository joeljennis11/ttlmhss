/* eslint-disable @typescript-eslint/no-explicit-any -- e2e reads untyped API bodies */
import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';

/*
 * End-to-end: timetable change requests (Phase 12C) through the real browser → Vite → real API.
 * e2e.classteacher (class teacher of TEST-CLASS A, without timetable.manage) asks to add a lesson
 * in a free slot; a subject teacher is refused; the administrator sees it on the dashboard and
 * approves it into the draft. The published timetable is not changed; this file restores the
 * draft state it found so later files are unaffected. Every name is synthetic.
 */
const PASSWORD = 'E2e-test-pass-1';
const BASE = 'http://localhost:5174';
const SUBJECT = 'E2E Request Music';
const DAY_LONG: Record<string, string> = {
  MON: 'Monday',
  TUE: 'Tuesday',
  WED: 'Wednesday',
  THU: 'Thursday',
  FRI: 'Friday',
  SAT: 'Saturday',
  SUN: 'Sunday',
};

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
const ids = {} as {
  year: string;
  sectionA: string;
  day: string;
  period: string;
  periodLabel: string;
  hadDraft: boolean;
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
  const year = ((await ok('get', '/admin/academic-years')) as any[]).find(
    (y) => y.status === 'CURRENT',
  );
  ids.year = year.id;
  const cls = ((await ok('get', '/admin/classes')) as any[]).find((c) => c.name === 'TEST-CLASS');
  ids.sectionA = cls.sections.find((s: any) => s.name === 'A').id;
  const subject = await ok('post', '/admin/subjects', {
    name: SUBJECT,
    code: null,
    displayOrder: 96,
  });
  const teacher = (await ok('get', '/admin/teachers?q=Test%20Subject%20Teacher')).items[0].id;
  await ok('post', `/admin/teachers/${teacher}/subjects`, { subjectId: subject.id });

  // A free lesson slot of TEST-CLASS A (published and draft), and the draft state to restore.
  const view = await ok('get', `/timetable/years/${year.id}/sections/${ids.sectionA}`);
  const versions = (await ok('get', `/timetable/years/${year.id}/versions`)).items as any[];
  ids.hadDraft = versions.some((v) => v.status === 'DRAFT');
  const taken = new Set<string>(view.entries.map((e: any) => `${e.day}|${e.periodId}`));
  if (ids.hadDraft) {
    const draft = await ok('get', `/timetable/years/${year.id}/editor?sectionId=${ids.sectionA}`);
    for (const e of draft.entries ?? []) taken.add(`${e.day}|${e.periodId}`);
  }
  const lessons = (view.periods as any[]).filter(
    (p) => p.kind === 'LESSON' && p.status === 'ACTIVE',
  );
  outer: for (const day of view.workingDays as string[]) {
    for (const p of lessons) {
      if (!taken.has(`${day}|${p.id}`)) {
        Object.assign(ids, { day, period: p.id, periodLabel: p.label });
        break outer;
      }
    }
  }
  expect(ids.period, 'a free lesson slot for TEST-CLASS A').toBeTruthy();
});

test.afterAll(async () => {
  if (!ids.hadDraft) await api.delete(`/api/v1/timetable/years/${ids.year}/draft`);
  await api.dispose();
});

test('class teacher asks for a timetable change; a subject teacher cannot', async ({ page }) => {
  await signIn(page, 'e2e.classteacher');
  // Without timetable.manage there is no editor, but there is the request page.
  await page.goto('/timetable/requests');
  await expect(page.getByRole('heading', { name: 'Timetable requests', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Edit timetable' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Request a change' }).click();
  const dialog = page.getByRole('dialog', { name: 'Request a timetable change' });
  await dialog.getByLabel('Class').selectOption({ label: 'TEST-CLASS A' });
  await dialog.getByLabel('Day').selectOption({ label: DAY_LONG[ids.day]! });
  await dialog.getByLabel('Period').selectOption({ label: ids.periodLabel });
  await dialog.getByLabel('What should change').selectOption({ label: 'Add a lesson' });
  await dialog.getByLabel('Subject').selectOption({ label: SUBJECT });
  await dialog.getByLabel('Teacher').selectOption({ label: 'Test Subject Teacher' });
  // Validation is shown next to the field.
  await dialog.getByRole('button', { name: 'Send request' }).click();
  await expect(dialog.getByText('Reason is required')).toBeVisible();
  await dialog.getByLabel('Reason').fill('Music lessons start this term.');
  await dialog.getByRole('button', { name: 'Send request' }).click();
  await expect(toast(page, 'Request sent to the administrators.')).toBeVisible();
  const item = page.getByRole('listitem').filter({ hasText: SUBJECT });
  await expect(item).toContainText('Waiting for review');
  await expect(item).toContainText('Music lessons start this term.');
  await expect(item.getByRole('button', { name: 'Approve into draft' })).toHaveCount(0);

  // A subject teacher has no request page and the API refuses.
  const other = await page.context().browser()!.newContext({ baseURL: BASE });
  const teacher = await other.newPage();
  await signIn(teacher, 'e2e.teacher');
  const res = await teacher.request.get('/api/v1/timetable/change-requests');
  expect(res.status()).toBe(403);
  await other.close();
});

test('administrator sees the request on the dashboard and approves it into the draft', async ({
  page,
}) => {
  await signIn(page, 'e2e.admin');
  const panel = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Timetable requests' }) });
  await expect(panel.getByText(/change request(s)? waiting for review/)).toBeVisible();
  await expect(panel.getByRole('list', { name: 'Timetable requests' })).toContainText(
    'Music lessons start this term.',
  );
  await panel.getByRole('link', { name: 'Review requests' }).click();
  await expect(page).toHaveURL(/\/timetable\/requests/);
  const item = page.getByRole('listitem').filter({ hasText: SUBJECT });
  await item.getByRole('button', { name: 'Approve into draft' }).click();
  await page
    .getByRole('dialog', { name: 'Approve this change?' })
    .getByRole('button', { name: 'Approve into draft' })
    .click();
  await expect(toast(page, /Approved\. The change is in the draft/)).toBeVisible();
  await page.getByLabel('Show').selectOption({ label: 'Approved' });
  await expect(page.getByRole('listitem').filter({ hasText: SUBJECT })).toContainText(
    'Approved — in the draft',
  );
  // In the draft, not live.
  const draft = await ok('get', `/timetable/years/${ids.year}/editor?sectionId=${ids.sectionA}`);
  expect(JSON.stringify(draft)).toContain(SUBJECT);
  const live = await ok('get', `/timetable/years/${ids.year}/sections/${ids.sectionA}`);
  expect(JSON.stringify(live)).not.toContain(SUBJECT);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/timetable/requests?status=ALL');
  await expect(page.getByRole('listitem').filter({ hasText: SUBJECT })).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});
