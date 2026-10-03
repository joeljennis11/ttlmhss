import { expect, test, type Page } from '@playwright/test';

/*
 * End-to-end: Admin configuration (Phase 4) through the real browser → Vite → real API → the
 * throwaway SQLite database seeded by apps/api/test/e2e/seed.ts (TEST-CURRENT year, TEST-CLASS
 * with sections A and B). Every name entered below is synthetic test data.
 *
 * Tests run in order against one database, so later tests build on earlier ones.
 */
const PASSWORD = 'E2e-test-pass-1';

async function signIn(page: Page, username: string) {
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
}

async function horizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

const toast = (page: Page, text: string | RegExp) =>
  page.locator('[aria-live="polite"]').getByText(text);

test.describe.configure({ mode: 'serial' });

test.describe('admin configuration access', () => {
  test('teachers and students get no setup menu, no access page and a 403 from the API', async ({
    page,
  }) => {
    for (const username of ['e2e.teacher', 'e2e.classteacher', 'e2e.student']) {
      await page.context().clearCookies();
      await signIn(page, username);
      await expect(page.getByRole('link', { name: 'School setup' })).toHaveCount(0);
      await page.goto('/admin/school');
      await expect(page.getByText("You don't have access to this page")).toBeVisible();
      const api = await page.request.get('/api/v1/admin/school-settings');
      expect(api.status(), username).toBe(403);
    }
  });
});

test.describe('admin configuration', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'e2e.admin');
  });

  test('school details: validation, save and audit-safe feedback', async ({ page }) => {
    await page.getByRole('link', { name: 'School setup', exact: true }).click();
    await page.getByRole('link', { name: /^School details/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'School details' })).toBeVisible();

    await page.getByLabel('Website').fill('not a web address');
    await page.getByRole('button', { name: 'Save school details' }).click();
    await expect(page.getByText(/full web address/)).toBeVisible();

    await page.getByLabel('Website').fill('');
    await page.getByLabel('Motto').fill('E2E test motto');
    await page.getByRole('button', { name: 'Save school details' }).click();
    await expect(toast(page, 'School details saved')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Motto')).toHaveValue('E2E test motto');
    await expect(page.getByText('TEST-CURRENT', { exact: false }).first()).toBeVisible();
  });

  test('academic years: add, reject overlap, working days', async ({ page }) => {
    await page.goto('/admin/academic-years');
    await page.getByRole('button', { name: 'Add academic year' }).click();
    let dialog = page.getByRole('dialog', { name: 'Add academic year' });
    await dialog.getByLabel('Name').fill('E2E-OVERLAP');
    await dialog.getByLabel('First day').fill('2027-01-01');
    await dialog.getByLabel('Last day').fill('2027-12-31');
    await dialog.getByRole('button', { name: 'Add year' }).click();
    await expect(dialog.getByText(/overlap TEST-CURRENT/)).toBeVisible();
    await dialog.getByLabel('Name').fill('E2E-NEXT');
    await dialog.getByLabel('First day').fill('2027-06-01');
    await dialog.getByLabel('Last day').fill('2028-04-30');
    await dialog.getByRole('button', { name: 'Add year' }).click();
    await expect(toast(page, 'E2E-NEXT added')).toBeVisible();
    await expect(page.getByRole('cell', { name: 'E2E-NEXT', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Working days for TEST-CURRENT' }).click();
    dialog = page.getByRole('dialog', { name: 'Working days for TEST-CURRENT' });
    for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']) {
      await dialog.getByLabel(day).check();
    }
    await dialog.getByRole('button', { name: 'Save working days' }).click();
    await expect(page.getByRole('cell', { name: 'Mon, Tue, Wed, Thu, Fri, Sat' })).toBeVisible();
  });

  test('classes, sections and subjects: duplicates are refused', async ({ page }) => {
    await page.goto('/admin/classes');
    await page.getByRole('button', { name: 'Add class' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add class' });
    await dialog.getByLabel('Class name').fill('test-class');
    await dialog.getByRole('button', { name: 'Add class' }).click();
    await expect(dialog.getByText(/already exists/)).toBeVisible();
    await dialog.getByLabel('Class name').fill('E2E-CLASS');
    await dialog.getByRole('button', { name: 'Add class' }).click();
    await expect(toast(page, 'E2E-CLASS added')).toBeVisible();

    await page.getByRole('button', { name: 'Section for E2E-CLASS' }).click();
    const section = page.getByRole('dialog', { name: 'Add a section to E2E-CLASS' });
    await section.getByLabel('Section name').fill('A');
    await section.getByRole('button', { name: 'Add section' }).click();
    await expect(toast(page, 'Section E2E-CLASS A added')).toBeVisible();

    await page.goto('/admin/subjects');
    for (const [name, code] of [
      ['E2E Subject One', 'ES1'],
      ['E2E Subject Two', 'es2'],
    ] as const) {
      await page.getByRole('button', { name: 'Add subject' }).click();
      const d = page.getByRole('dialog', { name: 'Add subject' });
      await d.getByLabel('Subject name').fill(name);
      await d.getByLabel('Code').fill(code);
      await d.getByRole('button', { name: 'Add subject' }).click();
      await expect(toast(page, `${name} added`)).toBeVisible();
    }
    await expect(page.getByRole('cell', { name: 'ES2', exact: true })).toBeVisible();
  });

  test('periods and breaks: overlaps are refused, order follows the clock', async ({ page }) => {
    await page.goto('/admin/periods');
    await expect(page.getByLabel('Academic year')).toHaveValue(/.+/);
    const add = async (button: string, values: Record<string, string>) => {
      await page.getByRole('button', { name: button }).click();
      const d = page.getByRole('dialog');
      for (const [label, value] of Object.entries(values)) await d.getByLabel(label).fill(value);
      await d.getByRole('button', { name: button }).click();
      return d;
    };
    await add('Add period', { 'Period number': '1', Starts: '09:00', Ends: '09:45' });
    await expect(toast(page, 'Period 1 added')).toBeVisible();
    await add('Add break', { Name: 'E2E break', Starts: '09:45', Ends: '10:00' });
    await expect(toast(page, 'E2E break added')).toBeVisible();
    const clash = await add('Add period', { 'Period number': '2', Starts: '09:50', Ends: '10:30' });
    await expect(clash.getByText(/overlaps E2E break/)).toBeVisible();
    await clash.getByLabel('Starts').fill('10:00');
    await clash.getByRole('button', { name: 'Add period' }).click();
    await expect(toast(page, 'Period 2 added')).toBeVisible();
    const rows = page.getByRole('row');
    await expect(rows.nth(1)).toContainText('P1');
    await expect(rows.nth(2)).toContainText('Break');
    await expect(rows.nth(3)).toContainText('P2');
  });

  test('attendance locking: example updates and the rule saves', async ({ page }) => {
    await page.goto('/admin/attendance-locking');
    await expect(
      page.getByText('Until a rule is saved, attendance is never locked.'),
    ).toBeVisible();
    await page.getByLabel('Cutoff day of the following month').fill('7');
    await expect(page.getByText(/can be changed until 7 /)).toBeVisible();
    await page.getByRole('button', { name: 'Save rule' }).click();
    await expect(toast(page, 'Attendance locking saved')).toBeVisible();
  });

  test('grade scale, exam with weightage and exam subjects', async ({ page }) => {
    await page.goto('/admin/grade-scales');
    await page.getByRole('button', { name: 'Add grade scale' }).click();
    const scale = page.getByRole('dialog', { name: 'Add grade scale' });
    await scale.getByLabel('Scale name').fill('E2E scale');
    await scale.getByLabel('Grade 1', { exact: true }).fill('P');
    await scale.getByLabel('From %').first().fill('35');
    await scale.getByLabel('Grade 2', { exact: true }).fill('F');
    await expect(scale.getByText('P: 35%–100% · F: 0%–<35%')).toBeVisible();
    await scale.getByRole('button', { name: 'Add scale' }).click();
    await expect(toast(page, 'E2E scale added')).toBeVisible();

    await page.goto('/admin/exams');
    await page.getByRole('button', { name: 'Add exam' }).click();
    let exam = page.getByRole('dialog');
    await exam.getByLabel('Exam name').fill('E2E Exam');
    await exam.getByLabel('Weightage (%)').fill('120');
    await exam.getByRole('button', { name: 'Add exam' }).click();
    await expect(exam.getByText('Weightage cannot be above 100')).toBeVisible();
    await exam.getByLabel('Weightage (%)').fill('40');
    await exam.getByLabel('Grade scale').selectOption({ label: 'E2E scale' });
    await exam.getByRole('button', { name: 'Add exam' }).click();
    await expect(toast(page, 'E2E Exam added')).toBeVisible();
    await expect(page.getByText('40% of 100% assigned')).toBeVisible();

    await page.getByRole('button', { name: 'Add exam' }).click();
    exam = page.getByRole('dialog');
    await exam.getByLabel('Exam name').fill('E2E Too much');
    await exam.getByLabel('Weightage (%)').fill('70');
    await exam.getByRole('button', { name: 'Add exam' }).click();
    await expect(exam.getByText(/cannot exceed 100%/)).toBeVisible();
    await exam.getByRole('button', { name: 'Cancel' }).click();

    await page.getByRole('link', { name: 'Subjects for E2E Exam' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'E2E Exam' })).toBeVisible();
    await page.getByLabel('Class').selectOption({ label: 'Class E2E-CLASS' });
    await page.getByLabel('Include E2E Subject One in E2E Exam').check();
    await page.getByLabel('Internal maximum, E2E Subject One').fill('20');
    await page.getByLabel('Theory maximum, E2E Subject One').fill('80');
    await page.getByLabel('Pass marks, E2E Subject One').fill('120');
    await page.getByRole('button', { name: 'Save subjects' }).click();
    await expect(page.getByText('Pass marks cannot exceed the total of 100')).toBeVisible();
    await page.getByLabel('Pass marks, E2E Subject One').fill('35');
    await page.getByRole('button', { name: 'Save subjects' }).click();
    await expect(toast(page, /Subjects saved for E2E Exam/)).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Pass marks, E2E Subject One')).toHaveValue('35');
  });

  test('behaviour categories and rating labels, achievement categories', async ({ page }) => {
    await page.goto('/admin/behaviour');
    await page.getByRole('button', { name: 'Add suggested' }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /^Add \d/ })
      .click();
    await expect(toast(page, /categories added/)).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Discipline', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Fill in suggested labels' }).click();
    await page.getByRole('button', { name: 'Save rating labels' }).click();
    await expect(toast(page, 'Rating labels saved')).toBeVisible();

    await page.goto('/admin/achievement-categories');
    await page.getByRole('button', { name: 'Add category' }).click();
    const d = page.getByRole('dialog', { name: 'Add category' });
    await d.getByLabel('Name').fill('E2E Achievement');
    await d.getByRole('button', { name: 'Add category' }).click();
    await expect(toast(page, 'E2E Achievement added')).toBeVisible();
  });

  test('role permissions: ceilings are locked; a change reaches the teacher at once', async ({
    page,
    browser,
  }) => {
    await page.goto('/admin/permissions');
    await expect(
      page.getByRole('checkbox', { name: 'Change school configuration' }),
    ).toBeDisabled();
    await page.getByRole('checkbox', { name: 'View teachers', exact: true }).check();
    await page.getByRole('button', { name: 'Save Teacher permissions' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Save permissions' }).click();
    await expect(toast(page, 'Teacher permissions saved')).toBeVisible();

    const teacher = await browser.newContext();
    const tPage = await teacher.newPage();
    await signIn(tPage, 'e2e.teacher');
    const me = await (await tPage.request.get('/api/v1/auth/me')).json();
    expect(me.data.user.permissions).toContain('teachers.view');
    expect(me.data.user.permissions).not.toContain('config.manage');
    await teacher.close();

    // Restore the defaults so other test files see the built-in permissions.
    await page.getByRole('button', { name: 'Reset to defaults' }).click();
    await page.getByRole('button', { name: 'Save Teacher permissions' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Save permissions' }).click();
    await expect(toast(page, 'Teacher permissions saved').last()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reset to defaults' })).toBeDisabled();
  });

  test('admin pages fit a phone screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const path of [
      '/admin',
      '/admin/school',
      '/admin/academic-years',
      '/admin/classes',
      '/admin/periods',
      '/admin/exams',
      '/admin/grade-scales',
      '/admin/permissions',
    ]) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(await horizontalOverflow(page), path).toBeLessThanOrEqual(0);
    }
  });
});
