import { expect, test, type Page } from '@playwright/test';

/*
 * End-to-end: real browser → Vite → real API → throwaway SQLite database seeded by
 * apps/api/test/e2e/seed.ts. Accounts and passwords below are synthetic test values.
 */
const PASSWORD = 'E2e-test-pass-1';
const TEMP_PASSWORD = 'Temp-e2e-pass-9';

async function signIn(page: Page, username: string, password = PASSWORD) {
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

async function openAccountMenu(page: Page) {
  await page.getByRole('button', { name: /Account menu/ }).click();
}

async function horizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

test.describe('sign-in and protected routes', () => {
  test('protected pages redirect to sign-in, and back after signing in', async ({ page }) => {
    await page.goto('/account/password');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(
      page.getByText('Thiruthangal Lions Matriculation Higher Secondary School'),
    ).toBeVisible();

    await signIn(page, 'e2e.admin');
    await expect(page).toHaveURL(/\/account\/password$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Change password' })).toBeVisible();
  });

  test('the official crest is shown and served from the generated web asset', async ({
    page,
    request,
  }) => {
    await page.goto('/login');
    const crest = page.locator('img[src="/brand/ttlmhss-logo.webp"]').first();
    await expect(crest).toBeVisible();
    // Wait for the image to finish decoding (under load it may still be loading).
    await expect.poll(() => crest.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(512);
    const asset = await request.get('/brand/ttlmhss-logo.webp');
    expect(asset.headers()['content-type']).toContain('image/webp');
    const icon = await request.get('/brand/favicon-32.png');
    expect(icon.status()).toBe(200);
  });

  test('validation, loading state and safe failure messages', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Enter your username.')).toBeVisible();
    await expect(page.getByText('Enter your password.')).toBeVisible();

    // Hold the request so the loading state is observable.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/api/v1/auth/login', async (route) => {
      await held;
      await route.continue();
    });
    await signIn(page, 'e2e.admin', 'Wrong-password-1');
    const busy = page.getByRole('button', { name: 'Signing in…' });
    await expect(busy).toBeDisabled();
    await expect(busy).toHaveAttribute('aria-busy', 'true');
    release();

    const alert = page.getByRole('alert').filter({ hasText: 'Invalid username or password.' });
    await expect(alert).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
    await page.unroute('**/api/v1/auth/login');

    // An unknown username gets exactly the same message.
    await signIn(page, 'e2e.nobody', 'Wrong-password-1');
    await expect(
      page.getByRole('alert').filter({ hasText: 'Invalid username or password.' }),
    ).toBeVisible();
  });

  test('show/hide password toggle', async ({ page }) => {
    await page.goto('/login');
    const field = page.getByLabel('Password', { exact: true });
    await field.fill('secret-1');
    await expect(field).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: 'Show password' }).click();
    await expect(field).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: 'Hide password' }).click();
    await expect(field).toHaveAttribute('type', 'password');
  });

  test('signed-in users visiting /login are sent into the app', async ({ page }) => {
    await page.goto('/login');
    await signIn(page, 'e2e.admin');
    await expect(page.getByRole('heading', { level: 1, name: /Welcome/ })).toBeVisible();
    await page.goto('/login');
    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe('roles in the shell', () => {
  for (const [username, role, homeText] of [
    ['e2e.admin', 'Administrator', 'You are signed in as Administrator.'],
    ['e2e.teacher', 'Teacher', 'You are signed in as Teacher.'],
    ['e2e.classteacher', 'Class Teacher', 'You are signed in as Teacher and Class Teacher.'],
    ['e2e.student', 'Student', 'You are signed in as Student.'],
  ] as const) {
    test(`${username} sees their role and only existing pages`, async ({ page }) => {
      await page.goto('/login');
      await signIn(page, username);
      await expect(page.getByText(homeText)).toBeVisible();
      await openAccountMenu(page);
      await expect(page.locator('header').getByText(role, { exact: true }).first()).toBeVisible();

      const nav = page.getByRole('navigation', { name: 'Main' });
      // Only administrators get Management (Phase 5) and School setup (Phase 4); staff get the
      // timetable (Phase 6) and Marks (Phase 8B); Results go to students, class teachers and
      // administrators (Phase 8B).
      await expect(nav.getByRole('link')).toHaveText(
        username === 'e2e.admin'
          ? [
              'Home',
              'Timetable',
              'Attendance',
              'Marks',
              'Results',
              'Behaviour',
              'Achievements',
              'Students',
              'Teachers',
              'School setup',
              'Change password',
            ]
          : username === 'e2e.student'
            ? [
                'Home',
                'My portal',
                'My profile',
                'Timetable',
                'Attendance',
                'Marks & results',
                'Behaviour',
                'Achievements',
                'Change password',
              ]
            : username === 'e2e.classteacher'
              ? [
                  'Home',
                  'Timetable',
                  'Attendance',
                  'Marks',
                  'Results',
                  'Behaviour',
                  'Achievements',
                  'Change password',
                ]
              : ['Home', 'Timetable', 'Attendance', 'Marks', 'Change password'],
      );
    });
  }

  test('unknown addresses show "page not found" inside the shell', async ({ page }) => {
    await page.goto('/login');
    await signIn(page, 'e2e.student');
    await expect(page.getByRole('heading', { level: 1, name: /Welcome/ })).toBeVisible();
    await page.goto('/no-such-page');
    await expect(page.locator('#main').getByText('Page not found')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeAttached();
  });
});

test.describe('session lifecycle', () => {
  test('temporary password must be changed before anything else', async ({ page }) => {
    await page.goto('/login');
    await signIn(page, 'e2e.newuser', TEMP_PASSWORD);
    await expect(page).toHaveURL(/\/change-password$/);
    await expect(page.getByRole('heading', { name: 'Choose your own password' })).toBeVisible();

    // Navigating directly elsewhere does not bypass it.
    await page.goto('/');
    await expect(page).toHaveURL(/\/change-password$/);

    await page.getByLabel('Temporary password').fill('Not-the-temp-1');
    await page.getByLabel('New password', { exact: true }).fill('Fresh-start-2026');
    await page.getByLabel('Confirm new password').fill('Fresh-start-2026');
    await page.getByRole('button', { name: 'Save password and continue' }).click();
    await expect(page.getByText('Current password is incorrect.')).toBeVisible();

    await page.getByLabel('Temporary password').fill(TEMP_PASSWORD);
    await page.getByRole('button', { name: 'Save password and continue' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText('Password changed. You are signed in.')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: /Welcome/ })).toBeVisible();
  });

  test('signing out ends the session on the server, not just in the page', async ({
    page,
    context,
  }) => {
    await page.goto('/login');
    await signIn(page, 'e2e.admin');
    await expect(page.getByRole('heading', { level: 1, name: /Welcome/ })).toBeVisible();
    const [session] = await context.cookies();
    expect(session?.httpOnly).toBe(true);

    await openAccountMenu(page);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText('You have signed out.')).toBeVisible();

    // Replaying the old cookie is refused by the API.
    const replay = await page.request.get('/api/v1/auth/me', {
      headers: { cookie: `${session!.name}=${session!.value}` },
    });
    expect(replay.status()).toBe(401);
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('a session ended elsewhere sends the user back to sign-in with an explanation', async ({
    page,
    browser,
  }) => {
    await page.goto('/login');
    await signIn(page, 'e2e.teacher');
    await expect(page.getByRole('heading', { level: 1, name: /Welcome/ })).toBeVisible();

    // End the same session from another browser (as an expiry or revocation would).
    const cookies = await page.context().cookies();
    const other = await browser.newContext();
    await other.addCookies(cookies);
    const logout = await other.request.post('http://localhost:5174/api/v1/auth/logout', {
      headers: { origin: 'http://localhost:5174', 'content-type': 'application/json' },
      data: {},
    });
    expect(logout.status()).toBe(200);
    await other.close();

    // The next API call from the app gets 401 → back to sign-in with a message.
    await page.getByRole('link', { name: 'Change password' }).click();
    await page.getByLabel('Current password').fill(PASSWORD);
    await page.getByLabel('New password', { exact: true }).fill('Another-pass-77');
    await page.getByLabel('Confirm new password').fill('Another-pass-77');
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText('Your session has ended')).toBeVisible();
  });
});

test.describe('responsive layout', () => {
  test('desktop: persistent sidebar, no menu button', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/login');
    await signIn(page, 'e2e.admin');
    await expect(
      page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Home' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open menu' })).toBeHidden();
    expect(await horizontalOverflow(page)).toBe(0);
  });

  test('tablet: icon rail, menu opens the full sidebar', async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.goto('/login');
    await signIn(page, 'e2e.admin');
    const home = page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Home' });
    await expect(home).toBeVisible();
    expect((await home.boundingBox())!.width).toBeLessThan(72);
    await page.getByRole('button', { name: 'Open menu' }).click();
    await expect(page.getByRole('dialog', { name: 'Menu' })).toBeVisible();
    expect((await home.boundingBox())!.width).toBeGreaterThan(150);
    expect(await horizontalOverflow(page)).toBe(0);
  });

  test('mobile: drawer navigation, keyboard friendly, no horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/login');
    expect(await horizontalOverflow(page)).toBe(0);
    await signIn(page, 'e2e.classteacher');
    await expect(page.getByRole('heading', { level: 1, name: /Welcome/ })).toBeVisible();

    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav).toBeHidden();
    const menuButton = page.getByRole('button', { name: 'Open menu' });
    await menuButton.click();
    await expect(page.getByRole('dialog', { name: 'Menu' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Close menu' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(nav).toBeHidden();
    await expect(menuButton).toBeFocused();

    await menuButton.click();
    await nav.getByRole('link', { name: 'Change password' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Change password' })).toBeVisible();
    await expect(nav).toBeHidden();
    expect(await horizontalOverflow(page)).toBe(0);
  });
});
