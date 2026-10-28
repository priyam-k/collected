import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { gtasksQuickAddSchema } from '@collected/shared';
import type { AppContext } from '../context.js';
import { items } from '../db/schema.js';
import { splitExternalId, type GTasksApi } from '../ingest/gtasks/api.js';
import { gtaskToRow, gtasksApiForCtx } from '../ingest/gtasks/ingest.js';
import { getSourceRow } from '../lib/sources.js';
import { nowIso } from '../lib/time.js';
import { bad, parseBody } from './util.js';

interface GtasksMeta {
  lists?: { id: string; title: string }[];
  defaultListId?: string | null;
}

/**
 * Add and close from the to-do widget, mirroring the Todoist routes. Nothing here pushes assignments into Google
 * Tasks, and nothing a Google task does reaches Canvas or Gradescope (DECISIONS 049).
 */
export function gtasksRoutes(ctx: AppContext, apiFactory: (ctx: AppContext) => Promise<GTasksApi> = gtasksApiForCtx) {
  const r = new Hono();

  /** Close a Google task. `:id` is the item's external id, `<listId>:<taskId>`. */
  r.post('/tasks/:id/close', async (c) => {
    const ids = splitExternalId(c.req.param('id'));
    if (!ids) bad('expected <listId>:<taskId>', 422);
    const api = await apiFactory(ctx);
    await api.completeTask(ids.listId, ids.taskId);
    await ctx.db.update(items).set({ status: 'done', updatedAt: nowIso() }).where(eq(items.id, `gtasks:${ids.listId}:${ids.taskId}`));
    return c.json({ ok: true });
  });

  /** Add to the default list (the first list Google returns, "My Tasks" unless renamed). */
  r.post('/tasks/quick', async (c) => {
    const { content, due } = await parseBody(c, gtasksQuickAddSchema);
    const api = await apiFactory(ctx);
    const meta = (await getSourceRow(ctx, 'gtasks')).meta as GtasksMeta;
    let list = meta.lists?.find((l) => l.id === meta.defaultListId) ?? meta.lists?.[0];
    if (!list) {
      const lists = await api.listTaskLists();
      if (!lists[0]) bad('this Google account has no task lists', 409);
      list = { id: lists[0].id, title: lists[0].title };
    }
    const task = await api.insertTask(list.id, { title: content, ...(due ? { due: `${due}T00:00:00.000Z` } : {}) });
    const row = gtaskToRow(task, list);
    await ctx.db
      .insert(items)
      .values({ ...row, firstSeenAt: nowIso(), updatedAt: nowIso() })
      .onConflictDoUpdate({ target: items.id, set: { title: row.title, dueAt: row.dueAt, allDay: row.allDay, labels: row.labels, status: 'open', deletedAt: null } });
    return c.json(row, 201);
  });

  return r;
}
