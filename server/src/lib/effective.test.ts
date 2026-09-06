import { describe, expect, it } from 'vitest';
import { courses, itemLinks, items, overrides } from '../db/schema.js';
import { testContext } from '../test-util.js';
import { runDedup } from '../sync/dedup.js';
import { queryEffectiveItems } from './effective.js';

async function setup(submitsVia: 'canvas' | 'gradescope' | 'both') {
  const ctx = await testContext();
  await ctx.db.insert(courses).values({ id: 'c1', term: '2026-fall', code: 'CMSC422', role: 'student', submitsVia });
  await ctx.db.insert(items).values([
    { id: 'canvas:assignment:1', source: 'canvas', externalId: 'assignment:1', kind: 'assignment', courseId: 'c1', title: 'HW02: Decision trees', dueAt: '2026-09-15T03:59:59Z', status: 'open' },
    { id: 'gradescope:assignment:9', source: 'gradescope', externalId: 'assignment:9', kind: 'assignment', courseId: 'c1', title: 'HW02: Decision Trees', dueAt: '2026-09-15T03:59:00Z', status: 'graded', score: 95 },
    { id: 'canvas:assignment:2', source: 'canvas', externalId: 'assignment:2', kind: 'assignment', courseId: 'c1', title: 'Quiz 1 (Canvas only)', dueAt: '2026-09-10T03:59:59Z', status: 'open' },
    { id: 'gradescope:assignment:8', source: 'gradescope', externalId: 'assignment:8', kind: 'assignment', courseId: 'c1', title: 'PS1', dueAt: '2026-09-19T03:59:00Z', status: 'open' },
  ]);
  return ctx;
}

describe('effective items with links', () => {
  it('links the pair and collapses to the Gradescope row when submits_via=gradescope', async () => {
    const ctx = await setup('gradescope');
    const r = await runDedup(ctx);
    expect(r.linked).toBe(1);
    const open = await queryEffectiveItems(ctx, { kind: ['assignment'] });
    // HW02 is graded on Gradescope → done → hidden; Quiz 1 (unmatched canvas) and PS1 remain
    expect(open.map((i) => i.title).sort()).toEqual(['PS1', 'Quiz 1 (Canvas only)']);
    const all = await queryEffectiveItems(ctx, { kind: ['assignment'], includeDone: true });
    const hw = all.filter((i) => /HW02/.test(i.title));
    expect(hw.length).toBe(1);
    expect(hw[0]!.source).toBe('gradescope');
    expect(hw[0]!.linkedIds).toEqual(['canvas:assignment:1']);
    expect(hw[0]!.effectiveDone).toBe(true);
  });

  it('collapses to the Canvas row when submits_via=both, still done because the partner is graded', async () => {
    const ctx = await setup('both');
    await runDedup(ctx);
    const all = await queryEffectiveItems(ctx, { kind: ['assignment'], includeDone: true });
    const hw = all.filter((i) => /HW02/.test(i.title));
    expect(hw.length).toBe(1);
    expect(hw[0]!.source).toBe('canvas');
    expect(hw[0]!.effectiveDone).toBe(true);
  });

  it('treats Gradescope rows as informational when submits_via=canvas and never links', async () => {
    const ctx = await setup('canvas');
    const r = await runDedup(ctx);
    expect(r.linked).toBe(0);
    const open = await queryEffectiveItems(ctx, { kind: ['assignment'] });
    expect(open.map((i) => i.source)).toEqual(['canvas', 'canvas']);
    const withInfo = await queryEffectiveItems(ctx, { kind: ['assignment'], includeInformational: true });
    expect(withInfo.filter((i) => i.informational).map((i) => i.title)).toEqual(['PS1']); // graded HW02 excluded as done
  });

  it('keeps manual links and lets overrides mark done', async () => {
    const ctx = await setup('both');
    await ctx.db.insert(itemLinks).values({ aItemId: 'canvas:assignment:2', bItemId: 'gradescope:assignment:8', method: 'manual', confidence: 1 });
    const r = await runDedup(ctx);
    expect(r.removed).toBe(0);
    const all = await queryEffectiveItems(ctx, { kind: ['assignment'], includeDone: true });
    expect(all.find((i) => i.id === 'canvas:assignment:2')?.linkedIds).toEqual(['gradescope:assignment:8']);
    expect(all.find((i) => i.id === 'gradescope:assignment:8')).toBeUndefined(); // collapsed into canvas
    await ctx.db.insert(overrides).values({ itemId: 'canvas:assignment:2', done: true });
    const open = await queryEffectiveItems(ctx, { kind: ['assignment'] });
    expect(open.map((i) => i.id)).not.toContain('canvas:assignment:2');
  });
});
