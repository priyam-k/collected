import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import { courses, itemLinks, items, type ItemRow } from '../db/schema.js';
import { hoursBetween } from '../lib/time.js';

/** Lowercase, drop punctuation and the course code, collapse whitespace. */
export function normalizeTitle(title: string, courseCode?: string | null): string {
  let t = title.toLowerCase();
  if (courseCode) t = t.replace(new RegExp(courseCode.toLowerCase().replace(/[^a-z0-9]/g, ''), 'g'), ' ');
  t = t
    .replace(/\b(hw|homework|assignment|assn|asg)\b/g, 'hw')
    .replace(/\b(ps|problem set|pset)\b/g, 'ps')
    .replace(/\b(proj|project)\b/g, 'project')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b0+(\d)/g, '$1') // hw01 → hw1
    .replace(/\s+/g, ' ')
    .trim();
  return t;
}

const bigrams = (s: string): Map<string, number> => {
  const m = new Map<string, number>();
  const padded = ` ${s} `;
  for (let i = 0; i < padded.length - 1; i++) {
    const g = padded.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
};

/** Sørensen–Dice over character bigrams, 0..1. */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  for (const [g, n] of A) inter += Math.min(n, B.get(g) ?? 0);
  const total = [...A.values()].reduce((x, y) => x + y, 0) + [...B.values()].reduce((x, y) => x + y, 0);
  return (2 * inter) / total;
}

export interface Candidate {
  a: ItemRow;
  b: ItemRow;
  score: number;
}

export const DEDUP_THRESHOLD = 0.6;
export const DEDUP_DUE_HOURS = 24;

/** Best one-to-one pairing of Canvas and Gradescope assignments within a course. */
export function pairAssignments(canvas: ItemRow[], gradescope: ItemRow[], courseCode: string | null, threshold = DEDUP_THRESHOLD): Candidate[] {
  const cands: Candidate[] = [];
  for (const a of canvas) {
    const na = normalizeTitle(a.title, courseCode);
    for (const b of gradescope) {
      const nb = normalizeTitle(b.title, courseCode);
      let score = similarity(na, nb);
      // Same title numbers matter a lot ("hw 3" vs "hw 4" share most bigrams).
      const numsA = na.match(/\d+/g)?.join(',') ?? '';
      const numsB = nb.match(/\d+/g)?.join(',') ?? '';
      if (numsA !== numsB) score -= 0.35;
      if (a.dueAt && b.dueAt) {
        const h = hoursBetween(a.dueAt, b.dueAt);
        if (h > DEDUP_DUE_HOURS) score -= 0.5;
        else if (h < 1) score += 0.1;
      }
      if (score >= threshold) cands.push({ a, b, score });
    }
  }
  cands.sort((x, y) => y.score - x.score);
  const usedA = new Set<string>();
  const usedB = new Set<string>();
  const out: Candidate[] = [];
  for (const c of cands) {
    if (usedA.has(c.a.id) || usedB.has(c.b.id)) continue;
    usedA.add(c.a.id);
    usedB.add(c.b.id);
    out.push(c);
  }
  return out;
}

/**
 * Recomputes auto links for every course. Manual links are never touched; auto links that no longer
 * qualify are removed. Courses with submits_via=canvas get no links (Gradescope rows are informational).
 */
export async function runDedup(ctx: AppContext): Promise<{ linked: number; removed: number }> {
  const ours = await ctx.db.select().from(courses).where(eq(courses.archived, false));
  let linked = 0;
  let removed = 0;
  for (const c of ours) {
    const rows = await ctx.db
      .select()
      .from(items)
      .where(and(eq(items.courseId, c.id), eq(items.kind, 'assignment'), isNull(items.deletedAt), inArray(items.source, ['canvas', 'gradescope'])));
    const canvasRows = rows.filter((r) => r.source === 'canvas');
    const gsRows = rows.filter((r) => r.source === 'gradescope');
    const pairs = c.submitsVia === 'canvas' ? [] : pairAssignments(canvasRows, gsRows, c.code);
    const wanted = new Map(pairs.map((p) => [[p.a.id, p.b.id].sort().join('|'), p]));

    const ids = rows.map((r) => r.id);
    const existing = ids.length
      ? await ctx.db.select().from(itemLinks).where(and(eq(itemLinks.method, 'auto'), inArray(itemLinks.aItemId, ids)))
      : [];
    for (const l of existing) {
      const key = [l.aItemId, l.bItemId].sort().join('|');
      if (!wanted.has(key)) {
        await ctx.db.delete(itemLinks).where(and(eq(itemLinks.aItemId, l.aItemId), eq(itemLinks.bItemId, l.bItemId)));
        removed++;
      }
    }
    const manual = ids.length ? await ctx.db.select().from(itemLinks).where(and(eq(itemLinks.method, 'manual'), inArray(itemLinks.aItemId, ids))) : [];
    const manualIds = new Set(manual.flatMap((m) => [m.aItemId, m.bItemId]));
    for (const p of pairs) {
      if (manualIds.has(p.a.id) || manualIds.has(p.b.id)) continue; // a manual decision covers this item
      const [x, y] = [p.a.id, p.b.id].sort() as [string, string];
      const r = await ctx.db
        .insert(itemLinks)
        .values({ aItemId: x, bItemId: y, method: 'auto', confidence: Math.min(1, p.score) })
        .onConflictDoNothing()
        .returning({ a: itemLinks.aItemId });
      if (r.length) linked++;
    }
  }
  return { linked, removed };
}
