import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { courses, gtasksMap, items, overrides } from '@collected/core/db/schema';
import fixture from '@collected/core/ingest/gtasks/fixtures/tasks.json' with { type: 'json' };
import { syncGtasks } from '@collected/core/ingest/gtasks/ingest';
import { MockGTasksApi } from '@collected/core/ingest/gtasks/mock-api';
import { mergeSourceMeta } from '@collected/core/lib/sources';
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

  it('sends a PKCE S256 challenge with each start, a fresh one per flow, and the redirect URI from PUBLIC_URL', async () => {
    const ctx = await testContext();
    ctx.env.GOOGLE_CLIENT_ID = 'client';
    ctx.env.GOOGLE_CLIENT_SECRET = 'secret';
    ctx.env.PUBLIC_URL = 'http://127.0.0.1:50123';
    const app = new Hono().route('/google', googleRoutes(ctx));
    const start = async (path: string) => new URL((await app.request(path)).headers.get('location')!);
    const a = await start('/google/start');
    const b = await start('/google/start?source=gtasks');
    for (const u of [a, b]) {
      expect(u.searchParams.get('code_challenge_method')).toBe('S256');
      expect(u.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(u.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:50123/api/google/callback');
    }
    expect(a.searchParams.get('code_challenge')).not.toBe(b.searchParams.get('code_challenge'));
    expect(a.searchParams.get('state')).not.toBe(b.searchParams.get('state'));
  });

  it('tells the result hook how a callback ended, and redirects with the same reason', async () => {
    const ctx = await testContext();
    ctx.env.GOOGLE_CLIENT_ID = 'client';
    ctx.env.GOOGLE_CLIENT_SECRET = 'secret';
    const results: unknown[] = [];
    const app = new Hono().route('/google', googleRoutes(ctx, { onResult: (r) => results.push(r) }));
    const state = new URL((await app.request('/google/start?source=gtasks')).headers.get('location')!).searchParams.get('state')!;
    const denied = await app.request(`/google/callback?state=${state}&error=access_denied`);
    expect(denied.headers.get('location')).toBe('http://localhost:5173/settings/sources?google=error&reason=denied&source=gtasks');
    // An unknown or spent state is `expired`; its target is unknown so it reads as Calendar.
    const stale = await app.request(`/google/callback?state=${state}&code=x`);
    expect(stale.headers.get('location')).toBe('http://localhost:5173/settings/sources?google=error&reason=expired');
    expect(results).toEqual([
      { target: 'gtasks', ok: false, reason: 'denied' },
      { target: 'gcal', ok: false, reason: 'expired' },
    ]);
  });

  it('answers unconfigured when there is no Google client, without touching the hook', async () => {
    const ctx = await testContext();
    const results: unknown[] = [];
    const app = new Hono().route('/google', googleRoutes(ctx, { onResult: (r) => results.push(r) }));
    expect((await app.request('/google/start')).headers.get('location')).toBe('http://localhost:5173/settings/sources?google=unconfigured');
    expect(results).toEqual([]);
  });
});

describe('google tasks push routes', () => {
  const put = (app: Hono, path: string, body: unknown) => app.request(path, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  it('previews with dryRun, refuses to run while disabled, runs with force or once enabled, and patches the config', async () => {
    const ctx = await testContext();
    await ctx.db.insert(courses).values({ id: 'c422', term: '2026-fall', code: 'CMSC422', role: 'student', submitsVia: 'both' });
    await ctx.db.insert(items).values({ id: 'canvas:assignment:1', source: 'canvas', externalId: 'assignment:1', kind: 'assignment', courseId: 'c422', title: 'HW01', dueAt: new Date(Date.now() + 2 * 86_400_000).toISOString(), status: 'open' });
    const api = new MockGTasksApi(fixture);
    const app = new Hono().route('/gtasks', gtasksRoutes(ctx, async () => api));

    expect(await (await app.request('/gtasks/config')).json()).toEqual({ enabled: false, listName: 'School', titlePrefix: 'course' });

    const preview = await post(app, '/gtasks/push?dryRun=1');
    expect(preview.status).toBe(200);
    const { plan } = (await preview.json()) as { plan: { ops: { op: string; title: string }[]; listId: string | null } };
    expect(plan.ops).toEqual([{ op: 'create', itemId: 'canvas:assignment:1', title: 'HW01', reason: 'new assignment', body: expect.any(Object) }]);
    expect(api.ops).toEqual([]);

    expect((await post(app, '/gtasks/push')).status).toBe(409);
    expect(api.ops).toEqual([]);

    const forced = await post(app, '/gtasks/push?force=1');
    expect(forced.status).toBe(200);
    const result = (await forced.json()) as { done: Record<string, number>; listId: string };
    expect(result.done.create).toBe(1);
    expect(api.lists.map((l) => l.title)).toContain('School');
    expect(api.tasks[result.listId]!.map((t) => t.title)).toEqual(['[CMSC422] HW01']);
    // The post-push sync stored the mirror as a hidden item.
    const mirror = await ctx.db.query.items.findFirst({ where: eq(items.id, `gtasks:${result.listId}:${api.tasks[result.listId]![0]!.id}`) });
    expect(mirror?.raw).toMatchObject({ mirror: true, mirrorOf: 'canvas:assignment:1' });

    const patched = await put(app, '/gtasks/config', { enabled: true, listName: 'Classes' });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toEqual({ enabled: true, listName: 'Classes', titlePrefix: 'course' });
    expect((await put(app, '/gtasks/config', { listName: '' })).status).toBe(422);
    expect((await put(app, '/gtasks/config', { titlePrefix: 'emoji' })).status).toBe(422);
    expect(await (await app.request('/gtasks/config')).json()).toEqual({ enabled: true, listName: 'Classes', titlePrefix: 'course' });
  });

  it('closing a pushed mirror from the widget marks the assignment done through an override', async () => {
    const ctx = await testContext();
    await ctx.db.insert(courses).values({ id: 'c422', term: '2026-fall', code: 'CMSC422', role: 'student', submitsVia: 'both' });
    await ctx.db.insert(items).values({ id: 'canvas:assignment:1', source: 'canvas', externalId: 'assignment:1', kind: 'assignment', courseId: 'c422', title: 'HW01', dueAt: new Date(Date.now() + 2 * 86_400_000).toISOString(), status: 'open' });
    const api = new MockGTasksApi(fixture);
    const app = new Hono().route('/gtasks', gtasksRoutes(ctx, async () => api));
    const result = (await (await post(app, '/gtasks/push?force=1')).json()) as { listId: string };
    const task = api.tasks[result.listId]![0]!;
    expect((await post(app, `/gtasks/tasks/${encodeURIComponent(`${result.listId}:${task.id}`)}/close`)).status).toBe(200);
    expect(await ctx.db.query.overrides.findFirst({ where: eq(overrides.itemId, 'canvas:assignment:1') })).toMatchObject({ done: true });
    expect((await ctx.db.query.gtasksMap.findFirst({ where: eq(gtasksMap.itemId, 'canvas:assignment:1') }))?.closedByUs).toBe(true);
  });
});
