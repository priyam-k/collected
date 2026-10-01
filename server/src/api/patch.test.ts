import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { courses, widgetInstances } from '../db/schema.js';
import { setSetting } from '../lib/settings.js';
import { testContext } from '../test-util.js';
import { coursesRoutes } from './courses.js';
import { widgetRoutes } from './layout.js';
import { todoistRoutes } from './todoist.js';

/* Partial updates must change only what was sent. Regression for the 2026-10-01 schedule wipe (DECISIONS 041). */

const put = (app: Hono, path: string, body: unknown) => app.request(path, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('partial updates never reset omitted fields', () => {
  it('PUT /courses/:id with one field leaves schedule, links, role and submitsVia alone', async () => {
    const ctx = await testContext();
    const schedule = { lecture: [{ day: 'mon' as const, start: '14:00', end: '14:50', location: 'CHE 2110' }], lab: [{ day: 'fri' as const, start: '08:00', end: '10:00' }] };
    const links = [{ label: 'Website', url: 'https://enme480.github.io/' }];
    await ctx.db.insert(courses).values({ id: 'c1', term: '2026-fall', code: 'ENME480', role: 'ta', submitsVia: 'gradescope', archived: true, schedule, links, notes: 'n' });
    const app = new Hono().route('/courses', coursesRoutes(ctx));

    for (const body of [{ fileSync: null }, { notes: 'changed' }, { grading: null }, {}]) {
      const res = await put(app, '/courses/c1', body);
      expect(res.status).toBe(200);
    }
    const row = (await ctx.db.query.courses.findFirst({ where: eq(courses.id, 'c1') }))!;
    expect(row).toMatchObject({ schedule, links, role: 'ta', submitsVia: 'gradescope', archived: true, notes: 'changed' });

    // Sending a field, even an empty one, does change it.
    await put(app, '/courses/c1', { links: [], schedule: {} });
    expect(await ctx.db.query.courses.findFirst({ where: eq(courses.id, 'c1') })).toMatchObject({ links: [], schedule: {}, role: 'ta' });
    expect((await put(app, '/courses/c1', { role: 'boss' })).status).toBe(422);
  });

  it('PUT /widgets/:id hiding a widget keeps its config', async () => {
    const ctx = await testContext();
    await ctx.db.insert(widgetInstances).values({ id: 'class:c1', type: 'class', config: { courseId: 'c1' }, hidden: false }).onConflictDoUpdate({ target: widgetInstances.id, set: { config: { courseId: 'c1' }, hidden: false } });
    const app = new Hono().route('/widgets', widgetRoutes(ctx));
    expect((await put(app, '/widgets/class:c1', { hidden: true })).status).toBe(200);
    expect(await ctx.db.query.widgetInstances.findFirst({ where: eq(widgetInstances.id, 'class:c1') })).toMatchObject({ hidden: true, type: 'class', config: { courseId: 'c1' } });
    expect((await put(app, '/widgets/new-one', { hidden: true })).status).toBe(422); // creating still needs a type
  });

  it('PUT /todoist/config flipping one flag keeps the project and labels', async () => {
    const ctx = await testContext();
    await setSetting(ctx, 'todoist.push', { enabled: false, projectId: 'p123', projectName: 'Classes', commonLabel: 'hw', courseLabels: false });
    const app = new Hono().route('/todoist', todoistRoutes(ctx));
    const res = await put(app, '/todoist/config', { enabled: true });
    expect(await res.json()).toEqual({ enabled: true, projectId: 'p123', projectName: 'Classes', commonLabel: 'hw', courseLabels: false });
  });
});
