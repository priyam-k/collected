import { Hono } from 'hono';
import { z } from 'zod';
import { INGESTED_SOURCE_IDS, outboundUrlSchema, sourceConfigSchemas, sourceIdSchema, type IngestedSourceId, type Source } from '@collected/shared';
import { helperKeyMatches, verifyAccess } from '../auth/cloudflare-access.js';
import type { AppContext } from '../context.js';
import { sources } from '../db/schema.js';
import { ingesters as registryIngesters } from '../ingest/registry.js';
import { isRunning, runIngester as runReal, type RunOutcome } from '../ingest/runner.js';
import type { Ingester } from '../ingest/types.js';
import { getSourceConfig, getSourceRow, mergeSourceMeta, setSourceConfig, setSourceStatus } from '../lib/sources.js';
import { bad, parseBody } from './util.js';
import { eq } from 'drizzle-orm';

/** Opaque sync cursors are state, not something the UI needs; keep them server-side. */
function stripPrivateMeta(meta: unknown): Record<string, unknown> {
  if (!meta || typeof meta !== 'object') return {};
  const { syncTokens: _s, ...rest } = meta as Record<string, unknown>;
  return rest;
}

function toPublic(row: typeof sources.$inferSelect): Source {
  return {
    id: row.id as IngestedSourceId,
    enabled: row.enabled,
    status: row.status as Source['status'],
    lastRunAt: row.lastRunAt,
    lastSuccessAt: row.lastSuccessAt,
    lastError: row.lastError,
    hasConfig: !!row.configEnc,
    running: isRunning(row.id as IngestedSourceId),
    meta: stripPrivateMeta(row.meta),
    updatedAt: row.updatedAt,
  };
}

export interface SyncAllResult {
  started: IngestedSourceId[];
  skipped: { id: IngestedSourceId; reason: 'running' | 'disabled' }[];
}

interface SourcesDeps {
  ingesters: Ingester[];
  run: (ctx: AppContext, ing: Ingester, opts?: { force?: boolean }) => Promise<RunOutcome>;
}

export function sourcesRoutes(ctx: AppContext, deps: SourcesDeps = { ingesters: registryIngesters, run: runReal }) {
  const r = new Hono();
  const getIngester = (id: string) => deps.ingesters.find((i) => i.id === id);
  const runIngester = deps.run;

  /**
   * Start every enabled source now and return immediately; runs continue in the background. The UI polls
   * GET /sources and watches `running` to know when they're done. Disabled and already-running sources are
   * reported as skipped. Unconfigured ones start and end as `disconnected` a moment later, which is harmless.
   */
  r.post('/sync', async (c) => {
    const result: SyncAllResult = { started: [], skipped: [] };
    for (const ing of deps.ingesters) {
      const id = ing.id as IngestedSourceId;
      if (isRunning(id)) {
        result.skipped.push({ id, reason: 'running' });
        continue;
      }
      const row = await getSourceRow(ctx, id);
      if (!row.enabled) {
        result.skipped.push({ id, reason: 'disabled' });
        continue;
      }
      result.started.push(id);
      void runIngester(ctx, ing).catch((err) => ctx.log.error({ err, source: id }, 'sync-all run threw'));
    }
    ctx.log.info({ started: result.started, skipped: result.skipped.length }, 'sync all requested');
    return c.json(result, 202);
  });

  r.get('/', async (c) => {
    const rows = await ctx.db.select().from(sources);
    const order = new Map(INGESTED_SOURCE_IDS.map((id, i) => [id, i]));
    rows.sort((a, b) => (order.get(a.id as IngestedSourceId) ?? 99) - (order.get(b.id as IngestedSourceId) ?? 99));
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
    if ('syncTokens' in patch || 'lastRun' in patch) bad('that meta key is server-managed', 422);
    // The jobs ingester reads its feed list from meta, so feed URLs are validated like any other outbound URL.
    if (id.data === 'jobs' && 'sources' in patch) patch.sources = sourceConfigSchemas.jobs.parse({ sources: patch.sources }).sources;
    await mergeSourceMeta(ctx, id.data, patch);
    return c.json(toPublic(await getSourceRow(ctx, id.data)));
  });

  /** What a source has pulled: last run counts, items per course, the most recent rows. Feeds the settings data viewer. */
  r.get('/:id/summary', async (c) => {
    const id = sourceIdSchema.safeParse(c.req.param('id'));
    if (!id.success) bad('unknown source', 404);
    const row = await getSourceRow(ctx, id.data);
    const { items, courses, courseContent, jobs } = await import('../db/schema.js');
    const { and, desc, eq, isNull, sql } = await import('drizzle-orm');
    const perCourse = await ctx.db
      .select({ courseId: items.courseId, kind: items.kind, n: sql<number>`count(*)` })
      .from(items)
      .where(and(eq(items.source, id.data), isNull(items.deletedAt)))
      .groupBy(items.courseId, items.kind);
    const courseRows = await ctx.db.select({ id: courses.id, code: courses.code, canvasCourseId: courses.canvasCourseId, gradescopeCourseId: courses.gradescopeCourseId, role: courses.role, archived: courses.archived }).from(courses);
    const recent = await ctx.db
      .select({ id: items.id, kind: items.kind, title: items.title, courseId: items.courseId, dueAt: items.dueAt, startsAt: items.startsAt, status: items.status, url: items.url, updatedAt: items.updatedAt, labels: items.labels })
      .from(items)
      .where(and(eq(items.source, id.data), isNull(items.deletedAt)))
      .orderBy(desc(items.updatedAt))
      .limit(30);
    const content =
      id.data === 'canvas' || id.data === 'gradescope'
        ? await ctx.db.select({ courseId: courseContent.courseId, kind: courseContent.kind, n: sql<number>`count(*)` }).from(courseContent).groupBy(courseContent.courseId, courseContent.kind)
        : [];
    const jobStats = id.data === 'jobs' ? await ctx.db.select({ total: sql<number>`count(*)`, matched: sql<number>`sum(case when ${jobs.matchesFilter} and ${jobs.active} then 1 else 0 end)` }).from(jobs) : [];
    const byCourse = courseRows
      .filter((k) => !k.archived)
      .map((k) => ({
        courseId: k.id,
        code: k.code,
        role: k.role,
        linkedId: id.data === 'canvas' ? k.canvasCourseId : id.data === 'gradescope' ? k.gradescopeCourseId : null,
        kinds: Object.fromEntries(perCourse.filter((p) => p.courseId === k.id).map((p) => [p.kind, p.n])),
        content: Object.fromEntries(content.filter((p) => p.courseId === k.id).map((p) => [p.kind, p.n])),
      }));
    const unassigned = Object.fromEntries(perCourse.filter((p) => !p.courseId).map((p) => [p.kind, p.n]));
    return c.json({ id: id.data, status: row.status, lastError: row.lastError, lastRun: (row.meta as { lastRun?: unknown }).lastRun ?? null, byCourse, unassigned, recent, jobs: jobStats[0] ?? null, total: perCourse.reduce((a, p) => a + p.n, 0) });
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
   * Canvas cookie drop-off for `collected connect canvas`. Accepts either the Access JWT (normal path) or the
   * helper key header, since a script can't do the Access login dance.
   */
  r.post('/canvas/cookie', async (c) => {
    const viaHelper = helperKeyMatches(ctx.env, c.req.header('x-collected-key'));
    const user = viaHelper ? 'helper' : await verifyAccess(ctx, c);
    if (!user) return c.json({ error: 'unauthorized' }, 401);
    const body = await parseBody(c, z.object({ cookieHeader: z.string().min(10), baseUrl: outboundUrlSchema.optional() }));
    const existing = (await getSourceConfig<{ baseUrl?: string }>(ctx, 'canvas')) ?? {};
    const baseUrl = body.baseUrl ?? existing.baseUrl;
    if (!baseUrl) bad('Canvas URL is not set: include baseUrl, or save it once in Settings → Sources', 422);
    await setSourceConfig(ctx, 'canvas', {
      baseUrl,
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
