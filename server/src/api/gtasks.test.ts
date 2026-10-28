import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { items } from '../db/schema.js';
import fixture from '../ingest/gtasks/fixtures/tasks.json' with { type: 'json' };
import { syncGtasks } from '../ingest/gtasks/ingest.js';
import { MockGTasksApi } from '../ingest/gtasks/mock-api.js';
import { mergeSourceMeta } from '../lib/sources.js';
import { testContext } from '../test-util.js';
import { googleRoutes } from './google.js';
import { gtasksRoutes } from './gtasks.js';

const post = (app: Hono, path: string, body?: unknown) =>
  app.request(path, { method: 'POST', headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

describe('google tasks routes', () => {
  it('quick-adds to the default list and closes per item', async () => {
    const ctx = await testContext();
    const api = new MockGTasksApi(fixture);
    await syncGtasks(ctx, api, new Date('2026-10-28T12:00:00Z'));
    await mergeSourceMeta(ctx, 'gtasks', { lists: fixture.lists.map((l) => ({ id: l.id, title: l.title })), defaultListId: fixture.lists[0]!.id });
    const app = new Hono().route('/gtasks', gtasksRoutes(ctx, async () => api));

    const res = await post(app, '/gtasks/tasks/quick', { content: 'Buy stamps', due: '2026-11-02' });
    expect(res.status).toBe(201);
    const row = (await res.json()) as { id: string; externalId: string; dueAt: string; allDay: boolean };
    expect(row.id).toMatch(/^gtasks:MDE2NTk0Njg2:new\d+$/);
    expect(row.allDay).toBe(true);
    expect(api.ops).toEqual(['insertTask MDE2NTk0Njg2 Buy stamps']);
    expect(api.tasks.MDE2NTk0Njg2!.at(-1)!.due).toBe('2026-11-02T00:00:00.000Z');
    expect(await ctx.db.query.items.findFirst({ where: eq(items.id, row.id) })).toMatchObject({ source: 'gtasks', status: 'open', title: 'Buy stamps' });

    const closed = await post(app, `/gtasks/tasks/${encodeURIComponent(row.externalId)}/close`);
    expect(closed.status).toBe(200);
    expect((await ctx.db.query.items.findFirst({ where: eq(items.id, row.id) }))!.status).toBe('done');
    expect(api.ops.at(-1)).toMatch(/^completeTask MDE2NTk0Njg2 new\d+$/);
  });

  it('refuses bad bodies and bad ids', async () => {
    const ctx = await testContext();
    const api = new MockGTasksApi(fixture);
    const app = new Hono().route('/gtasks', gtasksRoutes(ctx, async () => api));
    expect((await post(app, '/gtasks/tasks/quick', { content: '' })).status).toBe(422);
    expect((await post(app, '/gtasks/tasks/quick', { content: 'x'.repeat(501) })).status).toBe(422);
    expect((await post(app, '/gtasks/tasks/quick', { content: 'ok', due: 'friday' })).status).toBe(422);
    expect((await post(app, '/gtasks/tasks/no-colon/close')).status).toBe(422);
    expect(api.ops).toEqual([]);
  });
});

describe('google connect', () => {
  it('asks for the tasks scope only on the Tasks connect, incrementally, and leaves the Calendar consent as it was', async () => {
    const ctx = await testContext();
    ctx.env.GOOGLE_CLIENT_ID = 'client';
    ctx.env.GOOGLE_CLIENT_SECRET = 'secret';
    const app = new Hono().route('/google', googleRoutes(ctx));
    const scopes = async (path: string) => {
      const u = new URL((await app.request(path)).headers.get('location')!);
      return { scope: u.searchParams.get('scope')!.split(' '), incremental: u.searchParams.get('include_granted_scopes') };
    };
    const tasks = await scopes('/google/start?source=gtasks');
    expect(tasks).toEqual({ scope: ['https://www.googleapis.com/auth/tasks'], incremental: 'true' });
    const cal = await scopes('/google/start');
    expect(cal.scope).toEqual(['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.readonly']);
  });
});
