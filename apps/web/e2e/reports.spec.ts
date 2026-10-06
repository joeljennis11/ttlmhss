/* eslint-disable @typescript-eslint/no-explicit-any -- e2e reads untyped API bodies */
import { readFileSync } from 'node:fs';
import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type Download,
  type Page,
} from '@playwright/test';

/*
 * End-to-end: reports, PDFs and annual reports (Phase 11) through the real browser → Vite → real
 * API → the throwaway SQLite database seeded by apps/api/test/e2e/seed.ts (TEST-CURRENT;
 * e2e.student "Test Student" in TEST-CLASS A; e2e.classteacher is its class teacher). This file
 * creates its own exam (weightage 100 %; other exams of the year are set to 0 % so the annual
 * figure is computable) and submits real marks. Every name is synthetic.
 */
const PASSWORD = 'E2e-test-pass-1';
const BASE = 'http://localhost:5174';
const EXAM = 'E2E Report Exam';
const SUBJECT = 'E2E Report English';

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
const fileOf = async (download: Download) => readFileSync((await download.path())!);

let api: APIRequestContext;
const ids = {} as { year: string; sectionA: string; exam: string; student: string; other: string };

async function ok(method: 'get' | 'post' | 'put' | 'patch', path: string, data?: object) {
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
  const sectionB = cls.sections.find((s: any) => s.name === 'B').id;

  // Only this file's exam counts in the annual figure (100 %).
  const exams = (await ok('get', `/admin/exams?academicYearId=${year.id}`)).exams as any[];
  for (const e of exams.filter((x) => x.weightagePercent > 0)) {
    await ok('patch', `/admin/exams/${e.id}`, { weightagePercent: 0 });
  }
  const subject = await ok('post', '/admin/subjects', {
    name: SUBJECT,
    code: null,
    displayOrder: 97,
  });
  const teacher = (await ok('get', '/admin/teachers?q=Test%20Subject%20Teacher')).items[0].id;
  await ok('post', `/admin/teachers/${teacher}/subjects`, { subjectId: subject.id });
  const exam = await ok('post', '/admin/exams', {
    academicYearId: year.id,
    name: EXAM,
    weightagePercent: 100,
    rankScope: 'SECTION',
    displayOrder: 60,
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
      theory: 72,
      internal: null,
      practical: null,
    })),
  });
  await ok('post', '/marks/sheet/submit', {
    examSubjectId: subjects[0].id,
    sectionId: ids.sectionA,
    revision: saved.revision,
  });
  ids.student = sheet.rows.find((r: any) => r.fullName === 'Test Student').studentId;
  const other = await ok('post', '/admin/students', {
    fullName: 'E2E Report Other',
    admissionNumber: 'E2E-R-OTHER',
    admissionDate: '2026-06-01',
    academicYearId: year.id,
    sectionId: sectionB,
    rollNumber: '61',
  });
  ids.other = other.id;
});

test.afterAll(async () => {
  await api.dispose();
});

test('administrator opens Reports and downloads an official exam report card', async ({ page }) => {
  await signIn(page, 'e2e.admin');
  await nav(page, 'Reports');
  const tabs = page.getByRole('tablist', { name: 'Report types' });
  await expect(tabs.getByRole('tab')).toHaveText([
    'Report cards',
    'Mark sheets',
    'Attendance',
    'Student performance',
    'Annual reports',
  ]);
  await page.getByLabel('Exam').selectOption({ label: EXAM });
  await page.getByLabel('Class', { exact: true }).selectOption({ label: 'TEST-CLASS A' });
  const card = page.getByRole('button', { name: 'Report card PDF for Test Student' });
  await expect(card).toBeEnabled();
  await page.getByRole('button', { name: 'Preview report card of Test Student' }).click();
  await expect(page.getByRole('cell', { name: SUBJECT })).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), card.click()]);
  expect(download.suggestedFilename()).toMatch(/_ExamReport_.*_E2E-Report-Exam\.pdf$/);
  const pdf = await fileOf(download);
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  expect(pdf.toString('latin1')).toContain('/MediaBox [0 0 595.28 841.89]');
});

test('class teacher downloads the class attendance report as PDF and Excel', async ({ page }) => {
  await signIn(page, 'e2e.classteacher');
  await page.goto('/reports?tab=attendance');
  await expect(
    page.getByRole('heading', { name: /Class attendance — TEST-CLASS A/ }),
  ).toBeVisible();
  const [pdf] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'PDF', exact: true }).first().click(),
  ]);
  expect((await fileOf(pdf)).subarray(0, 5).toString()).toBe('%PDF-');
  const [xlsx] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Excel' }).click(),
  ]);
  expect(xlsx.suggestedFilename()).toMatch(/_ClassAttendance_.*\.xlsx$/);
  expect((await fileOf(xlsx)).subarray(0, 2).toString()).toBe('PK');
  // Another class is refused by the server.
  const other = await page.request.get(
    `/api/v1/reports/attendance/class?sectionId=${ids.other}&from=2026-06-01&to=2026-06-30`,
  );
  expect(other.status()).toBe(403);
});

test('reports are refused outside the caller’s scope', async ({ page }) => {
  await signIn(page, 'e2e.student');
  await page.goto('/reports');
  await expect(page.getByText("You don't have access to this page")).toBeVisible();
  for (const url of [
    `/api/v1/reports/exam-card?examId=${ids.exam}&studentId=${ids.other}`,
    `/api/v1/reports/performance?studentId=${ids.other}`,
    `/api/v1/reports/annual?academicYearId=${ids.year}&studentId=${ids.other}`,
    `/api/v1/reports/attendance/class?sectionId=${ids.sectionA}&from=2026-06-01&to=2026-06-30`,
  ]) {
    expect((await page.request.get(url)).status(), url).toBe(403);
  }
  await page.context().clearCookies();
  await signIn(page, 'e2e.teacher');
  expect(
    (
      await page.request.get(
        `/api/v1/reports/exam-card?examId=${ids.exam}&studentId=${ids.student}`,
      )
    ).status(),
  ).toBe(403);
});

test('annual report: class teacher drafts and finalizes, administrator publishes, student downloads', async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  // Before publication the student has nothing.
  await signIn(page, 'e2e.student');
  await nav(page, 'My reports');
  await expect(page.getByText(/Not published/)).toBeVisible();
  const card = page.getByRole('button', { name: `Report card PDF for ${EXAM}` });
  await expect(card).toBeVisible();
  const [own] = await Promise.all([page.waitForEvent('download'), card.click()]);
  expect((await fileOf(own)).subarray(0, 5).toString()).toBe('%PDF-');
  expect(
    (await page.request.get(`/api/v1/reports/annual?academicYearId=${ids.year}`)).status(),
  ).toBe(404);

  // Class teacher: prepare, remark, finalize.
  const ctContext = await browser.newContext();
  const ct = await ctContext.newPage();
  await signIn(ct, 'e2e.classteacher');
  await ct.goto('/reports?tab=annual');
  await ct
    .getByRole('list', { name: 'Annual reports' })
    .getByRole('link', { name: 'Test Student' })
    .click();
  await expect(
    ct.getByRole('heading', { level: 1, name: /Annual report — Test Student/ }),
  ).toBeVisible();
  await ct.getByRole('button', { name: 'Prepare draft' }).click();
  await expect(toast(ct, 'Draft prepared')).toBeVisible();
  await expect(ct.getByText('Draft', { exact: true })).toBeVisible();
  await ct.getByLabel("Class teacher's final remark").fill('A diligent and cheerful year.');
  await ct.getByRole('button', { name: 'Save remark' }).click();
  await expect(toast(ct, 'Remark saved')).toBeVisible();
  await ct.getByRole('button', { name: 'Finalize' }).click();
  await ct
    .getByRole('dialog', { name: 'Finalize this annual report?' })
    .getByRole('button', { name: 'Finalize' })
    .click();
  await expect(toast(ct, 'Annual report finalized')).toBeVisible();
  await expect(ct.getByText('Finalized', { exact: true })).toBeVisible();
  // Class teachers do not publish.
  await expect(ct.getByRole('button', { name: 'Publish to student' })).toHaveCount(0);
  await ctContext.close();

  // Administrator publishes.
  const adminContext = await browser.newContext();
  const ad = await adminContext.newPage();
  await signIn(ad, 'e2e.admin');
  await ad.goto(`/reports/annual/${ids.year}/${ids.student}`);
  await ad.getByRole('button', { name: 'Publish to student' }).click();
  await ad
    .getByRole('dialog', { name: 'Publish to the student?' })
    .getByRole('button', { name: 'Publish' })
    .click();
  await expect(toast(ad, 'Published to the student')).toBeVisible();
  await adminContext.close();

  // The student sees and downloads their own official annual report.
  await page.reload();
  const annual = page.getByRole('button', { name: /Annual report .* PDF/ });
  await expect(annual).toBeVisible();
  const [file] = await Promise.all([page.waitForEvent('download'), annual.click()]);
  expect(file.suggestedFilename()).toMatch(/_AnnualReport_.*\.pdf$/);
  const pdf = await fileOf(file);
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  expect(pdf.toString('latin1')).toContain('/MediaBox [0 0 595.28 841.89]');
});

test('reports pages fit tablet and phone screens', async ({ page }) => {
  test.setTimeout(90_000);
  for (const [username, paths] of [
    [
      'e2e.admin',
      [
        '/reports',
        '/reports?tab=attendance',
        '/reports?tab=annual',
        `/reports/annual/${ids.year}/${ids.student}`,
      ],
    ],
    ['e2e.student', ['/portal/reports']],
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
