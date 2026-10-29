import { createHash } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import type { EffectiveItem } from '@collected/shared';
import type { AppContext } from '../context.js';
import { items, sources } from '../db/schema.js';
import { queryEffectiveItems } from '../lib/effective.js';
import { mergeSourceMeta } from '../lib/sources.js';
import { addDays, nowIso } from '../lib/time.js';

/**
 * The assignment push, independent of the to-do app it writes to (DECISIONS 043, 050). Everything about *which*
 * assignments become tasks, how the map is rebuilt from markers, when a task is updated, closed, or deleted, and
 * the delete fuse lives here once; `todoist-push.ts` and `gtasks-push.ts` supply a PushBackend that only knows
 * how to talk to its app and where its mapping rows live.
 *
 * Rules (CLAUDE.md, DESIGN.md "Todoist push sync"): one task per effective assignment; done only ever closes; never
 * reopen; the source owns title and due; a deleted assignment deletes an open task; markers make the map
 * rebuildable; nothing a task does reaches Canvas or Gradescope.
 */

export const MARKER_PREFIX = 'collected:';
export const PUSH_PAST_DAYS = 30;
export const PUSH_FUTURE_DAYS = 120;

/**
 * Deleting tasks is the one destructive thing the push does, so it is fused: no deletes while the source of a
 * removed assignment is not `connected` (a failed or timed-out run must never read as "the instructor removed
 * everything"), and none when more than this share of mapped items vanished at once.
 */
export const MAX_DELETE_SHARE = 0.25;
export const MAX_DELETE_FLOOR = 5;
// ...and never when every mapped assignment vanished in the same run, whatever the count.

export type PushKind = 'todoist' | 'gtasks';
export type PushOpKind = 'create' | 'update' | 'close' | 'delete';

export interface PushOp<Body = unknown> {
  op: PushOpKind;
  itemId: string;
  title: string;
  taskId?: string;
  reason: string;
  body?: Body;
}

export interface PushPlan<Body = unknown> {
  ops: PushOp<Body>[];
  /** The project / list the push writes to, null when it does not exist yet (created on the first create). */
  targetId: string | null;
  targetName: string;
  candidates: number;
  mapped: number;
  rebuilt: number;
  skipped: { itemId: string; reason: string }[];
}

export interface PushResult<Body = unknown> {
  plan: PushPlan<Body>;
  done: Record<PushOpKind, number>;
  errors: { op: PushOp<Body>; error: string }[];
  targetId: string | null;
}

/** One mapping row, whatever table it lives in. `taskId` is opaque to the core (Google's is `<listId>:<taskId>`). */
export interface MapRow {
  itemId: string;
  taskId: string;
  lastPushedHash: string | null;
  closedByUs: boolean;
}

/** The mapping table of one backend. Every write is an upsert so a rebuilt row (no table row yet) is persisted on first touch. */
export interface MapStore {
  all(): Promise<MapRow[]>;
  created(itemId: string, taskId: string, hash: string): Promise<void>;
  pushed(itemId: string, taskId: string, hash: string): Promise<void>;
  closed(itemId: string, taskId: string): Promise<void>;
  remove(itemId: string): Promise<void>;
  /** Insert a rebuilt mapping when no row exists; never overwrites. */
  ensure(itemId: string, taskId: string): Promise<void>;
}

/** A task as the core sees it: its id, whether it is closed, and the marker it carries, if any. */
export interface PushTask {
  id: string;
  closed: boolean;
  marker: string | null;
}

export interface PushBackend<Body> {
  kind: PushKind;
  store: MapStore;
  /** Resolve the project / list the push writes to, without creating it. */
  findTarget(): Promise<{ id: string | null; name: string }>;
  /** Every task the push could own: open ones in the target (or anywhere when it does not exist) and recently completed ones. */
  listTasks(targetId: string | null): Promise<PushTask[]>;
  bodyFor(item: EffectiveItem, targetId: string | null): Body;
  hashBody(body: Body): string;
  /** Whether the task already reads as this body (title, due, labels); description/notes are not compared. */
  taskMatches(task: PushTask, body: Body): boolean;
  /** Create the target when the plan creates tasks and it does not exist; anything else the backend needs (labels). */
  prepare(plan: PushPlan<Body>): Promise<string | null>;
  create(body: Body, targetId: string | null): Promise<{ id: string }>;
  update(taskId: string, body: Body): Promise<void>;
  close(taskId: string): Promise<void>;
  delete(taskId: string): Promise<void>;
}

export const markerFor = (item: Pick<EffectiveItem, 'id'>): string => `${MARKER_PREFIX}${item.id}`;

/**
 * Finds `collected:<itemId>` in a task description. The marker is written on its own line and read only from a
 * whole line, so an upstream URL that happens to contain `collected:` (the assignment link is the first line of
 * the description) cannot rebind the task to another item.
 */
export function markerIn(description: string | null | undefined): string | null {
  const lines = (description ?? '').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i]!.trim().match(/^collected:([a-z_]+:\S+)$/);
    if (m) return m[1]!;
  }
  return null;
}

export function sha1(parts: unknown[]): string {
  return createHash('sha1').update(JSON.stringify(parts)).digest('hex');
}

/** Effective assignments the push considers: not informational, not the iCal fallback, due within the window (or undated). */
export async function pushCandidates(ctx: AppContext, now = new Date()): Promise<EffectiveItem[]> {
  const from = addDays(now, -PUSH_PAST_DAYS).toISOString();
  const to = addDays(now, PUSH_FUTURE_DAYS).toISOString();
  const all = await queryEffectiveItems(ctx, { kind: ['assignment'], includeDone: true, limit: 5000 });
  return all.filter((i) => !i.informational && (!i.dueAt || (i.dueAt >= from && i.dueAt <= to)) && i.source !== 'canvas_ical');
}

/** Computes what a push would do. Pure with respect to the to-do app (reads only); the plan is executed by executePlan. */
export async function planPushWith<Body>(ctx: AppContext, backend: PushBackend<Body>): Promise<PushPlan<Body>> {
  const target = await backend.findTarget();
  const targetId = target.id;
  const candidates = await pushCandidates(ctx);

  const tasks = await backend.listTasks(targetId);
  const byTaskId = new Map(tasks.map((t) => [t.id, t]));

  // Map rows + rebuild from markers.
  const map = new Map((await backend.store.all()).map((m) => [m.itemId, m]));
  let rebuilt = 0;
  for (const t of tasks) {
    if (!t.marker || map.has(t.marker)) continue;
    map.set(t.marker, { itemId: t.marker, taskId: t.id, lastPushedHash: null, closedByUs: false });
    rebuilt++;
  }

  const ops: PushOp<Body>[] = [];
  const skipped: PushPlan['skipped'] = [];
  const seenItemIds = new Set<string>();
  for (const item of candidates) {
    seenItemIds.add(item.id);
    const body = backend.bodyFor(item, targetId);
    const m = map.get(item.id);
    if (!m) {
      if (item.effectiveDone) {
        skipped.push({ itemId: item.id, reason: 'already done; not creating' });
        continue;
      }
      ops.push({ op: 'create', itemId: item.id, title: item.title, reason: 'new assignment', body });
      continue;
    }
    const task = byTaskId.get(m.taskId);
    if (!task) {
      // Task vanished (deleted in the app). Respect that: never recreate. The mapping row stays as the tombstone
      // that keeps the item from being created again.
      skipped.push({ itemId: item.id, reason: `task deleted in ${appName(backend.kind)}; leaving alone` });
      continue;
    }
    if (task.closed) {
      skipped.push({ itemId: item.id, reason: 'task already closed' });
      continue;
    }
    if (item.effectiveDone) {
      ops.push({ op: 'close', itemId: item.id, title: item.title, taskId: task.id, reason: `source says ${item.status}` });
      continue;
    }
    if (!backend.taskMatches(task, body) && m.lastPushedHash !== backend.hashBody(body)) {
      ops.push({ op: 'update', itemId: item.id, title: item.title, taskId: task.id, reason: 'title, due date, or labels changed', body });
    }
  }

  // Mapped items that no longer exist (or fell out of scope because they were deleted at the source): delete open tasks.
  const mappedIds = [...map.keys()].filter((id) => !seenItemIds.has(id));
  if (mappedIds.length) {
    const rows = await ctx.db.select({ id: items.id, deletedAt: items.deletedAt, title: items.title, source: items.source }).from(items).where(inArray(items.id, mappedIds));
    const byId = new Map(rows.map((r) => [r.id, r]));
    const healthy = new Set((await ctx.db.select({ id: sources.id }).from(sources).where(eq(sources.status, 'connected'))).map((r) => r.id));
    const deletes: PushOp<Body>[] = [];
    for (const id of mappedIds) {
      const row = byId.get(id);
      const m = map.get(id)!;
      const task = byTaskId.get(m.taskId);
      if (!task || task.closed) continue;
      if (row && !row.deletedAt) continue;
      const source = row?.source ?? id.split(':')[0]!;
      if (!healthy.has(source)) {
        skipped.push({ itemId: id, reason: `removed at the source but ${source} is not connected; not deleting` });
        continue;
      }
      deletes.push({ op: 'delete', itemId: id, title: row?.title ?? id, taskId: task.id, reason: 'assignment removed at the source' });
    }
    const fuse = Math.max(MAX_DELETE_FLOOR, Math.ceil(map.size * MAX_DELETE_SHARE));
    const everything = map.size >= 2 && deletes.length >= map.size;
    if (deletes.length > fuse || everything) {
      ctx.log.warn({ deletes: deletes.length, mapped: map.size }, `${backend.kind} push: too many removals at once; refusing to delete tasks`);
      for (const d of deletes) skipped.push({ itemId: d.itemId, reason: `${deletes.length} assignments vanished at once; refusing to delete tasks` });
    } else ops.push(...deletes);
  }

  return { ops, targetId, targetName: target.name, candidates: candidates.length, mapped: map.size, rebuilt, skipped };
}

/** Applies a plan one op at a time, recording each in the backend's map. Errors are collected, never thrown. */
export async function executePlan<Body>(ctx: AppContext, backend: PushBackend<Body>, plan: PushPlan<Body>): Promise<PushResult<Body>> {
  const targetId = await backend.prepare(plan);
  const done: Record<PushOpKind, number> = { create: 0, update: 0, close: 0, delete: 0 };
  const errors: PushResult<Body>['errors'] = [];
  for (const op of plan.ops) {
    try {
      if (op.op === 'create') {
        const t = await backend.create(op.body!, targetId);
        await backend.store.created(op.itemId, t.id, backend.hashBody(op.body!));
      } else if (op.op === 'update') {
        await backend.update(op.taskId!, op.body!);
        await backend.store.pushed(op.itemId, op.taskId!, backend.hashBody(op.body!));
      } else if (op.op === 'close') {
        await backend.close(op.taskId!);
        await backend.store.closed(op.itemId, op.taskId!);
      } else if (op.op === 'delete') {
        await backend.delete(op.taskId!);
        await backend.store.remove(op.itemId);
      }
      done[op.op]++;
    } catch (err) {
      errors.push({ op, error: err instanceof Error ? err.message : String(err) });
    }
  }
  // Persist rebuilt mappings that had no row yet.
  for (const op of plan.ops) if (op.taskId && op.op !== 'delete') await backend.store.ensure(op.itemId, op.taskId);
  await mergeSourceMeta(ctx, backend.kind, { lastPushAt: nowIso() }).catch(() => undefined);
  ctx.log.info({ ...done, errors: errors.length, rebuilt: plan.rebuilt }, `${backend.kind} push done`);
  return { plan, done, errors, targetId };
}

export function appName(kind: PushKind): string {
  return kind === 'todoist' ? 'Todoist' : 'Google Tasks';
}
