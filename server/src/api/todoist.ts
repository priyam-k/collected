import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { todoistPushConfigSchema } from '@collected/shared';
import type { AppContext } from '../context.js';
import { items, overrides, todoistMap } from '../db/schema.js';
import type { TodoistApi } from '../ingest/todoist/api.js';
import { syncTodoist, taskToRow, todoistApiForCtx } from '../ingest/todoist/ingest.js';
import { getSettingParsed, setSetting } from '../lib/settings.js';
import { nowIso } from '../lib/time.js';
import { executePush, planPush } from '../sync/todoist-push.js';
import { bad, parseBody } from './util.js';

export function todoistRoutes(ctx: AppContext, apiFactory: (ctx: AppContext) => Promise<TodoistApi> = todoistApiForCtx) {
  const r = new Hono();

  /** Preview (dryRun=1) or execute the one-way push. Execution requires the setting to be enabled unless force=1. */
  r.post('/push', async (c) => {
    const dryRun = c.req.query('dryRun') === '1';
    const force = c.req.query('force') === '1';
    const cfg = await getSettingParsed(ctx, 'todoist.push', todoistPushConfigSchema);
    const api = await apiFactory(ctx);
    const plan = await planPush(ctx, api, cfg);
    if (dryRun) return c.json({ plan });
    if (!cfg.enabled && !force) bad('push sync is disabled; enable it in Settings → Todoist sync or pass force=1', 409);
    const result = await executePush(ctx, api, plan, cfg);
    if (result.projectId && result.projectId !== cfg.projectId) await setSetting(ctx, 'todoist.push', { ...cfg, projectId: result.projectId });
    await syncTodoist(ctx, api).catch((err) => ctx.log.warn({ err }, 'post-push todoist sync failed'));
    return c.json(result);
  });

  r.get('/config', async (c) => c.json(await getSettingParsed(ctx, 'todoist.push', todoistPushConfigSchema)));
  r.put('/config', async (c) => {
    const body = await parseBody(c, todoistPushConfigSchema.partial());
    const cfg = await getSettingParsed(ctx, 'todoist.push', todoistPushConfigSchema);
    const next = { ...cfg, ...body };
    await setSetting(ctx, 'todoist.push', next);
    return c.json(next);
  });

  /** Close a native Todoist task from the todo widget. Mirrors (pushed assignments) also get an override so the source item hides immediately. */
  r.post('/tasks/:id/close', async (c) => {
    const id = c.req.param('id');
    const api = await apiFactory(ctx);
    await api.closeTask(id);
    await ctx.db.update(items).set({ status: 'done', updatedAt: nowIso() }).where(eq(items.id, `todoist:${id}`));
    const mapped = await ctx.db.query.todoistMap.findFirst({ where: eq(todoistMap.todoistTaskId, id) });
    if (mapped) {
      await ctx.db.update(todoistMap).set({ closedByUs: true }).where(eq(todoistMap.itemId, mapped.itemId));
      await ctx.db.insert(overrides).values({ itemId: mapped.itemId, done: true }).onConflictDoUpdate({ target: overrides.itemId, set: { done: true } });
    }
    return c.json({ ok: true });
  });

  /** Quick add with Todoist's natural-language parser. */
  r.post('/tasks/quick', async (c) => {
    const { text } = await parseBody(c, z.object({ text: z.string().min(1).max(500) }));
    const api = await apiFactory(ctx);
    const task = await api.quickAdd(text);
    const row = taskToRow(task, { projects: new Map(), sections: new Map() });
    await ctx.db.insert(items).values(row).onConflictDoUpdate({ target: items.id, set: { title: row.title, dueAt: row.dueAt, labels: row.labels, status: 'open', deletedAt: null } });
    return c.json(row, 201);
  });

  return r;
}
