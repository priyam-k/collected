import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { ROOT } from '../env.js';
import { openDashboard, pane, widget } from '../helpers.js';

/*
 * Refreshes the README and landing-page screenshots in docs/screenshots (and the copy the web app serves). Skipped in
 * normal runs; `SCREENSHOTS=1 pnpm exec playwright test specs/screenshots.spec.ts` from e2e/ retakes them. The board
 * and the course pane come from the live demo's made-up semester; settings and the Files tab from the e2e fixtures.
 */
const OUT = path.join(ROOT, 'docs', 'screenshots');
const WEB_COPY = path.join(ROOT, 'web', 'public', 'docs', 'screenshots');

test.skip(!process.env.SCREENSHOTS, 'set SCREENSHOTS=1 to retake docs/screenshots');
test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('collected.theme', 'light');
    localStorage.setItem('collected.accent', 'blue');
  });
  mkdirSync(OUT, { recursive: true });
  mkdirSync(WEB_COPY, { recursive: true });
});

async function shoot(page: Page, name: string): Promise<void> {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(900); // springs, reveals and fonts settle
  await page.screenshot({ path: path.join(OUT, name) });
}

test('board and course pane, from the demo semester', async ({ page }) => {
  await page.goto('/demo?bare');
  await expect(page.locator('.react-grid-item')).toHaveCount(10);
  await expect(widget(page, 'Classes overview').getByRole('button', { name: /CS351/ })).toBeVisible();
  await shoot(page, 'dashboard.png');
  copyFileSync(path.join(OUT, 'dashboard.png'), path.join(WEB_COPY, 'dashboard.png'));

  await widget(page, 'Classes overview').getByRole('button', { name: /CS351/ }).click();
  await expect(pane(page).getByText('Algorithms', { exact: false })).toBeVisible();
  await shoot(page, 'course-pane.png');
});

test('settings and the Files tab, from the fixtures', async ({ page }) => {
  await page.goto('/settings/sources');
  await expect(page.getByRole('heading', { name: 'Sources' })).toBeVisible();
  await shoot(page, 'settings-sources.png');

  await page.goto('/settings/courses');
  await expect(page.getByRole('heading', { name: 'Courses' })).toBeVisible();
  await shoot(page, 'settings-courses.png');

  await openDashboard(page);
  await widget(page, 'Classes overview').getByRole('button', { name: /CMSC422/ }).click();
  await pane(page).getByRole('button', { name: /^Files/ }).click();
  await shoot(page, 'file-sync.png');
});
