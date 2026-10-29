import { describe, expect, it } from 'vitest';
import { todoistPushConfigSchema } from '@collected/shared';
import { courses, items, todoistMap } from '../db/schema.js';
import { MockTodoistApi } from '../ingest/todoist/mock-api.js';
import { setSourceStatus } from '../lib/sources.js';
import { testContext } from '../test-util.js';
import { executePush, markerIn, planPush } from './todoist-push.js';

const cfg = todoistPushConfigSchema.parse({ projectName: 'School', commonLabel: 'homework', courseLabels: true });
const BASE = Date.now();
const due = (d: number) => new Date(BASE + d * 86_400_000).toISOString();

async function setup() {
  const ctx = await testContext();
  await ctx.db.insert(courses).values([
    { id: 'c422', term: '2026-fall', code: 'CMSC422', role: 'student', submitsVia: 'both' },
    { id: 'c330', term: '2026-fall', code: 'CMSC330', role: 'ta', submitsVia: 'gradescope' },
  ]);
  await ctx.db.insert(items).values([
    { id: 'canvas:assignment:1', source: 'canvas', externalId: 'assignment:1', kind: 'assignment', courseId: 'c422', title: 'HW01: Warm up', dueAt: due(2), status: 'open', url: 'https://umd.instructure.com/a/1' },
    { id: 'canvas:assignment:2', source: 'canvas', externalId: 'assignment:2', kind: 'assignment', courseId: 'c422', title: 'HW02: Trees', dueAt: due(9), status: 'open' },
    { id: 'canvas:assignment:3', source: 'canvas', externalId: 'assignment:3', kind: 'assignment', courseId: 'c422', title: 'Already graded', dueAt: due(-3), status: 'graded' },
    { id: 'gradescope:assignment:9', source: 'gradescope', externalId: 'assignment:9', kind: 'assignment', courseId: 'c330', title: 'P1 (TA)', dueAt: due(5), status: 'open', raw: { ta: true } },
  ]);
  return ctx;
}

describe('todoist push', () => {
  it('creates tasks for open assignments only, with labels, due, and marker; second run is a no-op', async () => {
    const ctx = await setup();
    const api = new MockTodoistApi();
    const plan = await planPush(ctx, api, cfg);
    expect(plan.ops.map((o) => [o.op, o.title])).toEqual([
      ['create', 'HW01: Warm up'],
      ['create', 'HW02: Trees'],
    ]);
    expect(plan.skipped.map((s) => s.reason)).toContain('already done; not creating');
    const res = await executePush(ctx, api, plan, cfg);
    expect(res.done).toEqual({ create: 2, update: 0, close: 0, delete: 0 });
    expect(api.projects.map((p) => p.name)).toContain('School');
    const t = api.tasks.find((x) => x.content === 'HW01: Warm up')!;
    expect(t.labels).toEqual(['homework', 'cmsc422']);
    expect(t.due?.datetime).toBe(due(2));
    expect(markerIn(t.description)).toBe('canvas:assignment:1');
    expect(t.description).toContain('https://umd.instructure.com/a/1');

    const again = await planPush(ctx, api, cfg);
    expect(again.ops).toEqual([]);
  });

  it('closes when the source is done, never reopens, and leaves hand-closed tasks alone', async () => {
    const ctx = await setup();
    const api = new MockTodoistApi();
    await executePush(ctx, api, await planPush(ctx, api, cfg), cfg);
    const hw1 = api.tasks.find((x) => x.content === 'HW01: Warm up')!;
    const hw2 = api.tasks.find((x) => x.content === 'HW02: Trees')!;

    // user closes HW02 by hand in Todoist
    await api.closeTask(hw2.id);
    // source marks HW01 submitted
    await ctx.db.update(items).set({ status: 'submitted' }).where((await import('drizzle-orm')).eq(items.id, 'canvas:assignment:1'));

    const plan = await planPush(ctx, api, cfg);
    expect(plan.ops.map((o) => [o.op, o.taskId])).toEqual([['close', hw1.id]]);
    await executePush(ctx, api, plan, cfg);
    const map = await ctx.db.select().from(todoistMap);
    expect(map.find((m) => m.itemId === 'canvas:assignment:1')?.closedByUs).toBe(true);

    // source flips back to open (e.g. resubmission window) → no reopen
    await ctx.db.update(items).set({ status: 'open' }).where((await import('drizzle-orm')).eq(items.id, 'canvas:assignment:1'));
    const plan2 = await planPush(ctx, api, cfg);
    expect(plan2.ops).toEqual([]);
    expect(plan2.skipped.filter((s) => s.reason === 'task already closed').length).toBe(2);
  });

  it('updates title/due when the source changes and deletes open tasks for removed assignments', async () => {
    const ctx = await setup();
    const api = new MockTodoistApi();
    await executePush(ctx, api, await planPush(ctx, api, cfg), cfg);
    const { eq } = await import('drizzle-orm');
    await setSourceStatus(ctx, 'canvas', 'connected');
    await ctx.db.update(items).set({ title: 'HW01: Warm up (extended)', dueAt: due(4) }).where(eq(items.id, 'canvas:assignment:1'));
    await ctx.db.update(items).set({ deletedAt: new Date().toISOString() }).where(eq(items.id, 'canvas:assignment:2'));
    const plan = await planPush(ctx, api, cfg);
    expect(plan.ops.map((o) => [o.op, o.title]).sort()).toEqual([
      ['delete', 'HW02: Trees'],
      ['update', 'HW01: Warm up (extended)'],
    ]);
    const res = await executePush(ctx, api, plan, cfg);
    expect(res.done.update).toBe(1);
    expect(res.done.delete).toBe(1);
    expect(api.tasks.map((t) => t.content)).toEqual(['HW01: Warm up (extended)']);
    expect(api.tasks[0]!.due?.datetime).toBe(due(4));
  });

  it('never deletes while the source is not connected, and refuses a mass removal', async () => {
    const ctx = await setup();
    const api = new MockTodoistApi();
    await executePush(ctx, api, await planPush(ctx, api, cfg), cfg);
    const { eq } = await import('drizzle-orm');
    const gone = new Date().toISOString();
    await ctx.db.update(items).set({ deletedAt: gone }).where(eq(items.id, 'canvas:assignment:2'));

    // A failed or timed-out Canvas run leaves the source in `error`: the removal is not believed.
    await setSourceStatus(ctx, 'canvas', 'error', { lastError: 'run exceeded 240 s' });
    const held = await planPush(ctx, api, cfg);
    expect(held.ops.filter((o) => o.op === 'delete')).toEqual([]);
    expect(held.skipped.some((s) => s.reason.includes('not connected'))).toBe(true);
    expect(api.tasks.map((t) => t.content).sort()).toEqual(['HW01: Warm up', 'HW02: Trees']);

    // Connected, but every mapped assignment vanished at once: the fuse trips.
    await setSourceStatus(ctx, 'canvas', 'connected');
    await ctx.db.update(items).set({ deletedAt: gone }).where(eq(items.id, 'canvas:assignment:1'));
    const fused = await planPush(ctx, api, cfg);
    expect(fused.ops.filter((o) => o.op === 'delete')).toEqual([]);
    expect(fused.skipped.filter((s) => s.reason.includes('vanished at once')).length).toBe(2);
  });

  it('reads the marker only from its own line, not from a URL that contains one', () => {
    expect(markerIn('https://x.test/a?x=collected:canvas:assignment:777\nCMSC422\n\ncollected:canvas:assignment:5')).toBe('canvas:assignment:5');
    expect(markerIn('https://x.test/a?x=collected:canvas:assignment:777')).toBeNull();
    expect(markerIn('  collected:gradescope:assignment:9  ')).toBe('gradescope:assignment:9');
  });

  it('rebuilds the mapping from markers when the map table is empty', async () => {
    const ctx = await setup();
    const api = new MockTodoistApi();
    await executePush(ctx, api, await planPush(ctx, api, cfg), cfg);
    await ctx.db.delete(todoistMap);
    const plan = await planPush(ctx, api, cfg);
    expect(plan.rebuilt).toBe(2);
    expect(plan.ops).toEqual([]); // nothing duplicated
  });
});
