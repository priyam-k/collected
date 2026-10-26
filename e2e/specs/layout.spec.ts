import { expect, test } from '@playwright/test';
import { apiGet, openDashboard, widget } from '../helpers.js';

type LayoutItem = { i: string; x: number; y: number; w: number; h: number };
type Layouts = { lg?: LayoutItem[]; md?: LayoutItem[]; sm?: LayoutItem[] };
type Widget = { id: string; type: string; hidden: boolean };

test.describe('layout', () => {
  test('adds a widget from the tray, keeps it across a reload, then hides it', async ({ page, request }) => {
    await openDashboard(page);
    await expect(widget(page, 'Clock')).toHaveCount(0);

    await page.getByRole('button', { name: 'Edit layout' }).click();
    await page.getByRole('button', { name: 'Add widget' }).click();
    const tray = page.getByRole('dialog', { name: 'Add a widget' });
    await tray.getByRole('listitem').filter({ hasText: 'Clock' }).getByRole('button', { name: /^Small/ }).click();
    await expect(page.getByText('Widget added')).toBeVisible();
    await expect(tray).toBeHidden();
    await expect(widget(page, 'Clock')).toBeVisible();
    await page.getByRole('button', { name: 'Done' }).click();

    await page.reload();
    await openDashboard(page);
    await expect(widget(page, 'Clock')).toBeVisible();
    const widgets = await apiGet<Widget[]>(request, '/widgets');
    expect(widgets.find((w) => w.id === 'clock')?.hidden).toBe(false);
    const layouts = await apiGet<Layouts>(request, '/layout');
    expect(layouts.lg?.find((l) => l.i === 'clock')).toMatchObject({ w: 2, h: 3 });

    await page.getByRole('button', { name: 'Edit layout' }).click();
    await widget(page, 'Clock').getByRole('button', { name: /^(Hide widget|Remove Clock from the dashboard)$/ }).click(); // eye icon, or the × corner control on the design branch
    await expect(widget(page, 'Clock')).toHaveCount(0);
    await page.getByRole('button', { name: 'Done' }).click();

    await page.reload();
    await openDashboard(page);
    await expect(widget(page, 'Clock')).toHaveCount(0);
    expect((await apiGet<Widget[]>(request, '/widgets')).find((w) => w.id === 'clock')?.hidden).toBe(true);
    expect((await apiGet<Layouts>(request, '/layout')).lg?.some((l) => l.i === 'clock')).toBe(false);
  });

  test('dragging a widget persists its new position', async ({ page, request }) => {
    await openDashboard(page);
    // Nothing is stored until the first edit; until then the classes widget sits at the default slot (x 9, y 14).
    const stored = (await apiGet<Layouts>(request, '/layout')).lg?.find((l) => l.i === 'classes');
    const before = { x: stored?.x ?? 9, y: stored?.y ?? 14 };
    const frame = widget(page, 'Classes overview');
    await frame.scrollIntoViewIfNeeded();
    const boxBefore = (await frame.boundingBox())!;

    await page.getByRole('button', { name: 'Edit layout' }).click();
    const handle = frame.locator('.widget-drag-handle');
    await handle.scrollIntoViewIfNeeded();
    const box = (await handle.boundingBox())!;
    // Drag the title bar up and to the left, over the calendar: the widget takes that slot and the rest reflow.
    await page.mouse.move(box.x + 40, box.y + box.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + 40 - i * 60, box.y + box.height / 2 - i * 60);
    await page.mouse.up();
    await page.getByRole('button', { name: 'Done' }).click();

    await expect.poll(async () => {
      const l = (await apiGet<Layouts>(request, '/layout')).lg?.find((x) => x.i === 'classes');
      return l ? { x: l.x, y: l.y } : null;
    }).not.toEqual(before);
    const saved = (await apiGet<Layouts>(request, '/layout')).lg?.find((l) => l.i === 'classes');

    await page.reload();
    await openDashboard(page);
    await expect(widget(page, 'Classes overview')).toBeVisible();
    const boxAfter = (await widget(page, 'Classes overview').boundingBox())!;
    expect(boxAfter.x !== boxBefore.x || boxAfter.y !== boxBefore.y).toBe(true);
    expect((await apiGet<Layouts>(request, '/layout')).lg?.find((l) => l.i === 'classes')).toEqual(saved);
  });
});
