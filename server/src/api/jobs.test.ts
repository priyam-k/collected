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

describe('jobs stages, requisition ids, search and dedupe', () => {
  const setup = async () => {
    const ctx = await testContext();
    await setSetting(ctx, 'jobs.filter', jobsFilterSchema.parse({ ...seed.jobs.filter, categories_include: [] }));
    await upsertListings(ctx, 'simplify', sample as SimplifyListing[]);
    const app = new Hono().route('/api/jobs', jobsRoutes(ctx));
    const get = async <T>(p: string) => (await (await app.request(p)).json()) as T;
    return { ctx, app, get };
  };
  type Stages = { stages: { id: string; label: string; kind: 'open' | 'closed'; appliedStage?: boolean }[] };

  it('starts with the default stages and appends an unknown one on first use', async () => {
    const { app, get } = await setup();
    const { stages } = await get<Stages>('/api/jobs/stages');
    expect(stages.map((s) => s.id)).toEqual(['applied', 'screen', 'interviewing', 'offer', 'rejected', 'ghosted', 'withdrawn']);
    expect(stages.find((s) => s.id === 'screen')).toEqual({ id: 'screen', label: 'Screen', kind: 'open', appliedStage: true });
    expect(stages.find((s) => s.id === 'rejected')?.kind).toBe('closed');

    const feed = await get<Job[]>('/api/jobs?matchesOnly=0&includeHidden=1&active=0');
    const job = feed[0]!;
    const r = await app.request(`/api/jobs/${encodeURIComponent(job.id)}/state`, json({ state: ' OA ' }, 'PATCH'));
    expect(r.status).toBe(200);
    expect(((await r.json()) as Job).state).toBe('oa');
    const after = await get<Stages>('/api/jobs/stages');
    expect(after.stages.at(-1)).toEqual({ id: 'oa', label: 'Oa', kind: 'open' });
    // Not an applied stage: no applied date was stamped.
    expect((await get<Job>(`/api/jobs/${encodeURIComponent(job.id)}`)).appliedAt).toBeNull();
    // The tracker and the stats see it.
    expect((await get<Job[]>('/api/jobs/tracked')).map((j) => j.id)).toEqual([job.id]);
    expect((await get<Job[]>('/api/jobs/tracked?state=oa')).map((j) => j.id)).toEqual([job.id]);
    const stats = await get<{ tracked: number; byStage: Record<string, number> }>('/api/jobs/stats');
    expect(stats.tracked).toBe(1);
    expect(stats.byStage).toMatchObject({ starred: 0, applied: 0, oa: 1 });
    // Reserved markers never become stages.
    await app.request(`/api/jobs/${encodeURIComponent(job.id)}/state`, json({ state: 'starred' }, 'PATCH'));
    expect((await get<Stages>('/api/jobs/stages')).stages.some((s) => s.id === 'starred')).toBe(false);
    // Malformed ids are refused.
    expect((await app.request(`/api/jobs/${encodeURIComponent(job.id)}/state`, json({ state: 'Nope!' }, 'PATCH'))).status).toBe(422);
    expect((await app.request(`/api/jobs/${encodeURIComponent(job.id)}/state`, json({ state: '' }, 'PATCH'))).status).toBe(422);
  });

  it('PUT /stages replaces the list, validates it, and refuses to drop a stage with jobs in it', async () => {
    const { app, get } = await setup();
    const { stages } = await get<Stages>('/api/jobs/stages');
    const put = (body: unknown) => app.request('/api/jobs/stages', json(body, 'PUT'));
    // Reorder and relabel.
    const reordered = [{ id: 'oa', label: 'Online assessment', kind: 'open' as const }, ...stages.map((s) => (s.id === 'offer' ? { ...s, label: 'Offer!' } : s))];
    expect((await put({ stages: reordered })).status).toBe(200);
    const now = await get<Stages>('/api/jobs/stages');
    expect(now.stages[0]!.id).toBe('oa');
    expect(now.stages.find((s) => s.id === 'offer')?.label).toBe('Offer!');
    // Validation: duplicates, reserved ids, no open stage, empty.
    expect((await put({ stages: [...stages, stages[0]] })).status).toBe(422);
    expect((await put({ stages: [...stages, { id: 'hidden', label: 'Hidden', kind: 'open' }] })).status).toBe(422);
    expect((await put({ stages: stages.filter((s) => s.kind === 'closed') })).status).toBe(422);
    expect((await put({ stages: [] })).status).toBe(422);
    expect((await put({ stages: [{ id: 'Bad Id!', label: 'x', kind: 'open' }] })).status).toBe(422);
    // A stage with a job in it cannot be removed.
    const feed = await get<Job[]>('/api/jobs?matchesOnly=0&includeHidden=1&active=0');
    await app.request(`/api/jobs/${encodeURIComponent(feed[0]!.id)}/state`, json({ state: 'screen' }, 'PATCH'));
    const current = (await get<Stages>('/api/jobs/stages')).stages;
    const refused = await put({ stages: current.filter((s) => s.id !== 'screen') });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toMatch(/screen \(1\)/);
    // Removing an empty one is fine.
    expect((await put({ stages: current.filter((s) => s.id !== 'oa') })).status).toBe(200);
    expect((await get<Stages>('/api/jobs/stages')).stages.some((s) => s.id === 'oa')).toBe(false);
  });

  it('feed rows carry the requisition id from their URL; a tracked job can be given one, unique per source', async () => {
    const { app, get } = await setup();
    const feed = await get<Job[]>('/api/jobs?matchesOnly=0&includeHidden=1&active=0&limit=1000');
    const gh = feed.find((j) => j.url.includes('greenhouse.io/colabsoftware/jobs/5022855008'))!;
    expect(gh.reqId).toBe('5022855008');
    const wd = feed.find((j) => j.url.endsWith('_R162234'))!;
    expect(wd.reqId).toBe('R162234');
    const none = feed.find((j) => j.url.includes('smartrecruiters.com/Experian/'))!;
    expect(none.reqId).toBeNull();

    // Give the one without an id one; a second feed job may not take the same id.
    let r = await app.request(`/api/jobs/${encodeURIComponent(none.id)}/state`, json({ reqId: 'EXP-2026-7' }, 'PATCH'));
    expect(r.status).toBe(200);
    expect(((await r.json()) as Job).reqId).toBe('EXP-2026-7');
    r = await app.request(`/api/jobs/${encodeURIComponent(wd.id)}/state`, json({ reqId: 'exp-2026-7' }, 'PATCH'));
    expect(r.status).toBe(409);
    expect(((await r.json()) as { existing: Job }).existing.id).toBe(none.id);
    // Clearing it, and a malformed one.
    r = await app.request(`/api/jobs/${encodeURIComponent(none.id)}/state`, json({ reqId: null }, 'PATCH'));
    expect(((await r.json()) as Job).reqId).toBeNull();
    expect((await app.request(`/api/jobs/${encodeURIComponent(none.id)}/state`, json({ reqId: 'has space' }, 'PATCH'))).status).toBe(422);
  });

  it('find answers exact matches by req id and by normalised URL', async () => {
    const { get } = await setup();
    const byReq = await get<Job[]>('/api/jobs/find?req=5022855008');
    expect(byReq.map((j) => j.url)).toEqual(['https://job-boards.greenhouse.io/colabsoftware/jobs/5022855008']);
    expect(await get<Job[]>('/api/jobs/find?req=502285500')).toEqual([]); // not a prefix match
    const byUrl = await get<Job[]>(`/api/jobs/find?url=${encodeURIComponent('http://www.job-boards.greenhouse.io/colabsoftware/jobs/5022855008/?gh_src=xyz#x')}`);
    expect(byUrl.map((j) => j.reqId)).toEqual(['5022855008']);
    expect(await get<Job[]>(`/api/jobs/find?url=${encodeURIComponent('https://job-boards.greenhouse.io/colabsoftware/jobs/50228550')}`)).toEqual([]);
    expect((await (await setup()).app.request('/api/jobs/find')).status).toBe(400);
  });

  it('manual add dedupes by URL and req id with a 409 carrying the existing job, unless forced', async () => {
    const { app, get } = await setup();
    const add = (body: unknown, force = false) => app.request(`/api/jobs${force ? '?force=1' : ''}`, json(body));
    const first = await add({ company: 'Acme', title: 'SWE Intern', url: 'https://boards.greenhouse.io/acme/jobs/4242424242?gh_src=linkedin', state: 'oa' });
    expect(first.status).toBe(201);
    const acme = (await first.json()) as Job;
    expect(acme.reqId).toBe('4242424242'); // read out of the URL
    expect(acme.state).toBe('oa');
    expect(acme.appliedAt).toBeNull(); // oa is not an applied stage
    expect((await get<Stages>('/api/jobs/stages')).stages.some((s) => s.id === 'oa')).toBe(true);

    // Same posting, different tracking link: refused with the existing job.
    const dup = await add({ company: 'ACME Corp', title: 'Software Engineering Intern', url: 'http://boards.greenhouse.io/acme/jobs/4242424242/?utm_source=simplify' });
    expect(dup.status).toBe(409);
    const body = (await dup.json()) as { error: string; existing: Job };
    expect(body.existing.id).toBe(acme.id);
    expect(body.error).toMatch(/force=1/);
    // Same req id typed by hand, no URL: also refused.
    expect((await add({ company: 'Acme', title: 'Other', reqId: '4242424242' })).status).toBe(409);
    // A feed posting's req id typed by hand: the feed job comes back as the existing one.
    const fromFeed = await add({ company: 'CoLab', title: 'Intern', reqId: '5022855008' });
    expect(fromFeed.status).toBe(409);
    expect(((await fromFeed.json()) as { existing: Job }).existing.source).toBe('simplify');
    // Forced: a second manual row, but it cannot hold the same req id as the first manual one.
    expect((await add({ company: 'Acme', title: 'Other', reqId: '4242424242' }, true)).status).toBe(409);
    const forced = await add({ company: 'Acme', title: 'Other', url: 'https://boards.greenhouse.io/acme/jobs/4242424242', reqId: null }, true);
    expect(forced.status).toBe(409); // the URL still yields the id
    const forcedNoUrl = await add({ company: 'Acme', title: 'Other' }, true);
    expect(forcedNoUrl.status).toBe(201);
    expect(((await forcedNoUrl.json()) as Job).appliedAt).toBe(today()); // default state applied stamps today

    // Full manual body round-trips.
    const full = (await (await add({ company: 'Beta', title: 'Intern', locations: ['NYC'], state: 'interviewing', appliedAt: '2026-10-01', notes: 'via referral', resumePath: '~/resumes/beta.pdf', nextAction: 'onsite', nextActionAt: '2026-11-20' })).json()) as Job;
    expect(full).toMatchObject({ state: 'interviewing', appliedAt: '2026-10-01', notes: 'via referral', resumePath: '~/resumes/beta.pdf', nextAction: 'onsite', nextActionAt: '2026-11-20', locations: ['NYC'], reqId: null });
  });

  it('query searches company, title, locations, notes and the exact req id, every word matching', async () => {
    const { app, get } = await setup();
    const feed = await get<Job[]>('/api/jobs?matchesOnly=0&includeHidden=1&active=0&limit=1000');
    const target = feed.find((j) => j.url.includes('greenhouse.io/colabsoftware'))!;
    await app.request(`/api/jobs/${encodeURIComponent(target.id)}/state`, json({ state: 'applied', notes: 'talked to Priya at the career fair' }, 'PATCH'));
    const q = (s: string, base = '/api/jobs?matchesOnly=0&includeHidden=1&active=0&limit=1000') => get<Job[]>(`${base}&query=${encodeURIComponent(s)}`);
    expect((await q(target.company)).some((j) => j.id === target.id)).toBe(true);
    expect((await q(`${target.company.split(' ')[0]} ${target.title.split(' ')[0]}`)).some((j) => j.id === target.id)).toBe(true);
    expect((await q('career fair')).map((j) => j.id)).toEqual([target.id]); // notes
    expect((await q('career zzzznotaword')).map((j) => j.id)).toEqual([]); // every word must match
    expect((await q('5022855008')).map((j) => j.id)).toEqual([target.id]); // req id, exact
    expect((await q('502285500')).map((j) => j.id)).toEqual([]);
    expect((await q('%')).length).toBe(0); // LIKE wildcards are literal
    const loc = feed.find((j) => j.locations.length)!;
    expect((await q(loc.locations[0]!.split(',')[0]!)).some((j) => j.id === loc.id)).toBe(true);
    // The tracked list takes the same query.
    expect((await get<Job[]>('/api/jobs/tracked?query=career%20fair')).map((j) => j.id)).toEqual([target.id]);
    expect(await get<Job[]>('/api/jobs/tracked?query=zzzznotaword')).toEqual([]);
  });
});
