import { describe, expect, it } from 'vitest';
import { computeGrades, type GradeAssignmentInput } from './grades.js';

const a = (id: string, title: string, score: number | null, points: number | null, groupId: string | null, extra: Partial<GradeAssignmentInput> = {}): GradeAssignmentInput => ({
  id,
  title,
  source: 'canvas',
  dueAt: null,
  status: score == null ? 'open' : 'graded',
  score,
  points,
  excused: false,
  omitFromFinal: false,
  groupId,
  url: null,
  ...extra,
});

const groups = [
  { externalId: 'hw', name: 'Homework', position: 1, weight: 40, rules: { drop_lowest: 1 } },
  { externalId: 'ex', name: 'Exams', position: 2, weight: 60, rules: {} },
  { externalId: 'part', name: 'Participation', position: 3, weight: 0, rules: {} },
];
const assignments = [
  a('h1', 'HW 1', 8, 10, 'hw'),
  a('h2', 'HW 2', 9, 10, 'hw'),
  a('h3', 'HW 3', 5, 10, 'hw'),
  a('h4', 'HW 4', null, 10, 'hw'),
  a('e1', 'Midterm 1', 90, 100, 'ex'),
  a('e2', 'Final exam', null, 100, 'ex'),
  a('x1', 'Excused thing', 0, 10, 'ex', { excused: true }),
  a('u1', 'Ungrouped quiz', 4, 5, null),
];

describe('computeGrades', () => {
  it('weights categories with graded work and applies drop rules', () => {
    const g = computeGrades({ courseId: 'c', grading: null, groups, summary: { currentScore: 88, finalScore: 40, currentGrade: null, finalGrade: null, applyWeights: true }, assignments });
    expect(g.mode).toBe('auto');
    expect(g.weighted).toBe(true);
    const hw = g.categories.find((c) => c.id === 'hw')!;
    expect(hw.assignments.find((x) => x.id === 'h3')?.dropped).toBe(true);
    expect(hw.earned).toBe(17);
    expect(hw.possible).toBe(20);
    expect(hw.percent).toBe(85);
    expect(hw.graded).toBe(3);
    expect(hw.total).toBe(4);
    const ex = g.categories.find((c) => c.id === 'ex')!;
    expect(ex.percent).toBe(90);
    expect(ex.graded).toBe(1); // excused and ungraded don't count
    expect(g.current).toBe(88); // (40*85 + 60*90) / 100
    expect(g.unweighted).toBe(round((17 + 90 + 4) / (20 + 100 + 5) * 100));
    expect(g.uncategorized.map((x) => x.id)).toEqual(['u1']);
  });

  it('falls back to points when Canvas does not apply weights', () => {
    const g = computeGrades({ courseId: 'c', grading: null, groups, summary: { currentScore: 0, finalScore: 0, currentGrade: null, finalGrade: null, applyWeights: false }, assignments });
    expect(g.weighted).toBe(false);
    expect(g.current).toBe(g.unweighted);
  });

  it('manual categories can weight by group or by title regex', () => {
    const g = computeGrades({
      courseId: 'c',
      grading: { mode: 'manual', categories: [
        { id: 'hw', name: 'Homework', weight: 30, groupIds: ['hw'], match: null, dropLowest: 0 },
        { id: 'tests', name: 'Tests', weight: 70, groupIds: [], match: 'midterm|final|quiz', dropLowest: 0 },
      ] },
      groups,
      summary: null,
      assignments,
    });
    expect(g.mode).toBe('manual');
    expect(g.weighted).toBe(true);
    const hw = g.categories[0]!;
    expect(hw.percent).toBe(round((22 / 30) * 100));
    const tests = g.categories[1]!;
    expect(tests.assignments.map((x) => x.id).sort()).toEqual(['e1', 'e2', 'u1']);
    expect(tests.percent).toBe(round((94 / 105) * 100));
    expect(g.current).toBe(round((30 * hw.percent! + 70 * tests.percent!) / 100));
    expect(g.uncategorized.map((x) => x.id)).toEqual(['x1']);
  });

  it('is null with nothing graded and safe with a bad regex', () => {
    const g = computeGrades({ courseId: 'c', grading: { mode: 'manual', categories: [{ id: 'x', name: 'X', weight: 100, groupIds: [], match: '(', dropLowest: 0 }] }, groups: [], summary: null, assignments: [a('h4', 'HW 4', null, 10, null)] });
    expect(g.current).toBeNull();
    expect(g.categories[0]!.total).toBe(0);
  });
});

const round = (n: number) => Math.round(n * 100) / 100;
