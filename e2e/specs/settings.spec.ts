import { expect, test } from '@playwright/test';
import { COURSE } from '../env.js';
import { apiGet } from '../helpers.js';

test.describe('settings', () => {
  test('courses: renaming a course persists across a reload', async ({ page, request }) => {
    const name = `Applied Probability (e2e ${Date.now()})`;
    await page.goto('/settings/courses');
    await expect(page.getByRole('heading', { name: 'Courses' })).toBeVisible();

    await page.getByRole('row', { name: /MATH423/ }).getByRole('button', { name: 'Edit' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit MATH423' });
    await dialog.getByLabel('Name', { exact: true }).fill(name);
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(/^Saved( MATH423)?$/)).toBeVisible();
    await expect(dialog).toBeHidden();

    await page.reload();
    await expect(page.getByRole('row', { name: /MATH423/ })).toContainText(name);
    const course = await apiGet<{ name: string | null; schedule: unknown; links: unknown[] }>(request, `/courses/${COURSE.math423}`);
    expect(course.name).toBe(name);
  });

  test('sources: every integration shows its status', async ({ page }) => {
    await page.goto('/settings/sources');
    await expect(page.getByRole('heading', { name: 'Sources' })).toBeVisible();
    // Exact title match: "Google Calendar" must not also pick up "Google Calendar (iCal)".
    const card = (title: string) => page.locator('[data-slot="card"]').filter({ has: page.locator('[data-slot="card-title"]', { hasText: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) });

    // Statuses read as words for people, not the raw ids.
    await expect(card('Canvas').getByText('Not connected', { exact: true })).toBeVisible();
    await expect(card('Gradescope').getByText('Not connected', { exact: true })).toBeVisible();
    await expect(card('Google Calendar').getByText('Connected', { exact: true })).toBeVisible();
    await expect(card('Google Calendar').getByText('showing demo calendars')).toBeVisible();
    await expect(card('Todoist').getByText('Connected', { exact: true })).toBeVisible();
    await expect(card('Job feed').getByText('Not connected', { exact: true })).toBeVisible();

    // The "Data pulled" panel reads the per-course summary for a fixture-backed source.
    await card('Gradescope').getByRole('button', { name: /Data pulled/ }).click();
    await expect(card('Gradescope').getByRole('cell', { name: 'CMSC422' })).toBeVisible();
    await expect(card('Gradescope').getByRole('cell', { name: '3001002' })).toBeVisible();
  });

  test('export then import round-trips without changing anything', async ({ page, request }) => {
    type Export = { version: number; exportedAt?: string; courses: unknown[]; settings: Record<string, unknown>; widgets: unknown[]; layouts: Record<string, unknown> };
    const strip = ({ exportedAt: _at, ...rest }: Export) => rest;
    const before = strip(await apiGet<Export>(request, '/export'));

    await page.goto('/settings/data');
    await page.getByRole('button', { name: 'Generate export' }).click();
    const exported = page.locator('textarea[readonly]');
    await expect(exported).toBeVisible();
    const text = await exported.inputValue();
    const parsed = JSON.parse(text) as Export;
    expect(parsed.version).toBe(1);
    expect(strip(parsed)).toEqual(before);

    await page.getByPlaceholder('Paste an export here').fill(text);
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    // The import asks first: it overwrites settings and layouts.
    await page.getByRole('dialog', { name: 'Import this export?' }).getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.getByText(/^Imported: /)).toBeVisible();

    const after = strip(await apiGet<Export>(request, '/export'));
    expect(after).toEqual(before);
  });
});
