/* eslint-disable @typescript-eslint/no-explicit-any -- e2e reads untyped API bodies */
import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';

/*
 * End-to-end: Exams, marks and results (Phase 8B) through the real browser → Vite → real API →
 * the throwaway SQLite database seeded by apps/api/test/e2e/seed.ts (TEST-CURRENT, TEST-CLASS
 * A/B; e2e.student in A; e2e.classteacher is class teacher of A). Every name is synthetic.
 */
const PASSWORD = 'E2e-test-pass-1';
const BASE = 'http://localhost:5174';
const EXAM = 'E2E Marks Exam';
const MATHS = 'E2E Marks Maths';
const ENGLISH = 'E2E Marks English';

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
  classId: string;
  sectionA: string;
  sectionB: string;
  maths: string;
  english: string;
  teacher: string;
  exam: string;
  esMaths: string;
  esEnglish: string;
};

async function call(method: 'get' | 'post' | 'put', path: string, data?: object) {
  const res = await api[method](`/api/v1${path}`, data ? { data } : {});
  return { status: res.status(), body: await res.json().catch(() => null) };
}
async function ok(method: 'get' | 'post' | 'put', path: string, data?: object) {
  const res = await call(method, path, data);
  expect(res.status, `${method} ${path}: ${JSON.stringify(res.body)}`).toBeLessThan(300);
  return res.body.data;
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  api = await playwrightRequest.newContext({ baseURL: BASE });
  await ok('post', '/auth/login', { username: 'e2e.admin', password: PASSWORD });
  const years = (await ok('get', '/admin/academic-years')) as any[];
  ids.year = years.find((y) => y.status === 'CURRENT').id;
  const classes = (await ok('get', '/admin/classes')) as any[];
  const cls = classes.find((c) => c.name === 'TEST-CLASS');
  ids.classId = cls.id;
  ids.sectionA = cls.sections.find((s: any) => s.name === 'A').id;
  ids.sectionB = cls.sections.find((s: any) => s.name === 'B').id;
  ids.maths = (
    await ok('post', '/admin/subjects', { name: MATHS, code: null, displayOrder: 90 })
  ).id;
  ids.english = (
    await ok('post', '/admin/subjects', { name: ENGLISH, code: null, displayOrder: 91 })
  ).id;
  const teachers = await ok('get', '/admin/teachers?q=Test%20Subject%20Teacher');
  ids.teacher = teachers.items[0].id;
  await ok('post', `/admin/teachers/${ids.teacher}/subjects`, { subjectId: ids.maths });
});

test.afterAll(async () => {
  await api.dispose();
});

test('administrator creates an exam, configures its subjects and authorises a teacher', async ({
  page,
}) => {
  await signIn(page, 'e2e.admin');
  await page.goto(`/admin/exams?year=${ids.year}`);
  await page.getByRole('button', { name: 'Add exam' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Exam name').fill(EXAM);
  await dialog.getByLabel('Weightage (%)').fill('0');
  await dialog.getByLabel('Description').fill('Synthetic browser-test exam');
  await dialog.getByRole('button', { name: 'Add exam' }).click();
  await expect(toast(page, `${EXAM} added`)).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: EXAM });
  await expect(row.getByText('Draft')).toBeVisible();

  await page.getByRole('link', { name: `Set up ${EXAM}` }).click();
  await expect(page.getByRole('heading', { level: 1, name: EXAM })).toBeVisible();
  await page.getByLabel('Class', { exact: true }).selectOption({ label: 'Class TEST-CLASS' });
  await page.getByLabel(`Include ${MATHS} in ${EXAM}`).check();
  await page.getByLabel(`Theory maximum, ${MATHS}`).fill('100');
  await page.getByLabel(`Pass marks, ${MATHS}`).fill('35');
  await page.getByLabel(`Include ${ENGLISH} in ${EXAM}`).check();
  await page.getByLabel(`Theory maximum, ${ENGLISH}`).fill('50');
  await page.getByLabel(`Pass marks, ${ENGLISH}`).fill('18');
  await page.getByLabel(`Convert to, ${ENGLISH}`).fill('100');
  await page.getByRole('button', { name: 'Save subjects' }).click();
  await expect(toast(page, new RegExp(`Subjects saved for ${EXAM}`))).toBeVisible();

  // The mark-entry matrix: who enters which subject's marks for which section.
  const entry = page.getByRole('table', { name: 'Mark entry teachers' });
  await expect(entry.getByRole('row')).toHaveCount(5); // header + 2 subjects × 2 sections
  await page
    .getByLabel(`Teacher who enters ${MATHS} marks for TEST-CLASS A`)
    .selectOption(ids.teacher);
  await expect(
    toast(page, `Test Subject Teacher can enter ${MATHS} marks for TEST-CLASS A`),
  ).toBeVisible();
  // Only teachers of the subject are offered for English (nobody here).
  await expect(
    page.getByLabel(`Teacher who enters ${ENGLISH} marks for TEST-CLASS A`).locator('option'),
  ).toHaveCount(1);

  await page.getByRole('button', { name: 'Open for marks' }).click();
  await page
    .getByRole('dialog', { name: `Open for marks: ${EXAM}?` })
    .getByRole('button', { name: 'Open for marks' })
    .click();
  await expect(toast(page, `${EXAM}: Open for marks`)).toBeVisible();
  await expect(page.getByText('Open for marks', { exact: true }).first()).toBeVisible();

  const matrix = await ok('get', `/admin/exams/${await examId()}/mark-sheets`);
  const mathsA = matrix.rows.find((r: any) => r.subjectName === MATHS && r.sectionName === 'A');
  expect(mathsA.teacher.fullName).toBe('Test Subject Teacher');
  ids.esMaths = mathsA.examSubjectId;
  ids.esEnglish = matrix.rows.find((r: any) => r.subjectName === ENGLISH).examSubjectId;
});

async function examId() {
  if (ids.exam) return ids.exam;
  const list = await ok('get', `/admin/exams?academicYearId=${ids.year}`);
  ids.exam = list.exams.find((e: any) => e.name === EXAM).id;
  return ids.exam;
}

test('the authorised teacher enters marks, saves a draft and submits (locked)', async ({
  page,
}) => {
  await signIn(page, 'e2e.teacher');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Marks' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Marks' })).toBeVisible();
  const list = page.getByRole('list', { name: `Mark sheets in ${EXAM}` });
  await expect(list.getByRole('link')).toHaveText([`${MATHS} — TEST-CLASS A`]);
  await list.getByRole('link', { name: `${MATHS} — TEST-CLASS A` }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: `${MATHS} — TEST-CLASS A` }),
  ).toBeVisible();

  await expect(page.getByText('0 / 1 students entered')).toBeVisible();
  const mark = page.getByLabel('Theory for Test Student (out of 100)');
  await mark.fill('101');
  await expect(page.getByText('At most 100')).toBeVisible();
  await mark.fill('72');
  await expect(page.getByText('1 / 1 students entered')).toBeVisible();
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(toast(page, 'Draft saved · 1 / 1 students entered')).toBeVisible();
  await expect(page.getByText('Draft', { exact: true })).toBeVisible();
  await expect(page.getByText(/Students cannot see drafts/)).toBeVisible();

  await page.getByRole('button', { name: 'Submit marks' }).click();
  await page
    .getByRole('dialog', { name: `Submit ${MATHS} marks?` })
    .getByRole('button', { name: 'Submit and lock' })
    .click();
  await expect(toast(page, `${MATHS} marks submitted and locked`)).toBeVisible();
  await expect(page.getByText('Submitted · locked')).toBeVisible();
  await expect(page.getByLabel('Theory for Test Student (out of 100)')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save draft' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Unlock for correction' })).toHaveCount(0);
});

test('a teacher cannot open or write a sheet they are not authorised for', async ({ page }) => {
  await signIn(page, 'e2e.teacher');
  await page.goto(`/marks/sheet?examSubjectId=${ids.esEnglish}&sectionId=${ids.sectionA}`);
  await expect(page.getByText('You do not have access to this mark sheet.')).toBeVisible();
  await page.goto(`/marks/sheet?examSubjectId=${ids.esMaths}&sectionId=${ids.sectionB}`);
  await expect(page.getByText('You do not have access to this mark sheet.')).toBeVisible();
  const res = await page.request.put('/api/v1/marks/sheet', {
    headers: { origin: BASE },
    data: {
      examSubjectId: ids.esEnglish,
      sectionId: ids.sectionA,
      revision: null,
      marks: [],
    },
  });
  expect(res.status()).toBe(403);
});

test('the student sees the submitted subject, not the draft, then the complete result', async ({
  page,
}) => {
  // The administrator enters English as a draft (not visible to the student).
  const student = (
    await ok('get', `/marks/sheet?examSubjectId=${ids.esEnglish}&sectionId=${ids.sectionA}`)
  ).rows[0];
  const draft = await ok('put', '/marks/sheet', {
    examSubjectId: ids.esEnglish,
    sectionId: ids.sectionA,
    revision: null,
    marks: [{ studentId: student.studentId, theory: 41.5, internal: null, practical: null }],
  });

  await signIn(page, 'e2e.student');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Marks & results' })
    .click();
  await page.getByLabel('Exam').selectOption({ label: EXAM });
  const table = page.getByRole('table', { name: 'Subject results' });
  await expect(table.getByRole('row').filter({ hasText: MATHS })).toContainText('72');
  await expect(table.getByRole('row').filter({ hasText: ENGLISH })).toContainText(
    'Not yet available',
  );
  // The draft (41.5 → 83) is nowhere in the student's page.
  await expect(table).not.toContainText('41.5');
  await expect(table.getByRole('row').filter({ hasText: ENGLISH })).not.toContainText('83');
  await expect(page.locator('main')).not.toContainText('41.5');
  await expect(page.getByText('Complete result not available yet')).toBeVisible();

  await ok('post', '/marks/sheet/submit', {
    examSubjectId: ids.esEnglish,
    sectionId: ids.sectionA,
    revision: draft.revision,
  });
  await page.reload();
  await page.getByLabel('Exam').selectOption({ label: EXAM });
  // English 41.5/50 → 83/100; total 72 + 83 = 155 / 200 = 77.5 %; rank 1 of 1.
  await expect(page.getByRole('heading', { name: 'Complete result' })).toBeVisible();
  await expect(page.getByText('155 / 200')).toBeVisible();
  await expect(page.getByText('77.5%')).toBeVisible();
  await expect(page.getByText('1 / 1', { exact: true })).toBeVisible();
  await expect(page.getByText('41.5/50 converted to 83/100')).toBeVisible();

  // Phone width: readable, no sideways page scroll.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText('155 / 200')).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});

test('the class teacher unlocks with a reason, corrects, resubmits; history records it', async ({
  page,
}) => {
  await signIn(page, 'e2e.classteacher');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Marks' }).click();
  const list = page.getByRole('list', { name: `Mark sheets in ${EXAM}` });
  // Every sheet of their class, to view — no sheets of other classes.
  await expect(list.getByRole('link')).toHaveText([
    `${MATHS} — TEST-CLASS A`,
    `${ENGLISH} — TEST-CLASS A`,
  ]);
  await list.getByRole('link', { name: `${MATHS} — TEST-CLASS A` }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: `${MATHS} — TEST-CLASS A` }),
  ).toBeVisible();
  await expect(page.getByText('Submitted · locked')).toBeVisible();

  await page.getByRole('button', { name: 'Unlock for correction' }).click();
  const dialog = page.getByRole('dialog', { name: 'Unlock these marks for correction?' });
  await dialog.getByRole('button', { name: 'Unlock' }).click();
  await expect(dialog.getByText('Give a reason of at least 5 characters')).toBeVisible();
  await dialog.getByLabel('Reason').fill('Incorrect mark entered for the student');
  await dialog.getByRole('button', { name: 'Unlock' }).click();
  await expect(toast(page, /unlocked for correction/)).toBeVisible();
  await expect(page.getByText('Unlocked for correction').first()).toBeVisible();

  await page.getByLabel('Theory for Test Student (out of 100)').fill('75');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(toast(page, /Draft saved/)).toBeVisible();
  await page.getByRole('button', { name: 'Submit marks' }).click();
  await page
    .getByRole('dialog', { name: `Submit ${MATHS} marks?` })
    .getByRole('button', { name: 'Submit and lock' })
    .click();
  await expect(page.getByText('Submitted · locked')).toBeVisible();

  await page.getByRole('button', { name: 'Show history' }).click();
  const history = page.getByRole('list', { name: 'History' });
  await expect(history.getByText('Resubmitted after correction (1 students)')).toBeVisible();
  await expect(history.getByText('Corrected Test Student: Theory 72 → 75')).toBeVisible();
  await expect(history.getByText('Unlocked for correction')).toBeVisible();
  await expect(
    history.getByText(/Reason: Incorrect mark entered for the student/).first(),
  ).toBeVisible();
  await expect(history.getByText('Entered Test Student: Theory - → 72')).toBeVisible();

  // The class teacher's class results: complete, with the corrected total.
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Results' })
    .click();
  await page.getByLabel('Exam').selectOption({ label: EXAM });
  const results = page.getByRole('table', { name: 'Class results' });
  await expect(results.getByRole('row').filter({ hasText: 'Test Student' })).toContainText(
    '158 / 200',
  );
});

test('mark entry on tablet and phone: no sideways page scroll; cards on phones', async ({
  page,
}) => {
  await signIn(page, 'e2e.teacher');
  const url = `/marks/sheet?examSubjectId=${ids.esMaths}&sectionId=${ids.sectionA}`;
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.goto(url);
  await expect(page.getByRole('table', { name: 'Marks' })).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url);
  await expect(page.getByRole('list', { name: 'Marks' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Marks' })).toHaveCount(0);
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});
