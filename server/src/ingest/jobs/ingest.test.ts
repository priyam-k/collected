import { describe, expect, it } from 'vitest';
import { jobsFilterSchema } from '@collected/shared';
import { jobState, jobs } from '../../db/schema.js';
import { setSetting } from '../../lib/settings.js';
import { testContext } from '../../test-util.js';
import { recomputeMatches, upsertListings, type SimplifyListing } from './ingest.js';
import sample from './fixtures/listings.sample.json' with { type: 'json' };
import seed from '../../../../artifacts/seed-config.json' with { type: 'json' };

describe('jobs ingester', () => {
  it('upserts listings idempotently and keeps job_state across runs', async () => {
    const ctx = await testContext();
    await setSetting(ctx, 'jobs.filter', jobsFilterSchema.parse(seed.jobs.filter));
    const listings = sample as SimplifyListing[];

    const first = await upsertListings(ctx, 'simplify', listings);
    expect(first.upserted).toBe(listings.length);
    expect(first.created).toBe(listings.length);

    // Star one, then re-run: state must survive, no duplicate rows.
    const starred = `simplify:${listings[0]!.id}`;
    await ctx.db.update(jobState).set({ state: 'starred' }).where((await import('drizzle-orm')).eq(jobState.jobId, starred));
    const second = await upsertListings(ctx, 'simplify', listings.map((l) => ({ ...l, title: l.title + ' (updated)' })));
    expect(second.created).toBe(0);
    const rows = await ctx.db.select().from(jobs);
    expect(rows.length).toBe(listings.length);
    expect(rows.every((r) => r.title.endsWith('(updated)'))).toBe(true);
    const st = await ctx.db.select().from(jobState);
    expect(st.find((s) => s.jobId === starred)?.state).toBe('starred');
  });

  it('recomputes matches after a filter change', async () => {
    const ctx = await testContext();
    await setSetting(ctx, 'jobs.filter', jobsFilterSchema.parse({ ...seed.jobs.filter, categories_include: [] }));
    await upsertListings(ctx, 'simplify', sample as SimplifyListing[]);
    const before = (await ctx.db.select().from(jobs)).filter((j) => j.matchesFilter).length;
    await setSetting(ctx, 'jobs.filter', jobsFilterSchema.parse({ title_include: 'zzz-no-such-title', categories_include: [] }));
    const after = await recomputeMatches(ctx);
    expect(after.matched).toBe(0);
    expect(before).toBeGreaterThanOrEqual(0);
  });
});
