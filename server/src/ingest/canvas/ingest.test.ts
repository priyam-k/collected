import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { courseContent, courses, items } from '../../db/schema.js';
import { queryEffectiveItems } from '../../lib/effective.js';
import { testContext } from '../../test-util.js';
import { fixtureCanvasClient } from './fixture-client.js';
import { syncCanvas } from './ingest.js';

async function seedCourses(ctx: Awaited<ReturnType<typeof testContext>>) {
  await ctx.db.insert(courses).values([
    { id: '2026-fall-cmsc422-0101', term: '2026-fall', code: 'CMSC422', section: '0101', role: 'student', submitsVia: 'both' },
    { id: '2026-fall-cmsc330-0103', term: '2026-fall', code: 'CMSC330', section: '0103', role: 'ta', submitsVia: 'gradescope' },
    { id: '2026-fall-math423-0301', term: '2026-fall', code: 'MATH423', section: '0301', role: 'student', submitsVia: 'both' },
    { id: '2026-fall-ling260-0101', term: '2026-fall', code: 'LING260', section: '0101', role: 'student', submitsVia: 'both' },
  ]);
}

describe('syncCanvas over fixtures', () => {
  it('auto-fills course ids, upserts items with planner overlay, and stores course content', async () => {
    const ctx = await testContext();
    await seedCourses(ctx);
    const counts = await syncCanvas(ctx, fixtureCanvasClient());
    expect(counts.matchedCourses).toBe(3); // ling260 is not in the courses fixture
    expect(counts.autoFilled).toBe(3);

    const c422 = await ctx.db.query.courses.findFirst({ where: eq(courses.id, '2026-fall-cmsc422-0101') });
    expect(c422?.canvasCourseId).toBe('1408462');

    const rows = await ctx.db.select().from(items).where(eq(items.source, 'canvas'));
    const byExt = Object.fromEntries(rows.map((r) => [r.externalId, r]));
    // unpublished assignment skipped
    expect(byExt['assignment:7775096']).toBeUndefined();
    // assignment endpoint status kept, planner adds the event + announcement
    expect(byExt['assignment:7775094']!.status).toBe('graded');
    expect(byExt['event:9001']!.kind).toBe('event');
    expect(byExt['announcement:6122383']!.courseId).toBe('2026-fall-math423-0301');
    // planner item for an untracked course (CPSS100) is dropped
    expect(byExt['assignment:7293287']).toBeUndefined();

    const content = await ctx.db.select().from(courseContent).where(eq(courseContent.courseId, '2026-fall-cmsc422-0101'));
    const kinds = content.reduce<Record<string, number>>((m, r) => ({ ...m, [r.kind]: (m[r.kind] ?? 0) + 1 }), {});
    expect(kinds).toEqual({ syllabus: 1, module_item: 4, file: 4, grade_group: 3, grade_summary: 1 });
    // A PDF the syllabus page links to, in a hidden folder the Files listing omits, is found through the link.
    const syl = content.find((r) => r.kind === 'file' && r.externalId === '99000001')!;
    expect(syl.title).toBe('syllabus.pdf');
    expect(syl.raw).toMatchObject({ linkedFrom: { kind: 'syllabus', title: 'Syllabus' }, folderPath: null });
    expect(counts.linkedFiles).toBe(1);
    // Files carry their Canvas folder path and the module they sit in, for the file sync.
    const knn = content.find((r) => r.kind === 'file' && r.externalId === '90735997')!;
    expect(knn.raw).toMatchObject({ folderPath: '/Lectures', filename: 'lecture03_knn.pdf' });
    const trees = content.find((r) => r.kind === 'file' && r.externalId === '90778257')!;
    expect(trees.moduleName).toBeTruthy();
    expect(content.find((r) => r.kind === 'file' && r.externalId === '90778313')!.raw).toMatchObject({ folderPath: '/Homework/Code' });
    const summary = content.find((r) => r.kind === 'grade_summary')!;
    expect(summary.raw).toMatchObject({ currentScore: 91.5, applyWeights: true });
    expect(content.find((r) => r.kind === 'grade_group' && r.externalId === '2391940')?.raw).toMatchObject({ weight: 24, rules: { drop_lowest: 1 } });
  });

  it('is idempotent and soft-deletes assignments Canvas stops returning', async () => {
    const ctx = await testContext();
    await seedCourses(ctx);
    await syncCanvas(ctx, fixtureCanvasClient());
    await ctx.db.insert(items).values({
      id: 'canvas:assignment:999',
      source: 'canvas',
      externalId: 'assignment:999',
      kind: 'assignment',
      courseId: '2026-fall-cmsc422-0101',
      title: 'stale',
      status: 'open',
    });
    const counts = await syncCanvas(ctx, fixtureCanvasClient());
    expect(counts.created).toBe(0);
    expect(counts.deleted).toBe(1);
    const stale = await ctx.db.query.items.findFirst({ where: eq(items.id, 'canvas:assignment:999') });
    expect(stale?.deletedAt).toBeTruthy();
  });

  it('exposes effective items: done/graded hidden by default, missing flagged, TA rows informational', async () => {
    const ctx = await testContext();
    await seedCourses(ctx);
    await syncCanvas(ctx, fixtureCanvasClient());
    const open = await queryEffectiveItems(ctx, { kind: ['assignment'] });
    const titles = open.map((i) => i.title);
    expect(titles).toContain('HW01: Warm up');
    expect(titles).not.toContain('HW02: Decision trees'); // graded → done
    expect(titles).not.toContain('Reading response 1'); // late = submitted after due → done
    const all = await queryEffectiveItems(ctx, { kind: ['assignment'], includeDone: true });
    expect(all.find((i) => i.title === 'HW02: Decision trees')?.effectiveDone).toBe(true);
  });
});
