import { randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { todoistPushConfigSchema } from '@collected/shared';
import type { AuthVariables } from '../auth/cloudflare-access.js';
import { exchangeTodoistCode, revokeTodoistToken, todoistAuthUrl } from '@collected/core/auth/todoist';
import type { AppContext } from '../context.js';
import { items, overrides, sources, todoistMap } from '@collected/core/db/schema';
import { runIngester } from '@collected/core/ingest/runner';
import type { TodoistApi } from '@collected/core/ingest/todoist/api';
import { syncTodoist, taskToRow, todoistApiForCtx, todoistIngester } from '@collected/core/ingest/todoist/ingest';
import { NotConfiguredError } from '@collected/core/ingest/types';
import { getSettingParsed, setSetting } from '@collected/core/lib/settings';
import { getSourceConfig, getSourceRow, mergeSourceMeta, setSourceConfig, setSourceStatus } from '@collected/core/lib/sources';
import { nowIso } from '@collected/core/lib/time';
import { executePush, planPush } from '@collected/core/sync/todoist-push';
import { bad, parseBody, parsePatch } from './util.js';

/** OAuth state → who started the flow and when it expires. Bound to the identity like the Google flow (api/google.ts). */
const pendingStates = new Map<string, { user: string | null; exp: number }>();
const STATE_TTL_MS = 10 * 60_000;

/** Reason codes the settings page knows; nothing from Todoist or an exception reaches the URL. */
type Reason = 'denied' | 'expired' | 'exchange' | 'config' | 'unknown';

export interface TodoistRouteDeps {
  /** Outbound fetch for the token exchange and revoke; tests pass a fake. */
  fetchImpl?: typeof fetch;
  /** What runs the first sync after a connect; tests pass a no-op. */
  run?: typeof runIngester;
  now?: () => number;
}

export function todoistRoutes(ctx: AppContext, apiFactory: (ctx: AppContext) => Promise<TodoistApi> = todoistApiForCtx, deps: TodoistRouteDeps = {}) {
  const r = new Hono<{ Variables: AuthVariables }>();
  const fetchImpl = deps.fetchImpl ?? fetch;
  const run = deps.run ?? runIngester;
  const now = deps.now ?? Date.now;
  const settingsUrl = (q: string) => `${ctx.env.PUBLIC_URL.replace(/\/$/, '')}/settings/sources?${q}`;
  const failed = (reason: Reason) => settingsUrl(`todoist=error&reason=${reason}`);

  /** Starts the OAuth connect. Needs TODOIST_CLIENT_ID / TODOIST_CLIENT_SECRET; without them the card takes a pasted token. */
  r.get('/connect', (c) => {
    try {
      const t = now();
      for (const [k, v] of pendingStates) if (v.exp < t) pendingStates.delete(k);
      const state = randomBytes(16).toString('hex');
      pendingStates.set(state, { user: c.get('user') ?? null, exp: t + STATE_TTL_MS });
      return c.redirect(todoistAuthUrl(ctx.env, state));
    } catch (err) {
      if (err instanceof NotConfiguredError) return c.redirect(failed('config'));
      throw err;
    }
  });

  /**
   * Todoist sends the browser back here. The token lands in the same encrypted config slot the pasted token uses
   * (`{ token }`), so the ingester and the push sync do not know which way it arrived; meta.connectedVia does.
   */
  r.get('/callback', async (c) => {
    const { code, state, error } = c.req.query();
    if (error) return c.redirect(failed(error === 'access_denied' ? 'denied' : 'unknown'));
    const pending = state ? pendingStates.get(state) : undefined;
    pendingStates.delete(state ?? '');
    if (!code || !pending || pending.exp < now() || pending.user !== (c.get('user') ?? null)) return c.redirect(failed('expired'));
    try {
      const token = await exchangeTodoistCode(ctx.env, code, fetchImpl);
      await setSourceConfig(ctx, 'todoist', { token });
      await mergeSourceMeta(ctx, 'todoist', { connectedVia: 'oauth' });
      await ctx.db.update(sources).set({ enabled: true }).where(eq(sources.id, 'todoist'));
      await setSourceStatus(ctx, 'todoist', 'connected', { lastError: null });
      ctx.log.info('todoist connected via oauth');
      void run(ctx, todoistIngester, { force: true }).catch((err) => ctx.log.warn({ err }, 'first todoist sync after connect failed'));
      return c.redirect(settingsUrl('todoist=connected'));
    } catch (err) {
      ctx.log.error({ err }, 'todoist oauth callback failed');
      return c.redirect(failed(err instanceof NotConfiguredError ? 'config' : 'exchange'));
    }
  });

  /** Clears the token (pasted or OAuth). An OAuth token is also revoked at Todoist, best effort. */
  r.post('/disconnect', async (c) => {
    const row = await getSourceRow(ctx, 'todoist');
    const via = (row.meta as { connectedVia?: string }).connectedVia;
    let revoked = false;
    if (via === 'oauth') {
      const cfg = await getSourceConfig<{ token?: string }>(ctx, 'todoist').catch(() => null);
      if (cfg?.token) revoked = await revokeTodoistToken(ctx.env, cfg.token, fetchImpl);
    }
    await setSourceConfig(ctx, 'todoist', null);
    await mergeSourceMeta(ctx, 'todoist', { connectedVia: null });
    await setSourceStatus(ctx, 'todoist', 'disconnected', { lastError: null });
    ctx.log.info({ revoked }, 'todoist disconnected');
    return c.json({ ok: true, revoked });
  });

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
    const body = await parsePatch(c, todoistPushConfigSchema);
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
