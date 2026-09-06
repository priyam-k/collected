import { Hono } from 'hono';
import { and, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { JOB_STATES, jobStatePatchSchema, type Job } from '@collected/shared';
import type { AppContext } from '../context.js';
import { jobState, jobs } from '../db/schema.js';
import { recomputeMatches } from '../ingest/jobs/ingest.js';
import { bad, csv, parseBody } from './util.js';

export function jobsRoutes(ctx: AppContext) {
  const r = new Hono();

  r.get('/', async (c) => {
    const q = c.req.query();
    const states = csv(q.state)?.filter((s) => (JOB_STATES as readonly string[]).includes(s));
    const conds: SQL[] = [];
    if (q.matchesOnly !== '0' && q.matchesOnly !== 'false') conds.push(eq(jobs.matchesFilter, true));
    if (q.active !== '0' && q.active !== 'false') conds.push(eq(jobs.active, true));
    if (states?.length) conds.push(inArray(jobState.state, states));
    else if (q.includeHidden !== '1') conds.push(sql`${jobState.state} != 'hidden'`);
    if (q.since) conds.push(sql`${jobs.postedAt} >= ${q.since}`);
    const limit = Math.min(Number(q.limit ?? 200), 1000);
    const rows = await ctx.db
      .select({ job: jobs, state: jobState })
      .from(jobs)
      .leftJoin(jobState, eq(jobState.jobId, jobs.id))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(jobs.postedAt), desc(jobs.firstSeenAt))
      .limit(limit);
    const out: Job[] = rows.map(({ job, state }) => ({
      ...job,
      state: (state?.state ?? 'new') as Job['state'],
      notes: state?.notes ?? null,
      seenAt: state?.seenAt ?? null,
    }));
    return c.json(out);
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
      .leftJoin(jobState, eq(jobState.jobId, jobs.id));
    return c.json(row ?? { total: 0, active: 0, matched: 0, unseen: 0 });
  });

  r.patch('/seen', async (c) => {
    const { ids } = await parseBody(c, z.object({ ids: z.array(z.string()).min(1).max(500) }));
    const now = new Date().toISOString();
    await ctx.db.update(jobState).set({ seenAt: now }).where(and(inArray(jobState.jobId, ids), isNull(jobState.seenAt)));
    return c.json({ ok: true });
  });

  r.post('/recompute', async (c) => c.json(await recomputeMatches(ctx)));

  r.patch('/:id/state', async (c) => {
    const id = c.req.param('id');
    const job = await ctx.db.query.jobs.findFirst({ where: eq(jobs.id, id) });
    if (!job) bad('job not found', 404);
    const body = await parseBody(c, jobStatePatchSchema);
    await ctx.db
      .insert(jobState)
      .values({ jobId: id, ...body })
      .onConflictDoUpdate({ target: jobState.jobId, set: { ...body, updatedAt: new Date().toISOString() } });
    return c.json(await ctx.db.query.jobState.findFirst({ where: eq(jobState.jobId, id) }));
  });

  return r;
}
