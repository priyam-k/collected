import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { and, desc, eq, inArray, isNull, ne, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { extractReqId, isAppliedStage, isReservedStage, jobStagesBodySchema, jobStatePatchSchema, manualJobInputSchema, normalizeJobUrl, type Job, type JobStage } from '@collected/shared';
import type { AppContext } from '../context.js';
import { jobState, jobs, type JobRow, type JobStateRow } from '@collected/core/db/schema';
import { recomputeMatches } from '@collected/core/ingest/jobs/ingest';
import { ensureStage, getJobStages, setJobStages } from '@collected/core/lib/job-stages';
import { bad, csv, intParam, parseBody } from './util.js';

export const MANUAL_SOURCE = 'manual';

export const toJob = (job: JobRow, state: JobStateRow | null | undefined): Job => ({
  ...job,
  state: state?.state ?? 'new',
  notes: state?.notes ?? null,
  seenAt: state?.seenAt ?? null,
  appliedAt: state?.appliedAt ?? null,
  nextAction: state?.nextAction ?? null,
  nextActionAt: state?.nextActionAt ?? null,
  resumePath: state?.resumePath ?? null,
  stateUpdatedAt: state?.updatedAt ?? null,
});

/** Today as YYYY-MM-DD in the server's TZ (dates in the tracker are days, not instants). */
export const today = () => new Date().toLocaleDateString('en-CA');

/** `coalesce(job_state.state, 'new')`: a job with no state row is `new`. */
const stateExpr = sql`coalesce(${jobState.state}, 'new')`;
/** Tracked = shows in the Applications widget: any state but `new` and `hidden`, listed stage or not. */
const trackedCond = sql`${stateExpr} not in ('new', 'hidden')`;

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (ch) => `\\${ch}`);

/**
 * `?query=`: every word must appear in the company, title, locations or notes (case-insensitive), or equal the
 * requisition id. Returns null for an empty query. Words are capped so a pasted paragraph cannot build a huge WHERE.
 */
export function searchConds(query: string | undefined): SQL | null {
  const words = (query ?? '')
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean)
    .slice(0, 12);
  if (!words.length) return null;
  const per = words.map((w) => {
    const like = `%${escapeLike(w)}%`;
    return sql`(lower(${jobs.company}) like ${like} escape '\\' or lower(${jobs.title}) like ${like} escape '\\' or lower(${jobs.locations}) like ${like} escape '\\' or lower(coalesce(${jobState.notes}, '')) like ${like} escape '\\' or lower(coalesce(${jobs.reqId}, '')) = ${w})`;
  });
  return and(...per) ?? null;
}

/** A comma list of states from the query string, bounded the way the stage schema bounds an id. */
const statesParam = (v: string | undefined): string[] | undefined => csv(v)?.map((s) => s.toLowerCase().slice(0, 40));

export function jobsRoutes(ctx: AppContext) {
  const r = new Hono();

  const load = async (id: string) => {
    const [row] = await ctx.db.select({ job: jobs, state: jobState }).from(jobs).leftJoin(jobState, eq(jobState.jobId, jobs.id)).where(eq(jobs.id, id)).limit(1);
    return row ?? null;
  };

  /** Jobs whose normalised URL or requisition id matches; `exceptId` leaves the job being edited out. */
  const findMatches = async (opts: { url?: string | null; reqId?: string | null; source?: string; exceptId?: string }): Promise<Job[]> => {
    const conds: SQL[] = [];
    const key = opts.url ? normalizeJobUrl(opts.url) : '';
    if (key) {
      // Candidates by substring on the host+path (cheap, indexed nowhere but bounded by LIKE), exact by normalising each.
      const needle = `%${escapeLike(key.split('?')[0]!)}%`;
      conds.push(sql`lower(${jobs.url}) like ${needle} escape '\\'`);
    }
    if (opts.reqId) {
      const req = opts.reqId.toLowerCase();
      conds.push(opts.source ? and(eq(jobs.source, opts.source), sql`lower(${jobs.reqId}) = ${req}`)! : sql`lower(${jobs.reqId}) = ${req}`);
    }
    if (!conds.length) return [];
    const rows = await ctx.db
      .select({ job: jobs, state: jobState })
      .from(jobs)
      .leftJoin(jobState, eq(jobState.jobId, jobs.id))
      .where(and(or(...conds), opts.exceptId ? ne(jobs.id, opts.exceptId) : undefined))
      .orderBy(desc(jobState.updatedAt), desc(jobs.firstSeenAt))
      .limit(200);
    const req = opts.reqId?.toLowerCase();
    return rows.filter(({ job }) => (key && normalizeJobUrl(job.url) === key) || (req && job.reqId?.toLowerCase() === req && (!opts.source || job.source === opts.source))).map(({ job, state }) => toJob(job, state));
  };

  /** The feed: listings from the job sources. Manual entries live only in the tracker. */
  r.get('/', async (c) => {
    const q = c.req.query();
    const states = statesParam(q.state);
    const conds: (SQL | undefined)[] = [ne(jobs.source, MANUAL_SOURCE)];
    if (q.matchesOnly !== '0' && q.matchesOnly !== 'false') conds.push(eq(jobs.matchesFilter, true));
    if (q.active !== '0' && q.active !== 'false') conds.push(eq(jobs.active, true));
    if (states?.length) conds.push(inArray(stateExpr, states));
    else if (q.includeHidden !== '1') conds.push(sql`${stateExpr} != 'hidden'`);
    if (q.since) conds.push(sql`${jobs.postedAt} >= ${q.since}`);
    const search = searchConds(q.query);
    if (search) conds.push(search);
    const limit = intParam(q.limit, { max: 1000, def: 200 });
    const rows = await ctx.db
      .select({ job: jobs, state: jobState })
      .from(jobs)
      .leftJoin(jobState, eq(jobState.jobId, jobs.id))
      .where(and(...conds))
      .orderBy(desc(jobs.postedAt), desc(jobs.firstSeenAt))
      .limit(limit);
    return c.json(rows.map(({ job, state }) => toJob(job, state)));
  });

  r.get('/stats', async (c) => {
    const [row] = await ctx.db
      .select({
        total: sql<number>`count(*)`,
        active: sql<number>`sum(case when ${jobs.active} then 1 else 0 end)`,
        matched: sql<number>`sum(case when ${jobs.matchesFilter} and ${jobs.active} then 1 else 0 end)`,
        unseen: sql<number>`sum(case when ${jobs.matchesFilter} and ${jobs.active} and ${jobState.seenAt} is null and coalesce(${jobState.state},'new') != 'hidden' then 1 else 0 end)`,
      })
      .from(jobs)
      .leftJoin(jobState, eq(jobState.jobId, jobs.id))
      .where(ne(jobs.source, MANUAL_SOURCE));
    const stages = await getJobStages(ctx);
    const perState = await ctx.db
      .select({ state: jobState.state, n: sql<number>`count(*)` })
      .from(jobState)
      .where(notInArray(jobState.state, ['new', 'hidden']))
      .groupBy(jobState.state);
    const byStage: Record<string, number> = { starred: 0 };
    for (const s of stages) byStage[s.id] = 0;
    let tracked = 0;
    for (const p of perState) {
      byStage[p.state] = Number(p.n);
      tracked += Number(p.n);
    }
    return c.json({ total: 0, active: 0, matched: 0, unseen: 0, ...row, tracked, byStage });
  });

  /** The ordered stage list the board draws (DECISIONS 063). Reserved markers are never in it. */
  r.get('/stages', async (c) => c.json({ stages: await getJobStages(ctx) }));

  /**
   * Replaces the whole list. A stage that disappears while jobs sit in it is refused (409) so a column cannot vanish
   * with its cards; move or re-stage them first. Reserved ids, duplicates and an all-closed list fail validation.
   */
  r.put('/stages', async (c) => {
    const { stages } = await parseBody(c, jobStagesBodySchema);
    const before = await getJobStages(ctx);
    const keep = new Set(stages.map((s) => s.id));
    const gone = before.filter((s) => !keep.has(s.id)).map((s) => s.id);
    if (gone.length) {
      const used = await ctx.db.select({ state: jobState.state, n: sql<number>`count(*)` }).from(jobState).where(inArray(jobState.state, gone)).groupBy(jobState.state);
      if (used.length) bad(`stage${used.length > 1 ? 's' : ''} still in use: ${used.map((u) => `${u.state} (${u.n})`).join(', ')}; move those jobs first`, 409);
    }
    await setJobStages(ctx, stages as JobStage[]);
    return c.json({ stages });
  });

  /** Everything saved or applied to, feed and manual alike, most recently touched first. */
  r.get('/tracked', async (c) => {
    const q = c.req.query();
    const states = statesParam(q.state);
    const conds: (SQL | undefined)[] = [states?.length ? inArray(jobState.state, states) : trackedCond];
    const search = searchConds(q.query);
    if (search) conds.push(search);
    const limit = intParam(q.limit, { max: 1000, def: 1000 });
    const rows = await ctx.db
      .select({ job: jobs, state: jobState })
      .from(jobs)
      .innerJoin(jobState, eq(jobState.jobId, jobs.id))
      .where(and(...conds))
      .orderBy(desc(jobState.updatedAt))
      .limit(limit);
    return c.json(rows.map(({ job, state }) => toJob(job, state)));
  });

  /** Exact lookups for dedupe: `?req=<id>` (any source) or `?url=<posting url>` (normalised). Both may be given. */
  r.get('/find', async (c) => {
    const req = c.req.query('req')?.trim();
    const url = c.req.query('url')?.trim();
    if (!req && !url) bad('give ?req=<requisition id> or ?url=<posting url>');
    if ((req?.length ?? 0) > 80 || (url?.length ?? 0) > 2048) bad('req or url too long');
    return c.json(await findMatches({ url, reqId: req }));
  });

  r.patch('/seen', async (c) => {
    const { ids } = await parseBody(c, z.object({ ids: z.array(z.string()).min(1).max(500) }));
    const now = new Date().toISOString();
    await ctx.db.update(jobState).set({ seenAt: now }).where(and(inArray(jobState.jobId, ids), isNull(jobState.seenAt)));
    return c.json({ ok: true });
  });

  r.post('/recompute', async (c) => c.json(await recomputeMatches(ctx)));

  /**
   * Add a job by hand. It goes straight into the tracker and never shows in the feed. A posting already here under the
   * same normalised URL or requisition id answers 409 with the existing job unless `?force=1`.
   */
  r.post('/', async (c) => {
    const body = await parseBody(c, manualJobInputSchema);
    const reqId = body.reqId ?? (body.url ? extractReqId(body.url) : null);
    if (c.req.query('force') !== '1') {
      const [existing] = await findMatches({ url: body.url || null, reqId });
      if (existing) return c.json({ error: `already here: ${existing.company} · ${existing.title} (${existing.id}); add ?force=1 to add it anyway`, existing }, 409);
    }
    if (reqId) {
      const [clash] = await findMatches({ reqId, source: MANUAL_SOURCE });
      if (clash) return c.json({ error: `requisition id ${reqId} is already on ${clash.company} · ${clash.title} (${clash.id})`, existing: clash }, 409);
    }
    const stages = await ensureStage(ctx, body.state);
    const externalId = randomUUID();
    const id = `${MANUAL_SOURCE}:${externalId}`;
    const now = new Date().toISOString();
    await ctx.db.transaction(async (tx) => {
      await tx.insert(jobs).values({
        id,
        source: MANUAL_SOURCE,
        externalId,
        company: body.company,
        title: body.title,
        locations: body.locations,
        url: body.url,
        reqId,
        terms: [],
        sponsorship: null,
        degrees: [],
        category: null,
        postedAt: now,
        active: true,
        visible: true,
        matchesFilter: false,
      });
      await tx.insert(jobState).values({
        jobId: id,
        state: body.state,
        notes: body.notes ?? null,
        resumePath: body.resumePath ?? null,
        nextAction: body.nextAction ?? null,
        nextActionAt: body.nextActionAt ?? null,
        appliedAt: body.appliedAt ?? (isAppliedStage(stages, body.state) ? today() : null),
        seenAt: now,
      });
    });
    const row = await load(id);
    ctx.log.info({ job: id, company: body.company }, 'manual job added');
    return c.json(toJob(row!.job, row!.state), 201);
  });

  r.get('/:id', async (c) => {
    const row = await load(c.req.param('id'));
    if (!row) bad('job not found', 404);
    return c.json(toJob(row.job, row.state));
  });

  /** Only manual entries can be deleted; feed listings are hidden instead so the next sync doesn't bring them back. */
  r.delete('/:id', async (c) => {
    const id = c.req.param('id');
    const row = await load(id);
    if (!row) bad('job not found', 404);
    if (row.job.source !== MANUAL_SOURCE) bad('only manual entries can be deleted; hide feed listings instead', 400);
    await ctx.db.transaction(async (tx) => {
      await tx.delete(jobState).where(eq(jobState.jobId, id));
      await tx.delete(jobs).where(eq(jobs.id, id));
    });
    return c.json({ ok: true });
  });

  /**
   * The tracker fields and the state. Any stage id is accepted: an unlisted one is appended to `jobs.stages` first.
   * `reqId` lives on the job row and is unique per source, so a clash is a 409 naming the job that has it.
   */
  r.patch('/:id/state', async (c) => {
    const id = c.req.param('id');
    const row = await load(id);
    if (!row) bad('job not found', 404);
    const { reqId, ...body } = await parseBody(c, jobStatePatchSchema);
    if (reqId !== undefined && reqId !== row.job.reqId) {
      if (reqId) {
        const [clash] = await findMatches({ reqId, source: row.job.source, exceptId: id });
        if (clash) return c.json({ error: `requisition id ${reqId} is already on ${clash.company} · ${clash.title} (${clash.id})`, existing: clash }, 409);
      }
      await ctx.db.update(jobs).set({ reqId: reqId ?? null }).where(eq(jobs.id, id));
    }
    const patch: Partial<JobStateRow> = { ...body };
    if (body.state && !isReservedStage(body.state)) {
      const stages = await ensureStage(ctx, body.state);
      if (isAppliedStage(stages, body.state) && body.appliedAt === undefined && !row.state?.appliedAt) patch.appliedAt = today();
    }
    const set = { ...patch, updatedAt: new Date().toISOString() };
    await ctx.db.insert(jobState).values({ jobId: id, ...set }).onConflictDoUpdate({ target: jobState.jobId, set });
    const updated = await load(id);
    return c.json(toJob(updated!.job, updated!.state));
  });

  return r;
}
