import { Hono } from 'hono';
import { z } from 'zod';
import { SOURCE_IDS, sourceConfigSchemas, sourceIdSchema, type Source, type SourceId } from '@collected/shared';
import { helperKeyMatches, verifyAccess } from '../auth/cloudflare-access.js';
import type { AppContext } from '../context.js';
import { sources } from '../db/schema.js';
import { getIngester } from '../ingest/registry.js';
import { runIngester } from '../ingest/runner.js';
import { getSourceConfig, getSourceRow, mergeSourceMeta, setSourceConfig, setSourceStatus } from '../lib/sources.js';
import { bad, parseBody } from './util.js';
import { eq } from 'drizzle-orm';

function toPublic(row: typeof sources.$inferSelect): Source {
  return {
    id: row.id as SourceId,
    enabled: row.enabled,
    status: row.status as Source['status'],
    lastRunAt: row.lastRunAt,
    lastSuccessAt: row.lastSuccessAt,
    lastError: row.lastError,
    hasConfig: !!row.configEnc,
    meta: row.meta,
    updatedAt: row.updatedAt,
  };
}

export function sourcesRoutes(ctx: AppContext) {
  const r = new Hono();

  r.get('/', async (c) => {
    const rows = await ctx.db.select().from(sources);
    const order = new Map(SOURCE_IDS.map((id, i) => [id, i]));
    rows.sort((a, b) => (order.get(a.id as SourceId) ?? 99) - (order.get(b.id as SourceId) ?? 99));
    return c.json(rows.map(toPublic));
  });

  r.get('/:id', async (c) => {
    const id = sourceIdSchema.safeParse(c.req.param('id'));
    if (!id.success) bad('unknown source', 404);
    return c.json(toPublic(await getSourceRow(ctx, id.data)));
  });

  /** Replace the secret config for a source. Body is validated per source. */
  r.put('/:id/config', async (c) => {
    const id = sourceIdSchema.safeParse(c.req.param('id'));
    if (!id.success) bad('unknown source', 404);
    const schema = sourceConfigSchemas[id.data];
    const body = await parseBody(c, schema);
    await setSourceConfig(ctx, id.data, body);
    await setSourceStatus(ctx, id.data, 'disconnected', { lastError: null });
    await ctx.db.update(sources).set({ enabled: true }).where(eq(sources.id, id.data));
    ctx.log.info({ source: id.data }, 'source config updated');
    return c.json(toPublic(await getSourceRow(ctx, id.data)));
  });

  r.delete('/:id/config', async (c) => {
    const id = sourceIdSchema.safeParse(c.req.param('id'));
    if (!id.success) bad('unknown source', 404);
    await setSourceConfig(ctx, id.data, null);
    await setSourceStatus(ctx, id.data, 'disconnected', { lastError: null });
    return c.json(toPublic(await getSourceRow(ctx, id.data)));
  });

  r.put('/:id/enabled', async (c) => {
    const id = sourceIdSchema.safeParse(c.req.param('id'));
    if (!id.success) bad('unknown source', 404);
    const { enabled } = await parseBody(c, z.object({ enabled: z.boolean() }));
    await ctx.db.update(sources).set({ enabled }).where(eq(sources.id, id.data));
    return c.json(toPublic(await getSourceRow(ctx, id.data)));
  });

  /** Non-secret per-source options (selected calendars, etc.). Shallow-merged into meta. */
  r.patch('/:id/meta', async (c) => {
    const id = sourceIdSchema.safeParse(c.req.param('id'));
    if (!id.success) bad('unknown source', 404);
    const patch = await parseBody(c, z.record(z.string(), z.unknown()));
    await mergeSourceMeta(ctx, id.data, patch);
    return c.json(toPublic(await getSourceRow(ctx, id.data)));
  });

  /** Run now. Returns the outcome so the UI can toast it. */
  r.post('/:id/sync', async (c) => {
    const id = sourceIdSchema.safeParse(c.req.param('id'));
    if (!id.success) bad('unknown source', 404);
    const ing = getIngester(id.data);
    if (!ing) bad(`no ingester for ${id.data} yet`, 404);
    const outcome = await runIngester(ctx, ing, { force: true });
    return c.json({ outcome, source: toPublic(await getSourceRow(ctx, id.data)) });
  });

  /**
   * Canvas cookie drop-off for local/canvas_cookie.py. Accepts either the Access JWT (normal path) or the
   * helper key header, since a script can't do the Access login dance.
   */
  r.post('/canvas/cookie', async (c) => {
    const viaHelper = helperKeyMatches(ctx.env, c.req.header('x-collected-key'));
    const user = viaHelper ? 'helper' : await verifyAccess(ctx.env, c);
    if (!user) return c.json({ error: 'unauthorized' }, 401);
    const body = await parseBody(c, z.object({ cookieHeader: z.string().min(10), baseUrl: z.string().url().optional() }));
    const existing = (await getSourceConfig<{ baseUrl?: string }>(ctx, 'canvas')) ?? {};
    await setSourceConfig(ctx, 'canvas', {
      baseUrl: body.baseUrl ?? existing.baseUrl ?? 'https://umd.instructure.com',
      cookieHeader: body.cookieHeader,
      cookieJar: undefined,
    });
    await setSourceStatus(ctx, 'canvas', 'disconnected', { lastError: null });
    await ctx.db.update(sources).set({ enabled: true }).where(eq(sources.id, 'canvas'));
    ctx.log.info({ viaHelper: !!viaHelper }, 'canvas cookie updated');
    const ing = getIngester('canvas');
    const outcome = ing ? await runIngester(ctx, ing, { force: true }) : null;
    return c.json({ ok: true, outcome });
  });

  return r;
}
