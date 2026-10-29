import { describe, expect, it } from 'vitest';
import { courses, items } from '../db/schema.js';
import { testContext } from '../test-util.js';
import { clearDemoData, loadDemo } from './demo.js';

describe('loadDemo', () => {
  it('on an empty database, canvas imports the fixture enrollments first, then loads assignments into them', async () => {
    const ctx = await testContext();
    const r = await loadDemo(ctx, 'canvas');
    expect(r.coursesCreated.length).toBeGreaterThanOrEqual(3);
    const rows = await ctx.db.select().from(courses);
    expect(rows.map((c) => c.code).sort()).toEqual(expect.arrayContaining(['CMSC422', 'CMSC330', 'MATH423']));
    expect(rows.some((c) => c.term === 'default-term')).toBe(false); // the advising shell is left out
    expect(r.counts.matchedCourses).toBeGreaterThanOrEqual(3);
    const loaded = await ctx.db.select().from(items);
    expect(loaded.some((i) => i.id === 'canvas:assignment:7775093')).toBe(true);
    expect(r.tagged).toBeGreaterThan(0);

    // A second load creates nothing more.
    expect((await loadDemo(ctx, 'canvas')).coursesCreated).toEqual([]);
    const cleared = await clearDemoData(ctx);
    expect(cleared.items).toBeGreaterThan(0);
  });

  it('todoist and gtasks load through their mock APIs and mark the source connected', async () => {
    const ctx = await testContext();
    await loadDemo(ctx, 'todoist');
    await loadDemo(ctx, 'gtasks');
    const loaded = await ctx.db.select().from(items);
    expect(loaded.some((i) => i.id === 'todoist:d1')).toBe(true);
    expect(loaded.some((i) => i.source === 'gtasks')).toBe(true);
  });
});
