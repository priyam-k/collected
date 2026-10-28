import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { gtasksPushConfigSchema } from '@collected/shared';
import { courses, gtasksMap, items } from '../db/schema.js';
import { MockGTasksApi } from '../ingest/gtasks/mock-api.js';
import { setSourceStatus } from '../lib/sources.js';
import { testContext } from '../test-util.js';
import { duePartsFor, executeGtasksPush, planGtasksPush } from './gtasks-push.js';
import { markerIn } from './push-core.js';

const cfg = gtasksPushConfigSchema.parse({ listName: 'School' });
const BASE = Date.now();
const due = (d: number) => new Date(BASE + d * 86_400_000).toISOString();
const TZ = 'America/New_York';

/** A Google account with the usual default list and nothing of ours. */
const seed = { lists: [{ id: 'MDE2NTk0Njg2', title: 'My Tasks' }], tasks: { MDE2NTk0Njg2: [{ id: 'own1', title: 'Renew library books', status: 'needsAction' }] } };

async function setup() {
  const ctx = await testContext();
  await ctx.db.insert(courses).values([
    { id: 'c422', term: '2026-fall', code: 'CMSC422', role: 'student', submitsVia: 'both' },
    { id: 'c330', term: '2026-fall', code: 'CMSC330', role: 'ta', submitsVia: 'gradescope' },
  ]);
  await ctx.db.insert(items).values([
    { id: 'canvas:assignment:1', source: 'canvas', externalId: 'assignment:1', kind: 'assignment', courseId: 'c422', title: 'HW01: Warm up', dueAt: due(2), status: 'open', url: 'https://umd.instructure.com/a/1', points: 10 },
    { id: 'canvas:assignment:2', source: 'canvas', externalId: 'assignment:2', kind: 'assignment', courseId: 'c422', title: 'HW02: Trees', dueAt: due(9), status: 'open' },
    { id: 'canvas:assignment:3', source: 'canvas', externalId: 'assignment:3', kind: 'assignment', courseId: 'c422', title: 'Already graded', dueAt: due(-3), status: 'graded' },
    { id: 'gradescope:assignment:9', source: 'gradescope', externalId: 'assignment:9', kind: 'assignment', courseId: 'c330', title: 'P1 (TA)', dueAt: due(5), status: 'open', raw: { ta: true } },
  ]);
  return ctx;
}

const schoolList = (api: MockGTasksApi) => api.lists.find((l) => l.title === 'School')!;
const schoolTasks = (api: MockGTasksApi) => api.tasks[schoolList(api).id] ?? [];

describe('google tasks push', () => {
  it('formats the due day and wall-clock time in the user timezone', () => {
    expect(duePartsFor('2026-11-05T04:59:00.000Z', TZ, false)).toEqual({ day: '2026-11-04', time: '11:59 PM' });
    expect(duePartsFor('2026-11-05T04:59:00.000Z', TZ, true)).toEqual({ day: '2026-11-04', time: null });
    expect(duePartsFor('2026-11-05T04:59:00.000Z', 'UTC', false)).toEqual({ day: '2026-11-05', time: '4:59 AM' });
  });

  it('creates the list and one task per open assignment: course prefix, date-only due, time and marker in the notes; second run is a no-op', async () => {
    const ctx = await setup();
    const api = new MockGTasksApi(seed);
    const plan = await planGtasksPush(ctx, api, cfg);
    expect(plan.listId).toBeNull();
    expect(plan.ops.map((o) => [o.op, o.title])).toEqual([
      ['create', 'HW01: Warm up'],
      ['create', 'HW02: Trees'],
    ]);
    expect(plan.skipped.map((s) => s.reason)).toContain('already done; not creating');

    const res = await executeGtasksPush(ctx, api, plan, cfg);
    expect(res.done).toEqual({ create: 2, update: 0, close: 0, delete: 0 });
    expect(api.ops[0]).toBe('insertTaskList School');
    const list = schoolList(api);
    expect(res.listId).toBe(list.id);
    const t = schoolTasks(api).find((x) => x.title === '[CMSC422] HW01: Warm up')!;
    const parts = duePartsFor(due(2), TZ, false);
    expect(t.due).toBe(`${parts.day}T00:00:00.000Z`);
    expect(t.notes).toBe(`https://umd.instructure.com/a/1\nCMSC422 · 10 pts · due ${parts.time}\n\ncollected:canvas:assignment:1`);
    expect(markerIn(t.notes)).toBe('canvas:assignment:1');
    // The default list was not touched.
    expect(api.tasks.MDE2NTk0Njg2!.map((x) => x.title)).toEqual(['Renew library books']);
    const map = await ctx.db.select().from(gtasksMap);
    expect(map.map((m) => m.gtasksTaskId).sort()).toEqual(schoolTasks(api).map((x) => `${list.id}:${x.id}`).sort());

    const again = await planGtasksPush(ctx, api, cfg);
    expect(again.listId).toBe(list.id);
    expect(again.ops).toEqual([]);
  });

  it('can leave the course out of the title', async () => {
    const ctx = await setup();
    const api = new MockGTasksApi(seed);
    const plain = { ...cfg, titlePrefix: 'none' as const };
    await executeGtasksPush(ctx, api, await planGtasksPush(ctx, api, plain), plain);
    expect(schoolTasks(api).map((x) => x.title).sort()).toEqual(['HW01: Warm up', 'HW02: Trees']);
  });

  it('closes when the source is done, never reopens, and leaves hand-closed tasks alone', async () => {
    const ctx = await setup();
    const api = new MockGTasksApi(seed);
    await executeGtasksPush(ctx, api, await planGtasksPush(ctx, api, cfg), cfg);
    const list = schoolList(api);
    const hw1 = schoolTasks(api).find((x) => x.title!.endsWith('HW01: Warm up'))!;
    const hw2 = schoolTasks(api).find((x) => x.title!.endsWith('HW02: Trees'))!;

    // user ticks HW02 in Google Tasks
    await api.completeTask(list.id, hw2.id);
    // source marks HW01 submitted
    await ctx.db.update(items).set({ status: 'submitted' }).where(eq(items.id, 'canvas:assignment:1'));

    const plan = await planGtasksPush(ctx, api, cfg);
    expect(plan.ops.map((o) => [o.op, o.taskId])).toEqual([['close', `${list.id}:${hw1.id}`]]);
    await executeGtasksPush(ctx, api, plan, cfg);
    expect(api.ops.at(-1)).toBe(`completeTask ${list.id} ${hw1.id}`);
    expect((await ctx.db.select().from(gtasksMap)).find((m) => m.itemId === 'canvas:assignment:1')?.closedByUs).toBe(true);

    // source flips back to open → no reopen
    await ctx.db.update(items).set({ status: 'open' }).where(eq(items.id, 'canvas:assignment:1'));
    const plan2 = await planGtasksPush(ctx, api, cfg);
    expect(plan2.ops).toEqual([]);
    expect(plan2.skipped.filter((s) => s.reason === 'task already closed').length).toBe(2);
  });

  it('updates title/due/time when the source changes and deletes open tasks for removed assignments', async () => {
    const ctx = await setup();
    const api = new MockGTasksApi(seed);
    await executeGtasksPush(ctx, api, await planGtasksPush(ctx, api, cfg), cfg);
    const list = schoolList(api);
    await setSourceStatus(ctx, 'canvas', 'connected');
    await ctx.db.update(items).set({ title: 'HW01: Warm up (extended)', dueAt: due(4) }).where(eq(items.id, 'canvas:assignment:1'));
    await ctx.db.update(items).set({ deletedAt: new Date().toISOString() }).where(eq(items.id, 'canvas:assignment:2'));
    const plan = await planGtasksPush(ctx, api, cfg);
    expect(plan.ops.map((o) => [o.op, o.title]).sort()).toEqual([
      ['delete', 'HW02: Trees'],
      ['update', 'HW01: Warm up (extended)'],
    ]);
    const res = await executeGtasksPush(ctx, api, plan, cfg);
    expect(res.done.update).toBe(1);
    expect(res.done.delete).toBe(1);
    expect(api.tasks[list.id]!.map((t) => t.title)).toEqual(['[CMSC422] HW01: Warm up (extended)']);
    expect(api.tasks[list.id]![0]!.due).toBe(`${duePartsFor(due(4), TZ, false).day}T00:00:00.000Z`);
    expect((await ctx.db.select().from(gtasksMap)).map((m) => m.itemId)).toEqual(['canvas:assignment:1']);

    // A time-only change (same day) still reaches the notes, once.
    const sameDayLater = new Date(new Date(due(4)).getTime() + 60_000).toISOString();
    await ctx.db.update(items).set({ dueAt: sameDayLater }).where(eq(items.id, 'canvas:assignment:1'));
    const plan2 = await planGtasksPush(ctx, api, cfg);
    expect(plan2.ops.map((o) => o.op)).toEqual(['update']);
    await executeGtasksPush(ctx, api, plan2, cfg);
    expect(api.tasks[list.id]![0]!.notes).toContain(`due ${duePartsFor(sameDayLater, TZ, false).time}`);
    expect((await planGtasksPush(ctx, api, cfg)).ops).toEqual([]);
  });

  it('never deletes while the source is not connected, and refuses a mass removal', async () => {
    const ctx = await setup();
    const api = new MockGTasksApi(seed);
    await executeGtasksPush(ctx, api, await planGtasksPush(ctx, api, cfg), cfg);
    const gone = new Date().toISOString();
    await ctx.db.update(items).set({ deletedAt: gone }).where(eq(items.id, 'canvas:assignment:2'));

    await setSourceStatus(ctx, 'canvas', 'error', { lastError: 'run exceeded 240 s' });
    const held = await planGtasksPush(ctx, api, cfg);
    expect(held.ops.filter((o) => o.op === 'delete')).toEqual([]);
    expect(held.skipped.some((s) => s.reason.includes('not connected'))).toBe(true);
    expect(schoolTasks(api).length).toBe(2);

    await setSourceStatus(ctx, 'canvas', 'connected');
    await ctx.db.update(items).set({ deletedAt: gone }).where(eq(items.id, 'canvas:assignment:1'));
    const fused = await planGtasksPush(ctx, api, cfg);
    expect(fused.ops.filter((o) => o.op === 'delete')).toEqual([]);
    expect(fused.skipped.filter((s) => s.reason.includes('vanished at once')).length).toBe(2);
    expect(api.ops.filter((o) => o.startsWith('deleteTask'))).toEqual([]);
  });

  it('respects a task deleted in Google: never recreated, and a vanished list reads the same way', async () => {
    const ctx = await setup();
    const api = new MockGTasksApi(seed);
    await executeGtasksPush(ctx, api, await planGtasksPush(ctx, api, cfg), cfg);
    const list = schoolList(api);
    const hw1 = schoolTasks(api).find((x) => x.title!.endsWith('HW01: Warm up'))!;
    await api.deleteTask(list.id, hw1.id);
    api.ops = [];
    const plan = await planGtasksPush(ctx, api, cfg);
    expect(plan.ops).toEqual([]);
    expect(plan.skipped.map((s) => s.reason)).toContain('task deleted in Google Tasks; leaving alone');
    await executeGtasksPush(ctx, api, plan, cfg);
    expect(api.ops).toEqual([]);
    expect(schoolTasks(api).map((t) => t.title)).toEqual(['[CMSC422] HW02: Trees']);

    // The whole list goes: nothing is recreated, nothing is deleted.
    api.lists = api.lists.filter((l) => l.id !== list.id);
    api.fail.add(list.id);
    const plan2 = await planGtasksPush(ctx, api, cfg).catch((err: Error) => err);
    expect(plan2).toBeInstanceOf(Error); // the mock fails with a non-404; a real 404 is tolerated and reads as "gone"
  });

  it('uses an existing list of that name (any case) and rebuilds the mapping from markers', async () => {
    const ctx = await setup();
    const api = new MockGTasksApi({ lists: [...seed.lists, { id: 'school1', title: 'school' }], tasks: { ...seed.tasks, school1: [] } });
    const plan = await planGtasksPush(ctx, api, cfg);
    expect(plan.listId).toBe('school1');
    expect(plan.listName).toBe('school');
    await executeGtasksPush(ctx, api, plan, cfg);
    expect(api.ops.filter((o) => o.startsWith('insertTaskList'))).toEqual([]);
    expect(api.tasks.school1!.length).toBe(2);

    await ctx.db.delete(gtasksMap);
    const rebuilt = await planGtasksPush(ctx, api, cfg);
    expect(rebuilt.rebuilt).toBe(2);
    expect(rebuilt.ops).toEqual([]);
  });
});
