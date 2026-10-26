import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { courses } from '../db/schema.js';
import { fixtureCanvasClient } from '../ingest/canvas/fixture-client.js';
import { setSourceConfig } from '../lib/sources.js';
import { testContext } from '../test-util.js';
import { onboardingRoutes, splitCourseCode, termSlug } from './onboarding.js';

describe('onboarding from Canvas enrollments', () => {
  it('derives term and code slugs from what Canvas returns', () => {
    expect(termSlug('Fall 2026')).toBe('2026-fall');
    expect(termSlug('2026 Spring')).toBe('2026-spring');
    expect(termSlug('Default Term')).toBe('default-term');
    expect(splitCourseCode('CMSC330-0101,0102,0103: Organization of Programming Languages', '')).toEqual({ code: 'CMSC330', section: '0101' });
    expect(splitCourseCode('Math423 Linear Optimization', '')).toEqual({ code: 'MATH423', section: null });
    expect(splitCourseCode('', 'CMSC422-0101: Introduction to Machine Learning')).toEqual({ code: 'CMSC422', section: '0101' });
  });

  it('lists active enrollments with suggestions, then creates the chosen ones once', async () => {
    const ctx = await testContext();
    await setSourceConfig(ctx, 'canvas', { baseUrl: 'https://umd.instructure.com', cookieHeader: 'canvas_session=abc' });
    const app = new Hono().route('/api/onboarding', onboardingRoutes({ ...ctx, env: { ...ctx.env, SCHEDULER_DISABLED: true } }, async () => fixtureCanvasClient()));

    const list = await app.request('/api/onboarding/canvas');
    expect(list.status).toBe(200);
    const { courses: found } = (await list.json()) as { courses: { canvasCourseId: string; role: string; trackedAs: string | null; suggested: { term: string; code: string } }[] };
    expect(found.length).toBeGreaterThanOrEqual(3);
    const ta = found.find((f) => f.suggested.code === 'CMSC330' && f.suggested.term === '2026-fall');
    expect(ta?.role).toBe('ta');
    expect(found.every((f) => f.trackedAs === null)).toBe(true);

    const pick = found.filter((f) => f.suggested.term === '2026-fall').slice(0, 2);
    const body = { courses: pick.map((f) => ({ canvasCourseId: f.canvasCourseId, term: f.suggested.term, code: f.suggested.code, role: f.role })) };
    const created = await app.request('/api/onboarding/canvas', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect(created.status).toBe(201);
    const r = (await created.json()) as { created: string[]; skipped: unknown[] };
    expect(r.created.length).toBe(2);
    const rows = await ctx.db.select().from(courses);
    expect(rows.map((x) => x.canvasCourseId).sort()).toEqual(pick.map((p) => p.canvasCourseId).sort());
    expect(new Set(rows.map((x) => x.color)).size).toBe(2);

    const again = await app.request('/api/onboarding/canvas', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect(again.status).toBe(200);
    expect(((await again.json()) as { created: string[]; skipped: unknown[] }).skipped.length).toBe(2);
    const relist = (await (await app.request('/api/onboarding/canvas')).json()) as { courses: { trackedAs: string | null }[] };
    expect(relist.courses.filter((f) => f.trackedAs).length).toBe(2);
  });

  it('says so when Canvas is not connected', async () => {
    const ctx = await testContext();
    const app = new Hono().route('/api/onboarding', onboardingRoutes(ctx));
    expect((await app.request('/api/onboarding/canvas')).status).toBe(409);
  });
});
