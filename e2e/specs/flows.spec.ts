import { expect, test, type Page } from '@playwright/test';
import { COURSE } from '../env.js';
import { apiGet, apiSend, openDashboard, pane, widget } from '../helpers.js';

/**
 * The e2e server runs with auth off, which has no sign-out. These answer /api/auth/me as a signed-in person until
 * /api/auth/logout is called, then as a visitor; every other request still reaches the real server.
 */
async function fakeSession(page: Page, start: { signedIn: boolean } = { signedIn: true }) {
  let signedIn = start.signedIn;
  await page.route('**/api/auth/me', (r) =>
    r.fulfill({
      json: signedIn
        ? { identity: 'sam@example.com', user: { email: 'sam@example.com', name: 'Sam', picture: null }, authDisabled: false, signIn: { google: true, access: false } }
        : { identity: null, user: null, authDisabled: false, signIn: { google: true, access: false } },
    }),
  );
  await page.route('**/api/auth/logout', (r) => {
    signedIn = false;
    return r.fulfill({ json: { ok: true } });
  });
}

test.describe('flows', () => {
  for (const from of ['the profile menu', 'Settings → Account']) {
    test(`signing out from ${from} lands on the landing page straight away`, async ({ page }) => {
      await fakeSession(page);
      if (from === 'the profile menu') {
        await openDashboard(page);
        await page.getByRole('button', { name: 'Profile and settings' }).click();
        await page.getByRole('menuitem', { name: 'Sign out' }).click();
      } else {
        await page.goto('/settings/account');
        await page.getByRole('button', { name: 'Sign out' }).click();
      }
      await expect(page).toHaveURL(/\/$/);
      await expect(page.getByRole('heading', { name: /Everything you juggle/ })).toBeVisible({ timeout: 3_000 });
      await expect(page.getByText('Signed out')).toBeVisible();
      await expect(page.getByText(/couldn.t load|unauthorized/i)).toHaveCount(0);
    });
  }

  test("the course pane's edit button opens that course's editor and closes the pane", async ({ page }) => {
    await openDashboard(page);
    await widget(page, 'Classes overview').getByRole('button', { name: /CMSC422/ }).click();
    const drawer = pane(page);
    await expect(drawer.getByText('CMSC422', { exact: true })).toBeVisible();

    await drawer.getByRole('link', { name: 'Edit this course' }).click();
    await expect(page).toHaveURL(/\/settings\/courses$/); // the ?edit= param is consumed
    await expect(page.getByRole('dialog', { name: 'Edit CMSC422' })).toBeVisible();
    await expect(drawer).toBeHidden();
  });

  test('navigating away closes an open pane', async ({ page }) => {
    await openDashboard(page);
    await widget(page, 'Classes overview').getByRole('button', { name: /MATH423/ }).click();
    await expect(pane(page)).toBeVisible();
    // The pane takes focus, so the keyboard lands inside it rather than on the board behind.
    await expect(pane(page)).toBeFocused();

    await page.goto('/settings/sources');
    await page.goBack();
    await expect(page.getByRole('heading', { name: /^Today,/ })).toBeVisible();
    await expect(pane(page)).toBeHidden();
  });

  test('an unknown address goes to the home page instead of a blank one', async ({ page }) => {
    await page.goto('/no/such/page');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: /Everything you juggle/ })).toBeVisible();
  });

  test('"/" is the home page even when signed in, and Open dashboard leads to the board', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Everything you juggle/ })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sign in' })).toHaveCount(0);
    await page.getByRole('link', { name: 'Open dashboard' }).first().click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { name: /^Today,/ })).toBeVisible();
  });

  test('a visitor opening the board is sent to sign in, which then returns to the board', async ({ page }) => {
    await fakeSession(page, { signedIn: false });
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/signin$/);
    await expect(page.getByRole('link', { name: /Google/ })).toHaveAttribute('href', `/api/auth/google/start?next=${encodeURIComponent('/dashboard')}`);
    // Straight to sign-in, with no page to come back to, still lands on the board.
    await page.goto('/signin');
    await expect(page.getByRole('link', { name: /Google/ })).toHaveAttribute('href', `/api/auth/google/start?next=${encodeURIComponent('/dashboard')}`);
  });

  test('the profile menu theme and accent are reachable by keyboard and keep the menu open', async ({ page }) => {
    // Theme and accent live in this test's own browser context, so nothing leaks into the others.
    await openDashboard(page);
    await page.getByRole('button', { name: 'Profile and settings' }).click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();

    await menu.getByRole('menuitemradio', { name: 'dark' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitemradio', { name: 'dark' })).toHaveAttribute('aria-checked', 'true');

    await menu.getByRole('menuitemradio', { name: 'Forest accent' }).focus();
    await page.keyboard.press('ArrowDown'); // menus move up and down, the swatch row included
    await expect(menu.getByRole('menuitemradio', { name: 'Royal accent' })).toBeFocused(); // Radix moves focus a tick later
    await page.keyboard.press('Enter');
    await expect(menu.getByRole('menuitemradio', { name: 'Royal accent' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('html')).toHaveAttribute('data-accent', 'royal');

    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  });

  test('the exams widget lists every upcoming exam in a scrolling list, not the first few', async ({ page, request }) => {
    const tag = Date.now();
    const titles = Array.from({ length: 8 }, (_, i) => `Quiz ${i + 1} (e2e ${tag})`);
    const day = (n: number) => {
      const d = new Date(Date.now() + n * 86_400_000);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const created: string[] = [];
    try {
      for (const [i, title] of titles.entries()) {
        const row = await apiSend<{ externalId: string }>(request, 'post', '/items/manual', { courseId: COURSE.cmsc422, kind: 'quiz', title, date: day(i + 2), start: '10:00', end: '10:30' });
        created.push(row.externalId);
      }
      await openDashboard(page);
      await page.getByRole('button', { name: 'Edit layout' }).click();
      await page.getByRole('button', { name: 'Add widget' }).click();
      await page.getByRole('dialog', { name: 'Add a widget' }).getByRole('listitem').filter({ hasText: 'Exams' }).getByRole('button', { name: /^List/ }).click();
      await page.getByRole('button', { name: 'Done' }).click();

      const exams = widget(page, 'Exams');
      for (const title of titles) await expect(exams.getByText(title)).toHaveCount(1);
      await expect(exams.getByText(/\+\d+ more/)).toHaveCount(0);
      // Eight rows do not fit a 6-row widget: the list scrolls instead of being cut off.
      const last = exams.getByText(titles.at(-1)!);
      await last.scrollIntoViewIfNeeded();
      await expect(last).toBeInViewport();
    } finally {
      for (const id of created) await apiSend(request, 'delete', `/items/manual/${id}`);
      await apiSend(request, 'put', '/widgets/exams', { type: 'exams', config: {}, hidden: true });
    }
  });

  test('settings: deleting a course and discarding edits both ask first', async ({ page, request }) => {
    await page.goto('/settings/courses');
    await page.getByRole('button', { name: 'Delete STAT410' }).click();
    const ask = page.getByRole('alertdialog').or(page.getByRole('dialog', { name: 'Delete STAT410?' }));
    await expect(ask).toBeVisible();
    await ask.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('row', { name: /STAT410/ })).toBeVisible();

    const before = (await apiGet<{ name: string | null }>(request, `/courses/${COURSE.stat410}`)).name;
    await page.getByRole('button', { name: 'Edit STAT410' }).click();
    const editor = page.getByRole('dialog', { name: 'Edit STAT410' });
    await editor.getByLabel('Name', { exact: true }).fill('Not saved');
    await page.keyboard.press('Escape');
    const discard = page.getByRole('dialog', { name: 'Discard your changes?' });
    await expect(discard).toBeVisible();
    // A destructive question starts on the safe answer, so Enter keeps the edits.
    await expect(discard.getByRole('button', { name: 'Keep editing' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(discard).toBeHidden();
    await expect(editor.getByLabel('Name', { exact: true })).toHaveValue('Not saved'); // still editing, nothing lost

    await page.keyboard.press('Escape');
    await page.getByRole('dialog', { name: 'Discard your changes?' }).getByRole('button', { name: 'Discard' }).click();
    await expect(editor).toBeHidden();
    expect((await apiGet<{ name: string | null }>(request, `/courses/${COURSE.stat410}`)).name).toBe(before);
  });

  test('settings: the jobs filters take commas as typed', async ({ page }) => {
    await page.goto('/settings/jobs');
    const cats = page.getByLabel(/^Categories/);
    await cats.fill('');
    await cats.pressSequentially('Software, AI/ML');
    await expect(cats).toHaveValue('Software, AI/ML');
  });

  test('settings: Escape goes back to the dashboard, unless a dialog or a field has it', async ({ page }) => {
    await page.goto('/settings/courses');
    await expect(page.getByRole('heading', { name: 'Courses' })).toBeVisible();

    // An open dialog takes the first Escape and settings stay.
    await page.getByRole('button', { name: 'Edit CMSC422' }).click();
    const editor = page.getByRole('dialog', { name: 'Edit CMSC422' });
    await expect(editor).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(editor).toBeHidden();
    await expect(page).toHaveURL(/\/settings\/courses$/);

    // So does a field being typed in.
    await page.goto('/settings/jobs');
    await page.getByLabel(/^Terms/).focus();
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/settings\/jobs$/);

    await page.getByRole('heading', { name: 'Jobs' }).click(); // focus off the field
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { name: /^Today,/ })).toBeVisible();
  });

  test('settings: an unknown section falls back to Sources', async ({ page }) => {
    await page.goto('/settings/nonsense');
    await expect(page).toHaveURL(/\/settings\/sources$/);
    await expect(page.getByRole('heading', { name: 'Sources' })).toBeVisible();
  });

  test('demo: the board runs on made-up data, its pane stays inside the window and links stay put', async ({ page }) => {
    await page.goto('/demo');
    // Signed in (auth is off here), the banner points back to the real board.
    await expect(page.getByRole('link', { name: 'Back to your board' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open dashboard' })).toBeVisible();

    await widget(page, 'Classes overview').getByRole('button', { name: /CS351/ }).click();
    const drawer = pane(page);
    await expect(drawer.getByText('CS351', { exact: true })).toBeVisible();
    // Non-modal and contained: the page behind still scrolls and the drawer sits within the demo window.
    const box = await drawer.boundingBox();
    expect(box && box.width).toBeLessThan(page.viewportSize()!.width);

    const link = drawer.getByRole('link').first();
    await link.click();
    await expect(page.getByText('Links are off in the demo')).toBeVisible();
    await expect(page).toHaveURL(/\/demo$/);
  });
});
