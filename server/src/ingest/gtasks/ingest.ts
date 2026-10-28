import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { sourceConfigSchemas } from '@collected/shared';
import type { AppContext } from '../../context.js';
import { items, type NewItemRow } from '../../db/schema.js';
import { upsertItems } from '../../lib/items.js';
import { getSourceConfig } from '../../lib/sources.js';
import { addDays, isoOrNull, nowIso } from '../../lib/time.js';
import { NeedsAuthError, NotConfiguredError, type Ingester } from '../types.js';
import type { GTask, GTaskList, GTasksApi } from './api.js';
import { GTasksHttpApi, accessTokenFromRefreshToken } from './client.js';

/** Completed tasks older than this age out, like Todoist's 30-day completed window. */
export const GTASKS_COMPLETED_DAYS = 30;

/** Tasks `due` is a date (the API drops the time): end of that day, local, like an all-day Todoist task. */
export function gtaskDueToIso(due: string | null | undefined): { dueAt: string | null; allDay: boolean } {
  const day = due?.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
  if (!day) return { dueAt: null, allDay: false };
  const dueAt = isoOrNull(`${day}T23:59:00`);
  return { dueAt, allDay: !!dueAt };
}

export function gtaskToRow(t: GTask, list: { id: string; title: string | null }): NewItemRow {
  const { dueAt, allDay } = gtaskDueToIso(t.due);
  const done = t.status === 'completed';
  const listName = list.title ?? null;
  return {
    id: `gtasks:${list.id}:${t.id}`,
    source: 'gtasks',
    externalId: `${list.id}:${t.id}`,
    kind: 'task',
    courseId: null,
    title: (t.title ?? '').trim() || '(untitled)',
    description: t.notes?.trim() ? t.notes.slice(0, 2000) : null,
    url: t.webViewLink ?? 'https://tasks.google.com/',
    dueAt,
    startsAt: null,
    endsAt: null,
    allDay,
    status: done ? 'done' : 'open',
    points: null,
    score: null,
    // The list name doubles as a label so the to-do widget's label sections pick up a list called "Homework".
    labels: listName ? [listName.toLowerCase()] : [],
    raw: {
      listId: list.id,
      listName,
      projectName: listName,
      parentId: t.parent ?? null,
      completedAt: t.completed ?? null,
      position: t.position ?? null,
      hidden: !!t.hidden,
    },
  };
}

/**
 * Lists, then every task per list. Each list is its own delete scope, and a list only drives deletions when its
 * fetch succeeded, was not truncated at the cap, and returned something (upsertItems refuses an empty answer).
 * Rows of lists that are gone from a non-empty list answer are retired.
 */
export async function syncGtasks(ctx: AppContext, api: GTasksApi, now = new Date()): Promise<{ counts: Record<string, number>; lists: GTaskList[] }> {
  const lists = await api.listTaskLists();
  const counts: Record<string, number> = { lists: lists.length, tasks: 0, open: 0, completed: 0, upserted: 0, created: 0, deleted: 0, failedLists: 0, truncatedLists: 0 };
  const cutoff = addDays(now, -GTASKS_COMPLETED_DAYS).getTime();
  let lastError: unknown = null;
  for (const list of lists) {
    let fetched: { tasks: GTask[]; truncated: boolean };
    try {
      fetched = await api.listTasks(list.id);
    } catch (err) {
      if (err instanceof NeedsAuthError) throw err;
      ctx.log.warn({ err, list: list.id }, 'gtasks list fetch failed; keeping its rows');
      counts.failedLists!++;
      lastError = err;
      continue;
    }
    const rows: NewItemRow[] = [];
    for (const t of fetched.tasks) {
      if (t.deleted) continue;
      if (t.status === 'completed' && t.completed && new Date(t.completed).getTime() < cutoff) continue;
      rows.push(gtaskToRow(t, list));
    }
    counts.tasks! += rows.length;
    counts.open! += rows.filter((r) => r.status === 'open').length;
    counts.completed! += rows.filter((r) => r.status === 'done').length;
    if (fetched.truncated) counts.truncatedLists!++;
    const prefix = `${list.id}:`;
    const scope = fetched.truncated ? undefined : [sql`substr(${items.externalId}, 1, ${prefix.length}) = ${prefix}`];
    const r = await upsertItems(ctx, 'gtasks', rows, scope);
    counts.upserted! += r.upserted;
    counts.created! += r.created;
    counts.deleted! += r.deleted;
  }
  if (lists.length && counts.failedLists === lists.length) throw lastError instanceof Error ? lastError : new Error('every Google Tasks list failed to load');
  if (lists.length) {
    const keep = lists.map((l) => `${l.id}:`);
    const live = await ctx.db.select({ id: items.id, externalId: items.externalId }).from(items).where(and(eq(items.source, 'gtasks'), isNull(items.deletedAt)));
    const stale = live.filter((row) => !keep.some((p) => row.externalId.startsWith(p))).map((row) => row.id);
    if (stale.length) {
      await ctx.db.update(items).set({ deletedAt: nowIso() }).where(and(eq(items.source, 'gtasks'), inArray(items.id, stale)));
      counts.retired = stale.length;
    }
  }
  return { counts, lists };
}

export async function gtasksApiForCtx(ctx: AppContext): Promise<GTasksHttpApi> {
  const config = await getSourceConfig<{ refreshToken: string }>(ctx, 'gtasks');
  if (!config?.refreshToken) throw new NotConfiguredError('Google Tasks is not connected');
  const { refreshToken } = sourceConfigSchemas.gtasks.parse(config);
  return new GTasksHttpApi(accessTokenFromRefreshToken(ctx.env, refreshToken));
}

export const gtasksIngester: Ingester = {
  id: 'gtasks',
  intervalMinutes: 5, // the Todoist cadence
  timeoutMs: 120_000,
  async run(ctx, signal) {
    const api = await gtasksApiForCtx(ctx);
    api.signal = signal;
    const { counts, lists } = await syncGtasks(ctx, api);
    return { counts, meta: { lists: lists.map((l) => ({ id: l.id, title: l.title })), defaultListId: lists[0]?.id ?? null } };
  },
};
