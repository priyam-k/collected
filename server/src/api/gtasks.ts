import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { gtasksPushConfigSchema, gtasksQuickAddSchema } from '@collected/shared';
import type { AppContext } from '../context.js';
import { gtasksMap, items, overrides } from '@collected/core/db/schema';
import { splitExternalId, type GTasksApi } from '@collected/core/ingest/gtasks/api';
import { gtaskToRow, gtasksApiForCtx, syncGtasks } from '@collected/core/ingest/gtasks/ingest';
import { getSettingParsed, setSetting } from '@collected/core/lib/settings';
import { getSourceRow } from '@collected/core/lib/sources';
import { nowIso } from '@collected/core/lib/time';
import { executeGtasksPush, planGtasksPush } from '@collected/core/sync/gtasks-push';
import { bad, parseBody, parsePatch } from './util.js';

interface GtasksMeta {
  lists?: { id: string; title: string }[];
  defaultListId?: string | null;
}

/**
 * Add and close from the to-do widget, mirroring the Todoist routes, plus the assignment push (DECISIONS 050),
 * which mirrors `POST /api/todoist/push` and `/api/todoist/config`. Nothing a Google task does reaches Canvas or
 * Gradescope (DECISIONS 049).
 */
export function gtasksRoutes(ctx: AppContext, apiFactory: (ctx: AppContext) => Promise<GTasksApi> = gtasksApiForCtx) {
  const r = new Hono();

  /** Preview (dryRun=1) or execute the one-way push. Execution requires the setting to be enabled unless force=1. */
  r.post('/push', async (c) => {
    const dryRun = c.req.query('dryRun') === '1';
    const force = c.req.query('force') === '1';
    const cfg = await getSettingParsed(ctx, 'gtasks.push', gtasksPushConfigSchema);
    const api = await apiFactory(ctx);
    const plan = await planGtasksPush(ctx, api, cfg);
    if (dryRun) return c.json({ plan });
    if (!cfg.enabled && !force) bad('push sync is disabled; enable it in Settings → To-do apps → Google Tasks or pass force=1', 409);
    const result = await executeGtasksPush(ctx, api, plan, cfg);
    await syncGtasks(ctx, api).catch((err) => ctx.log.warn({ err }, 'post-push gtasks sync failed'));
    return c.json(result);
  });

  r.get('/config', async (c) => c.json(await getSettingParsed(ctx, 'gtasks.push', gtasksPushConfigSchema)));
  r.put('/config', async (c) => {
    const body = await parsePatch(c, gtasksPushConfigSchema);
    const cfg = await getSettingParsed(ctx, 'gtasks.push', gtasksPushConfigSchema);
    const next = { ...cfg, ...body };
    await setSetting(ctx, 'gtasks.push', next);
    return c.json(next);
  });

  /** Close a Google task. `:id` is the item's external id, `<listId>:<taskId>`. */
  r.post('/tasks/:id/close', async (c) => {
    const ids = splitExternalId(c.req.param('id'));
    if (!ids) bad('expected <listId>:<taskId>', 422);
    const api = await apiFactory(ctx);
    await api.completeTask(ids.listId, ids.taskId);
    await ctx.db.update(items).set({ status: 'done', updatedAt: nowIso() }).where(eq(items.id, `gtasks:${ids.listId}:${ids.taskId}`));
    // Mirrors (pushed assignments) also get an override so the source item hides immediately, as the Todoist close does.
    const mapped = await ctx.db.query.gtasksMap.findFirst({ where: eq(gtasksMap.gtasksTaskId, `${ids.listId}:${ids.taskId}`) });
    if (mapped) {
      await ctx.db.update(gtasksMap).set({ closedByUs: true }).where(eq(gtasksMap.itemId, mapped.itemId));
      await ctx.db.insert(overrides).values({ itemId: mapped.itemId, done: true }).onConflictDoUpdate({ target: overrides.itemId, set: { done: true } });
    }
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
