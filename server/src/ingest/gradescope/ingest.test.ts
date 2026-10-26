import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { courseContent, courses, items } from '../../db/schema.js';
import { testContext } from '../../test-util.js';
import { NeedsAuthError } from '../types.js';
import { fixtureGradescopeClient } from './fixture-client.js';
import { syncGradescope } from './ingest.js';

async function seedCourses(ctx: Awaited<ReturnType<typeof testContext>>) {
  await ctx.db.insert(courses).values([
    { id: '2026-fall-cmsc422-0101', term: '2026-fall', code: 'CMSC422', section: '0101', role: 'student', submitsVia: 'gradescope' },
    { id: '2026-fall-cmsc330-0103', term: '2026-fall', code: 'CMSC330', section: '0103', role: 'ta', submitsVia: 'gradescope' },
    { id: '2026-fall-math423-0301', term: '2026-fall', code: 'MATH423', section: '0301', role: 'student', submitsVia: 'both' },
    { id: '2026-fall-stat410-0601', term: '2026-fall', code: 'STAT410', section: '0601', role: 'student', submitsVia: 'both' },
  ]);
}

describe('syncGradescope', () => {
  // The fixtures were captured on 2026-09-06; statuses like "missing" depend on the due date being past *now*.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-06T12:00:00-04:00'));
  });
  afterEach(() => vi.useRealTimers());

  it('matches courses, ingests student rows and TA grading queue', async () => {
    const ctx = await testContext();
    await seedCourses(ctx);
    const client = fixtureGradescopeClient();
    const counts = await syncGradescope(ctx, client);
    expect(counts.matchedCourses).toBe(3);
    expect(counts.autoFilled).toBe(3);
    expect(counts.logins).toBe(0);

    const c330 = await ctx.db.query.courses.findFirst({ where: eq(courses.id, '2026-fall-cmsc330-0103') });
    expect(c330?.gradescopeCourseId).toBe('3001001');

    const rows = await ctx.db.select().from(items).where(eq(items.source, 'gradescope'));
    const byExt = Object.fromEntries(rows.map((r) => [r.externalId, r]));
    expect(byExt['assignment:8499802']!.status).toBe('open'); // due in the future, no submission
    expect(byExt['assignment:8499810']!.status).toBe('graded');
    expect(byExt['assignment:8499820']!.status).toBe('late');
    expect(byExt['assignment:8499830']!.status).toBe('missing'); // past due, no submission
    expect(byExt['assignment:8499802']!.url).toBe('https://www.gradescope.com/courses/3001002');
    // TA rows informational
    expect(byExt['assignment:8502840']!.status).toBe('open');
    expect((byExt['assignment:8502840']!.raw as { ta: boolean }).ta).toBe(true);

    const grading = await ctx.db.select().from(courseContent).where(eq(courseContent.kind, 'grading'));
    expect(grading.map((g) => [g.title, (g.raw as { gradingProgress: number }).gradingProgress])).toEqual([
      ['P1', 100],
      ['Quiz 1', 35],
    ]);
  });

  it('logs in once when the session is gone and persists across requests', async () => {
    const ctx = await testContext();
    await seedCourses(ctx);
    const client = fixtureGradescopeClient({ requireLogin: true });
    const counts = await syncGradescope(ctx, client);
    expect(counts.logins).toBe(1);
    expect(client.calls.filter((c) => c === 'POST /login').length).toBe(1);
  });

  it('surfaces bad credentials as NeedsAuthError', async () => {
    const ctx = await testContext();
    await seedCourses(ctx);
    const client = fixtureGradescopeClient({ requireLogin: true, rejectLogin: true });
    await expect(syncGradescope(ctx, client)).rejects.toBeInstanceOf(NeedsAuthError);
  });
});
