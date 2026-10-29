import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { items } from '../../db/schema.js';
import { testContext } from '../../test-util.js';
import fixture from './fixtures/tasks.json' with { type: 'json' };
import { splitExternalId } from './api.js';
import { GTasksHttpApi } from './client.js';
import { gtaskDueToIso, syncGtasks } from './ingest.js';
import { MockGTasksApi } from './mock-api.js';
import { NeedsAuthError } from '../types.js';

const NOW = new Date('2026-10-28T12:00:00Z');
const MY = 'MDE2NTk0Njg2';
const GROCERY = 'Z3JvY2VyeQ';

describe('google tasks mapping', () => {
  it('turns the date-only due into an all-day end-of-day due', () => {
    expect(gtaskDueToIso('2026-10-30T00:00:00.000Z')).toEqual({ dueAt: new Date('2026-10-30T23:59:00').toISOString(), allDay: true });
    expect(gtaskDueToIso(null)).toEqual({ dueAt: null, allDay: false });
    expect(gtaskDueToIso('garbage')).toEqual({ dueAt: null, allDay: false });
  });

  it('splits external ids and refuses anything that is not an id', () => {
    expect(splitExternalId(`${MY}:dGFzazE`)).toEqual({ listId: MY, taskId: 'dGFzazE' });
    expect(splitExternalId('nocolon')).toBeNull();
    expect(splitExternalId(`${MY}:../../x`)).toBeNull();
  });
});

describe('google tasks sync', () => {
  it('maps every list, keeps recent completions, drops deleted and old completed tasks', async () => {
    const ctx = await testContext();
    const api = new MockGTasksApi(fixture);
    const { counts, lists } = await syncGtasks(ctx, api, NOW);
    expect(lists.map((l) => l.title)).toEqual(['My Tasks', 'Grocery']);
    expect(counts).toMatchObject({ lists: 2, tasks: 5, open: 4, completed: 1, created: 5, failedLists: 0 });
    const row = await ctx.db.query.items.findFirst({ where: eq(items.id, `gtasks:${MY}:dGFzazE`) });
    expect(row).toMatchObject({ source: 'gtasks', externalId: `${MY}:dGFzazE`, kind: 'task', title: 'Email advisor about spring schedule', description: 'ask about CMSC434', allDay: true, status: 'open', labels: ['my tasks'] });
    expect((row!.raw as { projectName: string }).projectName).toBe('My Tasks');
    const sub = await ctx.db.query.items.findFirst({ where: eq(items.id, `gtasks:${MY}:c3ViMQ`) });
    expect((sub!.raw as { parentId: string }).parentId).toBe('dGFzazI');
    const done = await ctx.db.query.items.findFirst({ where: eq(items.id, `gtasks:${MY}:ZG9uZTE`) });
    expect(done!.status).toBe('done');
    expect(await ctx.db.query.items.findFirst({ where: eq(items.id, `gtasks:${MY}:ZGVsZXRlZA`) })).toBeUndefined();
  });

  it('soft-deletes what a successful list fetch no longer has, never on a failed or empty list', async () => {
    const ctx = await testContext();
    const api = new MockGTasksApi(fixture);
    await syncGtasks(ctx, api, NOW);

    // A task disappears from My Tasks; Grocery fails to load: only the My Tasks row goes.
    api.tasks[MY] = api.tasks[MY]!.filter((t) => t.id !== 'dGFzazE');
    api.fail.add(GROCERY);
    const r2 = await syncGtasks(ctx, api, NOW);
    expect(r2.counts).toMatchObject({ deleted: 1, failedLists: 1 });
    expect((await ctx.db.query.items.findFirst({ where: eq(items.id, `gtasks:${MY}:dGFzazE`) }))!.deletedAt).toBeTruthy();
    expect((await ctx.db.query.items.findFirst({ where: eq(items.id, `gtasks:${GROCERY}:bWlsaw`) }))!.deletedAt).toBeNull();

    // An empty answer for a list keeps its rows.
    api.fail.clear();
    api.tasks[GROCERY] = [];
    const r3 = await syncGtasks(ctx, api, NOW);
    expect(r3.counts.deleted).toBe(0);
    expect((await ctx.db.query.items.findFirst({ where: eq(items.id, `gtasks:${GROCERY}:bWlsaw`) }))!.deletedAt).toBeNull();

    // Every list failing is an error for the run, not a success with nothing in it.
    api.fail.add(MY).add(GROCERY);
    await expect(syncGtasks(ctx, api, NOW)).rejects.toThrow(/failed/);
  });

  it('retires rows of a list that is gone from a non-empty list answer', async () => {
    const ctx = await testContext();
    const api = new MockGTasksApi(fixture);
    await syncGtasks(ctx, api, NOW);
    api.lists = api.lists.filter((l) => l.id !== GROCERY);
    const r = await syncGtasks(ctx, api, NOW);
    expect(r.counts.retired).toBe(1);
    expect((await ctx.db.query.items.findFirst({ where: eq(items.id, `gtasks:${GROCERY}:bWlsaw`) }))!.deletedAt).toBeTruthy();
  });
});

describe('google tasks http client', () => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('paginates with nextPageToken, asks for completed and hidden tasks, and stops at the cap', async () => {
    const urls: URL[] = [];
    let n = 0;
    const fetchImpl = (async (url: URL) => {
      urls.push(new URL(url));
      n++;
      return json({ items: Array.from({ length: 100 }, (_, i) => ({ id: `t${n}_${i}`, title: 'x' })), nextPageToken: `p${n}` });
    }) as unknown as typeof fetch;
    const api = new GTasksHttpApi(async () => 'tok', fetchImpl);
    const r = await api.listTasks('L1');
    expect(r.truncated).toBe(true);
    expect(r.tasks).toHaveLength(500);
    expect(urls).toHaveLength(5);
    expect(urls[0]!.origin + urls[0]!.pathname).toBe('https://tasks.googleapis.com/tasks/v1/lists/L1/tasks');
    expect(urls[0]!.searchParams.get('showCompleted')).toBe('true');
    expect(urls[0]!.searchParams.get('showHidden')).toBe('true');
    expect(urls[1]!.searchParams.get('pageToken')).toBe('p1');
  });

  it('maps 401 to NeedsAuthError and keeps other errors as errors', async () => {
    const api401 = new GTasksHttpApi(async () => 'tok', (async () => json({ error: { message: 'bad' } }, 401)) as unknown as typeof fetch);
    await expect(api401.listTaskLists()).rejects.toBeInstanceOf(NeedsAuthError);
    const api403 = new GTasksHttpApi(async () => 'tok', (async () => json({ error: { message: 'Google Tasks API has not been used in project 1 before or it is disabled.' } }, 403)) as unknown as typeof fetch);
    await expect(api403.listTaskLists()).rejects.toThrow(/has not been used/);
  });
});
