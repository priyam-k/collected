import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { jobsFilterSchema, type Job } from '@collected/shared';
import { upsertListings, type SimplifyListing } from '@collected/core/ingest/jobs/ingest';
import { setSetting } from '@collected/core/lib/settings';
import { testContext } from '../test-util.js';
import { jobsRoutes, today } from './jobs.js';
import sample from '@collected/core/ingest/jobs/fixtures/listings.sample.json' with { type: 'json' };
import seed from '../../../artifacts/seed-config.json' with { type: 'json' };

const json = (body: unknown, method = 'POST') => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('jobs tracker API', () => {
  it('manual entries live in the tracker only; feed rows get applied_at stamped on the way in', async () => {
    const ctx = await testContext();
    await setSetting(ctx, 'jobs.filter', jobsFilterSchema.parse({ ...seed.jobs.filter, categories_include: [] }));
    await upsertListings(ctx, 'simplify', sample as SimplifyListing[]);
    const app = new Hono().route('/api/jobs', jobsRoutes(ctx));

    const created = await app.request('/api/jobs', json({ company: 'Acme', title: 'SWE Intern', url: 'https://acme.test/jobs/1', locations: ['Remote'], notes: 'referral from J' }));
    expect(created.status).toBe(201);
    const manual = (await created.json()) as Job;
    expect(manual.source).toBe('manual');
    expect(manual.state).toBe('applied');
    expect(manual.appliedAt).toBe(today());

    const feed = (await (await app.request('/api/jobs?matchesOnly=0&includeHidden=1&active=0')).json()) as Job[];
    expect(feed.some((j) => j.id === manual.id)).toBe(false);
    expect(feed.length).toBeGreaterThan(0);

    let tracked = (await (await app.request('/api/jobs/tracked')).json()) as Job[];
    expect(tracked.map((j) => j.id)).toEqual([manual.id]);

    // Star a feed job, then move it to interviewing: applied_at is stamped once and kept.
    const feedJob = feed[0]!;
    await app.request(`/api/jobs/${encodeURIComponent(feedJob.id)}/state`, json({ state: 'starred' }, 'PATCH'));
    let r = (await (await app.request(`/api/jobs/${encodeURIComponent(feedJob.id)}/state`, json({ state: 'interviewing', nextAction: 'phone screen', nextActionAt: '2026-09-15' }, 'PATCH'))).json()) as Job;
    expect(r.state).toBe('interviewing');
    expect(r.appliedAt).toBe(today());
    expect(r.nextAction).toBe('phone screen');
    r = (await (await app.request(`/api/jobs/${encodeURIComponent(feedJob.id)}/state`, json({ state: 'offer' }, 'PATCH'))).json()) as Job;
    expect(r.appliedAt).toBe(today());
    r = (await (await app.request(`/api/jobs/${encodeURIComponent(feedJob.id)}/state`, json({ appliedAt: '2026-09-01' }, 'PATCH'))).json()) as Job;
    expect(r.appliedAt).toBe('2026-09-01');

    tracked = (await (await app.request('/api/jobs/tracked')).json()) as Job[];
    expect(tracked.map((j) => j.id).sort()).toEqual([manual.id, feedJob.id].sort());
    expect(tracked[0]!.id).toBe(feedJob.id); // most recently touched first

    const single = (await (await app.request(`/api/jobs/${encodeURIComponent(manual.id)}`)).json()) as Job;
    expect(single.company).toBe('Acme');

    const stats = (await (await app.request('/api/jobs/stats')).json()) as { total: number; tracked: number };
    expect(stats.tracked).toBe(2);
    expect(stats.total).toBe(feed.length); // manual rows are not feed rows

    expect((await app.request(`/api/jobs/${encodeURIComponent(feedJob.id)}`, { method: 'DELETE' })).status).toBe(400);
    expect((await app.request(`/api/jobs/${encodeURIComponent(manual.id)}`, { method: 'DELETE' })).status).toBe(200);
    expect((await app.request(`/api/jobs/${encodeURIComponent(manual.id)}`)).status).toBe(404);
    expect((await app.request('/api/jobs', json({ company: '', title: 'x' }))).status).toBe(422);
    expect((await app.request(`/api/jobs/${encodeURIComponent(feedJob.id)}/state`, json({ appliedAt: 'yesterday' }, 'PATCH'))).status).toBe(422);
  });
});
