import { createHash } from 'node:crypto';
import { eq, inArray, isNotNull } from 'drizzle-orm';
import { todoistPushConfigSchema, type EffectiveItem, type TodoistPushConfig } from '@collected/shared';
import type { AppContext } from '../context.js';
import { courses, items, sources, todoistMap } from '../db/schema.js';
import { queryEffectiveItems } from '../lib/effective.js';
import { getSettingParsed } from '../lib/settings.js';
import { addDays, nowIso } from '../lib/time.js';
import { isClosed, type NewTaskBody, type TTask, type TodoistApi } from '../ingest/todoist/api.js';

export const MARKER_PREFIX = 'collected:';
export const PUSH_PAST_DAYS = 30;
export const PUSH_FUTURE_DAYS = 120;

export type PushOpKind = 'create' | 'update' | 'close' | 'delete';

export interface PushOp {
  op: PushOpKind;
  itemId: string;
  title: string;
  taskId?: string;
  reason: string;
  body?: NewTaskBody;
}

export interface PushPlan {
  ops: PushOp[];
  projectId: string | null;
  projectName: string;
  candidates: number;
  mapped: number;
  rebuilt: number;
  skipped: { itemId: string; reason: string }[];
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

/**
 * Deleting tasks is the one destructive thing the push does, so it is fused: no deletes while the source of a
 * removed assignment is not `connected` (a failed or timed-out run must never read as "the instructor removed
 * everything"), and none when more than this share of mapped items vanished at once.
 */
export const MAX_DELETE_SHARE = 0.25;
export const MAX_DELETE_FLOOR = 5;
// ...and never when every mapped assignment vanished in the same run, whatever the count.

function description(item: EffectiveItem): string {
  const lines: string[] = [];
  if (item.url) lines.push(item.url);
  if (item.course?.code) lines.push(`${item.course.code}${item.points != null ? ` · ${item.points} pts` : ''}`);
  lines.push('', markerFor(item));
  return lines.join('\n');
}

function labelsFor(item: EffectiveItem, cfg: TodoistPushConfig): string[] {
  const labels = [cfg.commonLabel];
  if (cfg.courseLabels && item.course?.code) labels.push(item.course.code.toLowerCase());
  return labels;
}

export function bodyFor(item: EffectiveItem, cfg: TodoistPushConfig, projectId: string | null): NewTaskBody {
  const body: NewTaskBody = { content: item.title, description: description(item), labels: labelsFor(item, cfg) };
  if (projectId) body.project_id = projectId;
  if (item.dueAt) body.due_datetime = new Date(item.dueAt).toISOString();
  return body;
}

export function hashBody(body: NewTaskBody): string {
  return createHash('sha1').update(JSON.stringify([body.content, body.due_datetime ?? body.due_date ?? null, body.labels ?? [], body.description ?? ''])).digest('hex');
}

function taskMatchesBody(task: TTask, body: NewTaskBody): boolean {
  const rawDue = task.due?.datetime || task.due?.date || null;
  const parsed = rawDue && !/^\d{4}-\d{2}-\d{2}$/.test(rawDue) ? new Date(rawDue) : null;
  const taskDue = parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : rawDue;
  const wantDue = body.due_datetime ?? body.due_date ?? null;
  const sameLabels = [...(task.labels ?? [])].sort().join(',') === [...(body.labels ?? [])].sort().join(',');
  return task.content === body.content && taskDue === wantDue && sameLabels;
}

/**
 * Computes what a push would do. Pure with respect to Todoist (reads only); the plan is executed by executePush.
 * Rules (DESIGN.md "Todoist push sync"): one task per effective assignment; done only ever closes; never reopen;
 * source owns title/due; deleted assignment deletes an open task; markers make the map rebuildable.
 */
export async function planPush(ctx: AppContext, api: TodoistApi, cfgIn?: TodoistPushConfig): Promise<PushPlan> {
  const cfg = cfgIn ?? (await getSettingParsed(ctx, 'todoist.push', todoistPushConfigSchema));
  const projects = await api.listProjects();
  const project = (cfg.projectId && projects.find((p) => p.id === cfg.projectId)) || projects.find((p) => p.name.toLowerCase() === cfg.projectName.toLowerCase()) || null;
  const projectId = project?.id ?? null;

  const now = new Date();
  const from = addDays(now, -PUSH_PAST_DAYS).toISOString();
  const to = addDays(now, PUSH_FUTURE_DAYS).toISOString();
  const all = await queryEffectiveItems(ctx, { kind: ['assignment'], includeDone: true, limit: 5000 });
  const candidates = all.filter((i) => !i.informational && (!i.dueAt || (i.dueAt >= from && i.dueAt <= to)) && i.source !== 'canvas_ical');

  // Existing tasks: open ones in the project (or anywhere if no project yet) + recently completed, for closed-state.
  const openTasks = await api.listTasks(projectId ? { projectId } : undefined);
  const completed = await api.listCompleted(addDays(now, -90).toISOString(), now.toISOString());
  const byTaskId = new Map<string, TTask>([...completed, ...openTasks].map((t) => [t.id, t]));

  // Map rows + rebuild from markers.
  const mapRows = await ctx.db.select().from(todoistMap);
  const map = new Map(mapRows.map((m) => [m.itemId, m]));
  let rebuilt = 0;
  for (const t of [...openTasks, ...completed]) {
    const itemId = markerIn(t.description);
    if (!itemId || map.has(itemId)) continue;
    map.set(itemId, { itemId, todoistTaskId: t.id, lastPushedHash: null, closedByUs: false, createdAt: nowIso(), updatedAt: nowIso() });
    rebuilt++;
  }

  const ops: PushOp[] = [];
  const skipped: PushPlan['skipped'] = [];
  const seenItemIds = new Set<string>();
  for (const item of candidates) {
    seenItemIds.add(item.id);
    const body = bodyFor(item, cfg, projectId);
    const m = map.get(item.id);
    if (!m) {
      if (item.effectiveDone) {
        skipped.push({ itemId: item.id, reason: 'already done; not creating' });
        continue;
      }
      ops.push({ op: 'create', itemId: item.id, title: item.title, reason: 'new assignment', body });
      continue;
    }
    const task = byTaskId.get(m.todoistTaskId);
    if (!task) {
      // Task vanished (deleted in Todoist). Respect that: don't recreate; drop the mapping later.
      skipped.push({ itemId: item.id, reason: 'task deleted in Todoist; leaving alone' });
      continue;
    }
    if (isClosed(task)) {
      skipped.push({ itemId: item.id, reason: 'task already closed' });
      continue;
    }
    if (item.effectiveDone) {
      ops.push({ op: 'close', itemId: item.id, title: item.title, taskId: task.id, reason: `source says ${item.status}` });
      continue;
    }
    if (!taskMatchesBody(task, body) && m.lastPushedHash !== hashBody(body)) {
      ops.push({ op: 'update', itemId: item.id, title: item.title, taskId: task.id, reason: 'title, due date, or labels changed', body });
    }
  }

  // Mapped items that no longer exist (or fell out of scope because they were deleted at the source): delete open tasks.
  const mappedIds = [...map.keys()].filter((id) => !seenItemIds.has(id));
  if (mappedIds.length) {
    const rows = await ctx.db.select({ id: items.id, deletedAt: items.deletedAt, title: items.title, source: items.source }).from(items).where(inArray(items.id, mappedIds));
    const byId = new Map(rows.map((r) => [r.id, r]));
    const healthy = new Set((await ctx.db.select({ id: sources.id }).from(sources).where(eq(sources.status, 'connected'))).map((r) => r.id));
    const deletes: PushOp[] = [];
    for (const id of mappedIds) {
      const row = byId.get(id);
      const m = map.get(id)!;
      const task = byTaskId.get(m.todoistTaskId);
      if (!task || isClosed(task)) continue;
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
      ctx.log.warn({ deletes: deletes.length, mapped: map.size }, 'todoist push: too many removals at once; refusing to delete tasks');
      for (const d of deletes) skipped.push({ itemId: d.itemId, reason: `${deletes.length} assignments vanished at once; refusing to delete tasks` });
    } else ops.push(...deletes);
  }

  return { ops, projectId, projectName: project?.name ?? cfg.projectName, candidates: candidates.length, mapped: map.size, rebuilt, skipped };
}

export interface PushResult {
  plan: PushPlan;
  done: Record<PushOpKind, number>;
  errors: { op: PushOp; error: string }[];
  projectId: string | null;
}

export async function executePush(ctx: AppContext, api: TodoistApi, plan: PushPlan, cfgIn?: TodoistPushConfig): Promise<PushResult> {
  const cfg = cfgIn ?? (await getSettingParsed(ctx, 'todoist.push', todoistPushConfigSchema));
  let projectId = plan.projectId;
  if (!projectId && plan.ops.some((o) => o.op === 'create')) {
    const p = await api.createProject(cfg.projectName);
    projectId = p.id;
    ctx.log.info({ project: p.name, id: p.id }, 'created Todoist project');
  }
  // Make sure labels exist (Todoist creates unknown labels on the fly for most accounts, but be explicit).
  const wanted = new Set(plan.ops.flatMap((o) => o.body?.labels ?? []));
  if (wanted.size) {
    const have = new Set((await api.listLabels()).map((l) => l.name.toLowerCase()));
    for (const name of wanted) if (!have.has(name.toLowerCase())) await api.createLabel(name).catch(() => undefined);
  }

  const done: Record<PushOpKind, number> = { create: 0, update: 0, close: 0, delete: 0 };
  const errors: PushResult['errors'] = [];
  for (const op of plan.ops) {
    try {
      if (op.op === 'create') {
        const body = { ...op.body!, project_id: projectId ?? op.body!.project_id };
        const t = await api.createTask(body);
        await ctx.db
          .insert(todoistMap)
          .values({ itemId: op.itemId, todoistTaskId: t.id, lastPushedHash: hashBody(body) })
          .onConflictDoUpdate({ target: todoistMap.itemId, set: { todoistTaskId: t.id, lastPushedHash: hashBody(body), closedByUs: false } });
      } else if (op.op === 'update') {
        const { project_id: _p, ...body } = op.body!;
        await api.updateTask(op.taskId!, body);
        await ctx.db
          .insert(todoistMap)
          .values({ itemId: op.itemId, todoistTaskId: op.taskId!, lastPushedHash: hashBody(op.body!) })
          .onConflictDoUpdate({ target: todoistMap.itemId, set: { lastPushedHash: hashBody(op.body!) } });
      } else if (op.op === 'close') {
        await api.closeTask(op.taskId!);
        await ctx.db
          .insert(todoistMap)
          .values({ itemId: op.itemId, todoistTaskId: op.taskId!, closedByUs: true })
          .onConflictDoUpdate({ target: todoistMap.itemId, set: { closedByUs: true } });
      } else if (op.op === 'delete') {
        await api.deleteTask(op.taskId!);
        await ctx.db.delete(todoistMap).where(eq(todoistMap.itemId, op.itemId));
      }
      done[op.op]++;
    } catch (err) {
      errors.push({ op, error: err instanceof Error ? err.message : String(err) });
    }
  }
  // Persist rebuilt mappings that had no row yet.
  const existing = new Set((await ctx.db.select({ itemId: todoistMap.itemId }).from(todoistMap)).map((r) => r.itemId));
  for (const op of plan.ops) if (!existing.has(op.itemId) && op.taskId && op.op !== 'delete') {
    await ctx.db.insert(todoistMap).values({ itemId: op.itemId, todoistTaskId: op.taskId }).onConflictDoNothing();
  }
  ctx.log.info({ ...done, errors: errors.length, rebuilt: plan.rebuilt }, 'todoist push done');
  return { plan, done, errors, projectId };
}

/** Course labels we might need, for the settings preview. */
export async function courseLabelNames(ctx: AppContext): Promise<string[]> {
  const rows = await ctx.db.select({ code: courses.code }).from(courses).where(isNotNull(courses.code));
  return rows.map((r) => r.code.toLowerCase());
}
