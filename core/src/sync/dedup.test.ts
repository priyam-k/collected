import { describe, expect, it } from 'vitest';
import type { ItemRow } from '../db/schema.js';
import { normalizeTitle, pairAssignments, similarity } from './dedup.js';

const row = (id: string, source: string, title: string, dueAt: string | null): ItemRow =>
  ({ id, source, externalId: id, kind: 'assignment', courseId: 'c', title, dueAt, status: 'open', labels: [], raw: {} }) as unknown as ItemRow;

describe('dedup', () => {
  it('normalizes titles', () => {
    expect(normalizeTitle('HW 3: Trees', 'CMSC422')).toBe('hw 3 trees');
    expect(normalizeTitle('Homework 03 - Trees')).toBe('hw 3 trees');
    expect(normalizeTitle('CMSC422 Problem Set 1', 'CMSC422')).toBe('ps 1');
    expect(similarity('hw 3 trees', 'hw 3 trees')).toBe(1);
  });

  it('pairs matching titles within the due window and keeps pairings one-to-one', () => {
    const canvas = [row('c1', 'canvas', 'HW02: Decision trees', '2026-09-15T03:59:59Z'), row('c2', 'canvas', 'HW03: Ensembles', '2026-09-22T03:59:59Z'), row('c3', 'canvas', 'Reading response 1', '2026-09-04T03:59:59Z')];
    const gs = [row('g1', 'gradescope', 'HW02: Decision Trees', '2026-09-15T03:59:00Z'), row('g2', 'gradescope', 'HW03 Ensembles', '2026-09-22T03:59:00Z'), row('g3', 'gradescope', 'PS1', '2026-09-19T03:59:00Z')];
    const pairs = pairAssignments(canvas, gs, 'CMSC422');
    expect(pairs.map((p) => [p.a.id, p.b.id]).sort()).toEqual([
      ['c1', 'g1'],
      ['c2', 'g2'],
    ]);
  });

  it('does not pair different numbers or far-apart due dates', () => {
    const canvas = [row('c1', 'canvas', 'HW 3', '2026-09-15T03:59:59Z')];
    expect(pairAssignments(canvas, [row('g1', 'gradescope', 'HW 4', '2026-09-15T03:59:00Z')], null)).toEqual([]);
    expect(pairAssignments(canvas, [row('g1', 'gradescope', 'HW 3', '2026-09-25T03:59:00Z')], null)).toEqual([]);
    expect(pairAssignments(canvas, [row('g1', 'gradescope', 'HW 3', null)], null).length).toBe(1); // no date on one side: title decides
  });
});
