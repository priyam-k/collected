import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { and, desc, eq, inArray, isNull, ne, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { APPLIED_STAGES, JOB_STATES, TRACKED_STATES, jobStatePatchSchema, manualJobInputSchema, type Job } from '@collected/shared';
import type { AppContext } from '../context.js';
import { jobState, jobs, type JobRow, type JobStateRow } from '../db/schema.js';
import { recomputeMatches } from '../ingest/jobs/ingest.js';
import { bad, csv, intParam, parseBody } from './util.js';

export const MANUAL_SOURCE = 'manual';

export const toJob = (job: JobRow, state: JobStateRow | null | undefined): Job => ({
  ...job,
  state: (state?.state ?? 'new') as Job['state'],
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

export function jobsRoutes(ctx: AppContext) {
  const r = new Hono();

  const load = async (id: string) => {
    const [row] = await ctx.db.select({ job: jobs, state: jobState }).from(jobs).leftJoin(jobState, eq(jobState.jobId, jobs.id)).where(eq(jobs.id, id)).limit(1);
    return row ?? null;
  };

  /** The feed: listings from the job sources. Manual entries live only in the tracker. */
  r.get('/', async (c) => {
    const q = c.req.query();
    const states = csv(q.state)?.filter((s) => (JOB_STATES as readonly string[]).includes(s));
    const conds: SQL[] = [ne(jobs.source, MANUAL_SOURCE)];
    if (q.matchesOnly !== '0' && q.matchesOnly !== 'false') conds.push(eq(jobs.matchesFilter, true));
    if (q.active !== '0' && q.active !== 'false') conds.push(eq(jobs.active, true));
    if (states?.length) conds.push(inArray(jobState.state, states));
    else if (q.includeHidden !== '1') conds.push(sql`coalesce(${jobState.state}, 'new') != 'hidden'`);
    if (q.since) conds.push(sql`${jobs.postedAt} >= ${q.since}`);
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
    const [tracked] = await ctx.db.select({ n: sql<number>`count(*)` }).from(jobState).where(inArray(jobState.state, [...TRACKED_STATES]));
    return c.json({ total: 0, active: 0, matched: 0, unseen: 0, ...row, tracked: tracked?.n ?? 0 });
  });

  /** Everything saved or applied to, feed and manual alike, most recently touched first. */
  r.get('/tracked', async (c) => {
    const rows = await ctx.db
      .select({ job: jobs, state: jobState })
      .from(jobs)
      .innerJoin(jobState, eq(jobState.jobId, jobs.id))
      .where(inArray(jobState.state, [...TRACKED_STATES]))
      .orderBy(desc(jobState.updatedAt));
    return c.json(rows.map(({ job, state }) => toJob(job, state)));
  });

  r.patch('/seen', async (c) => {
    const { ids } = await parseBody(c, z.object({ ids: z.array(z.string()).min(1).max(500) }));
    const now = new Date().toISOString();
    await ctx.db.update(jobState).set({ seenAt: now }).where(and(inArray(jobState.jobId, ids), isNull(jobState.seenAt)));
    return c.json({ ok: true });
  });

  r.post('/recompute', async (c) => c.json(await recomputeMatches(ctx)));

  /** Add a job by hand. It goes straight into the tracker and never shows in the feed. */
  r.post('/', async (c) => {
    const body = await parseBody(c, manualJobInputSchema);
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
        appliedAt: body.appliedAt ?? (APPLIED_STAGES.includes(body.state) ? today() : null),
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

  r.patch('/:id/state', async (c) => {
    const id = c.req.param('id');
    const row = await load(id);
    if (!row) bad('job not found', 404);
    const body = await parseBody(c, jobStatePatchSchema);
    const patch: Partial<JobStateRow> = { ...body };
    if (body.state && APPLIED_STAGES.includes(body.state) && body.appliedAt === undefined && !row.state?.appliedAt) patch.appliedAt = today();
    const set = { ...patch, updatedAt: new Date().toISOString() };
    await ctx.db.insert(jobState).values({ jobId: id, ...set }).onConflictDoUpdate({ target: jobState.jobId, set });
    const updated = await load(id);
    return c.json(toJob(updated!.job, updated!.state));
  });

  return r;
}
