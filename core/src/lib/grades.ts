import { and, eq, inArray } from 'drizzle-orm';
import type { CanvasGradeSummary, CourseGrades, GradeCategory, GradeCategoryResult, GradedAssignment, GradingConfig, SourceId } from '@collected/shared';
import type { AppContext } from '../context.js';
import { courseContent, courses, items } from '../db/schema.js';
import { queryEffectiveItems } from './effective.js';

export interface GradeGroupInput {
  externalId: string;
  name: string;
  position: number | null;
  weight: number | null;
  rules: { drop_lowest?: number; drop_highest?: number; never_drop?: (number | string)[] };
}

export interface GradeAssignmentInput {
  id: string;
  title: string;
  source: SourceId;
  dueAt: string | null;
  status: GradedAssignment['status'];
  score: number | null;
  points: number | null;
  excused: boolean;
  omitFromFinal: boolean;
  groupId: string | null;
  url: string | null;
}

export interface GradeInputs {
  courseId: string;
  grading: GradingConfig | null;
  groups: GradeGroupInput[];
  summary: CanvasGradeSummary | null;
  assignments: GradeAssignmentInput[];
}

/** Categories from the Canvas groups: what `auto` mode uses and what `manual` mode starts from. */
export function categoriesFromGroups(groups: GradeGroupInput[]): GradeCategory[] {
  return groups
    .slice()
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((g) => ({ id: g.externalId, name: g.name, weight: g.weight, groupIds: [g.externalId], match: null, dropLowest: g.rules.drop_lowest ?? 0 }));
}

const ratio = (a: GradedAssignment) => (a.points ? (a.score ?? 0) / a.points : 0);
const round1 = (n: number) => Math.round(n * 100) / 100;

/**
 * Canvas-style current grade: per category, points earned over points possible across graded work (after drop
 * rules); weighted courses average category percentages by weight over the categories that have graded work.
 * Ungraded, excused, and omit-from-final assignments never count. Uncategorized work counts only in the
 * unweighted total.
 */
export function computeGrades(inp: GradeInputs): CourseGrades {
  const manual = inp.grading?.mode === 'manual' && inp.grading.categories.length > 0;
  const categories: GradeCategory[] = manual ? inp.grading!.categories : categoriesFromGroups(inp.groups);
  const weighted = manual ? categories.some((c) => c.weight != null) : !!inp.summary?.applyWeights && categories.some((c) => c.weight != null);

  const matchers = categories.map((c) => {
    let re: RegExp | null = null;
    if (c.match) {
      try {
        re = new RegExp(c.match, 'i');
      } catch {
        re = null;
      }
    }
    return { c, re };
  });
  const categoryFor = (a: GradeAssignmentInput): GradeCategory | null => {
    if (a.groupId) {
      const byGroup = categories.find((c) => c.groupIds.includes(a.groupId!));
      if (byGroup) return byGroup;
    }
    const byTitle = matchers.find((m) => m.re && m.re.test(a.title));
    return byTitle?.c ?? null;
  };

  const toGraded = (a: GradeAssignmentInput): GradedAssignment => ({ ...a, dropped: false });
  const countable = (a: GradedAssignment) => a.score != null && !a.excused && !a.omitFromFinal && a.points != null && a.points > 0;

  const buckets = new Map<string, GradedAssignment[]>(categories.map((c) => [c.id, []]));
  const uncategorized: GradedAssignment[] = [];
  for (const a of inp.assignments) {
    const c = categoryFor(a);
    (c ? buckets.get(c.id)! : uncategorized).push(toGraded(a));
  }

  const results: GradeCategoryResult[] = categories.map((c) => {
    const list = buckets.get(c.id)!.sort((a, b) => (a.dueAt ?? '9').localeCompare(b.dueAt ?? '9'));
    const graded = list.filter(countable);
    if (c.dropLowest > 0 && graded.length > c.dropLowest) {
      for (const d of graded.slice().sort((a, b) => ratio(a) - ratio(b)).slice(0, c.dropLowest)) d.dropped = true;
    }
    const kept = graded.filter((a) => !a.dropped);
    const earned = kept.reduce((s, a) => s + (a.score ?? 0), 0);
    const possible = kept.reduce((s, a) => s + (a.points ?? 0), 0);
    return { id: c.id, name: c.name, weight: c.weight, earned: round1(earned), possible: round1(possible), percent: possible > 0 ? round1((earned / possible) * 100) : null, graded: graded.length, total: list.length, dropLowest: c.dropLowest, assignments: list };
  });

  const allGraded = [...results.flatMap((r) => r.assignments), ...uncategorized].filter((a) => countable(a) && !a.dropped);
  const earnedAll = allGraded.reduce((s, a) => s + (a.score ?? 0), 0);
  const possibleAll = allGraded.reduce((s, a) => s + (a.points ?? 0), 0);
  const unweighted = possibleAll > 0 ? round1((earnedAll / possibleAll) * 100) : null;

  let current = unweighted;
  if (weighted) {
    const live = results.filter((r) => r.percent != null && r.weight != null && r.weight > 0);
    const wsum = live.reduce((s, r) => s + r.weight!, 0);
    current = wsum > 0 ? round1(live.reduce((s, r) => s + r.weight! * r.percent!, 0) / wsum) : null;
  }

  return {
    courseId: inp.courseId,
    mode: manual ? 'manual' : 'auto',
    weighted,
    current,
    unweighted,
    canvas: inp.summary,
    categories: results,
    uncategorized: uncategorized.sort((a, b) => (a.dueAt ?? '9').localeCompare(b.dueAt ?? '9')),
    graded: allGraded.length + results.flatMap((r) => r.assignments).filter((a) => a.dropped).length,
    total: inp.assignments.length,
  };
}

/** Loads everything computeGrades needs for one course. Linked Canvas/Gradescope pairs count once. */
export async function loadGradeInputs(ctx: AppContext, courseId: string): Promise<GradeInputs | null> {
  const course = await ctx.db.query.courses.findFirst({ where: eq(courses.id, courseId) });
  if (!course) return null;
  const content = await ctx.db.select().from(courseContent).where(and(eq(courseContent.courseId, courseId), inArray(courseContent.kind, ['grade_group', 'grade_summary'])));
  const groups: GradeGroupInput[] = content
    .filter((r) => r.kind === 'grade_group')
    .map((r) => ({ externalId: r.externalId, name: r.title, position: r.position, weight: (r.raw as { weight?: number | null }).weight ?? null, rules: ((r.raw as { rules?: GradeGroupInput['rules'] }).rules ?? {}) }));
  const summaryRow = content.find((r) => r.kind === 'grade_summary');
  const summary = summaryRow ? (summaryRow.raw as unknown as CanvasGradeSummary) : null;

  // Effective items collapse linked pairs to the preferred side; pull the partner's raw so group ids survive.
  const effective = await queryEffectiveItems(ctx, { kind: ['assignment'], courseId, includeDone: true, includeInformational: true, limit: 1000 });
  const partnerIds = effective.flatMap((e) => e.linkedIds);
  const partners = partnerIds.length ? await ctx.db.select().from(items).where(inArray(items.id, partnerIds)) : [];
  const partnerById = new Map(partners.map((p) => [p.id, p]));
  const assignments: GradeAssignmentInput[] = effective.map((e) => {
    const raw = e.raw as { groupId?: string | null; omitFromFinal?: boolean; excused?: boolean; ta?: boolean };
    const partner = e.linkedIds.map((id) => partnerById.get(id)).find(Boolean);
    const praw = (partner?.raw ?? {}) as { groupId?: string | null; omitFromFinal?: boolean; excused?: boolean };
    return {
      id: e.id,
      title: e.title,
      source: e.source,
      dueAt: e.dueAt,
      status: e.status,
      score: e.score ?? partner?.score ?? null,
      points: e.points ?? partner?.points ?? null,
      excused: !!(raw.excused ?? praw.excused),
      omitFromFinal: !!(raw.omitFromFinal ?? praw.omitFromFinal),
      groupId: raw.groupId ?? praw.groupId ?? null,
      url: e.url,
    };
  });
  return { courseId, grading: course.grading ?? null, groups, summary, assignments };
}
