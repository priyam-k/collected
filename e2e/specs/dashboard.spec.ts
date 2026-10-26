import { expect, test } from '@playwright/test';
import { COURSE } from '../env.js';
import { apiGet, apiSend, openDashboard, pane, widget } from '../helpers.js';

const HW01 = 'canvas:assignment:7775093'; // open in the Canvas fixture: the one assignment a student can still mark done

test.describe('dashboard', () => {
  test('renders the core widgets from demo data', async ({ page }) => {
    await openDashboard(page);
    for (const title of ['Calendar', 'To do', 'Sources', 'Job feed', 'Classes overview']) await expect(widget(page, title)).toBeVisible();

    const classes = widget(page, 'Classes overview');
    for (const code of ['CMSC422', 'MATH423', 'STAT410', 'CMSC330']) await expect(classes.getByRole('button', { name: new RegExp(code) })).toBeVisible();

    // The todo widget mixes Todoist tasks (mock API, dated relative to today) with overdue Canvas / Gradescope homework.
    const todo = widget(page, 'To do');
    await expect(todo.getByText('Buy oat milk')).toBeVisible();
    await expect(todo.getByText('HW01: Warm up')).toBeVisible();

    const sources = widget(page, 'Sources');
    await expect(sources.getByRole('link', { name: 'Google Calendar' })).toBeVisible();
    await expect(sources.getByRole('link', { name: 'Todoist' })).toBeVisible();

    // The jobs feed was never synced: the frame explains instead of failing.
    await expect(widget(page, 'Job feed').getByText('Connect Job feed to use this widget')).toBeVisible();
  });

  test('opens a course pane from the classes widget and lists its assignments', async ({ page }) => {
    await openDashboard(page);
    await widget(page, 'Classes overview').getByRole('button', { name: /CMSC422/ }).click();

    const drawer = pane(page);
    await expect(drawer.getByText('CMSC422', { exact: true })).toBeVisible();
    await expect(drawer.getByText('Introduction to Machine Learning')).toBeVisible();
    await expect(drawer.getByRole('link', { name: 'Canvas ↗' })).toBeVisible();
    await expect(drawer.getByRole('link', { name: 'Piazza ↗' })).toBeVisible();

    await drawer.getByRole('button', { name: /^Assignments/ }).click();
    await expect(drawer.getByText('HW01: Warm up')).toBeVisible();
    await expect(drawer.getByText('HW02: Decision trees')).toBeVisible();
    await expect(drawer.getByText(/^To do · \d+$/)).toBeVisible();
    await expect(drawer.getByText(/^Done · \d+$/)).toBeVisible();

    await drawer.getByRole('button', { name: 'Close' }).click();
    await expect(drawer).toBeHidden();
  });

  test('marks an assignment done from its popover and sees it move to Done', async ({ page, request }) => {
    const section = (label: string) => pane(page).locator('section').filter({ has: page.getByText(new RegExp(`^${label} · \\d+$`)) });
    try {
      await openDashboard(page);
      await widget(page, 'Classes overview').getByRole('button', { name: /CMSC422/ }).click();
      await pane(page).getByRole('button', { name: /^Assignments/ }).click();
      await expect(section('To do').getByText('HW01: Warm up')).toBeVisible();

      await section('To do').getByRole('button', { name: /HW01: Warm up/ }).click();
      const popover = page.locator('[data-slot="popover-content"]');
      await expect(popover.getByText('HW01: Warm up')).toBeVisible();
      await popover.getByRole('button', { name: 'Done' }).click();
      await expect(page.getByText('Marked done')).toBeVisible();

      await expect(section('To do').getByText('HW01: Warm up')).toHaveCount(0);
      await expect(section('Done').getByText('HW01: Warm up')).toBeVisible();

      const override = await apiGet<{ id: string; effectiveDone: boolean }[]>(request, `/items?kind=assignment&course=${COURSE.cmsc422}&includeDone=1&limit=100`);
      expect(override.find((i) => i.id === HW01)?.effectiveDone).toBe(true);
    } finally {
      await apiSend(request, 'post', `/items/${HW01}/override`, { done: false });
    }
  });

  test('adds a manual date in the course dates tab', async ({ page, request }) => {
    const title = `Midterm 1 (e2e ${Date.now()})`;
    let created: string | null = null;
    try {
      await openDashboard(page);
      await widget(page, 'Classes overview').getByRole('button', { name: /CMSC422/ }).click();
      const drawer = pane(page);
      await drawer.getByRole('button', { name: /^Dates/ }).click();
      await drawer.getByRole('button', { name: 'Add date' }).click();
      await drawer.getByPlaceholder('Midterm 1').fill(title);
      await drawer.getByRole('button', { name: 'Add', exact: true }).click();
      await expect(page.getByText('Added', { exact: true })).toBeVisible();

      // Today is selected by default, so the new date is both "on this day" and upcoming.
      await expect(drawer.getByText(/^Upcoming · [1-9]\d*$/)).toBeVisible();
      await expect(drawer.getByRole('button', { name: new RegExp(title.replace(/[()]/g, '\\$&')) }).first()).toBeVisible();

      const manual = await apiGet<{ id: string; externalId: string; title: string; raw: { eventKind: string } }[]>(request, `/items?source=manual&kind=event&course=${COURSE.cmsc422}&includeDone=1&limit=100`);
      const row = manual.find((m) => m.title === title);
      expect(row?.raw.eventKind).toBe('exam');
      created = row?.externalId ?? null;
    } finally {
      if (created) await apiSend(request, 'delete', `/items/manual/${created}`);
    }
  });
});
