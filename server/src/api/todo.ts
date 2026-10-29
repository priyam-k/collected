import { Hono } from 'hono';
import { gtasksPushConfigSchema, resolveTodoApp, todoistPushConfigSchema, type TodoAppStatus, type TodoStatus } from '@collected/shared';
import type { AppContext } from '../context.js';
import { getSetting, getSettingParsed } from '@collected/core/lib/settings';
import { getSourceRow } from '@collected/core/lib/sources';

/** `GET /api/todo/status`: the two to-do apps side by side for the settings page (DECISIONS 050). */
export function todoRoutes(ctx: AppContext) {
  const r = new Hono();

  r.get('/status', async (c) => {
    const [todoist, gtasks, todoistPush, gtasksPush, defaultApp] = await Promise.all([
      getSourceRow(ctx, 'todoist'),
      getSourceRow(ctx, 'gtasks'),
      getSettingParsed(ctx, 'todoist.push', todoistPushConfigSchema),
      getSettingParsed(ctx, 'gtasks.push', gtasksPushConfigSchema),
      getSetting(ctx, 'todo.defaultApp'),
    ]);
    const status = (row: typeof todoist, pushEnabled: boolean): TodoAppStatus => ({
      connected: row.status === 'connected',
      enabled: row.enabled,
      pushEnabled,
      lastPushAt: typeof row.meta.lastPushAt === 'string' ? row.meta.lastPushAt : null,
    });
    const out: TodoStatus = {
      todoist: status(todoist, todoistPush.enabled),
      gtasks: status(gtasks, gtasksPush.enabled),
      defaultApp: resolveTodoApp(defaultApp, { todoist: todoist.status === 'connected', gtasks: gtasks.status === 'connected' }),
    };
    return c.json(out);
  });

  return r;
}
