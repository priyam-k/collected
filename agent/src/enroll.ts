import type { CanvasEnrollment } from '@collected/shared';
import { ApiError, type CollectedApi } from './api.js';
import { table } from './format.js';

/*
 * Courses from Canvas enrollments: the same two calls the dashboard's first-run card makes (`GET` then `POST
 * /api/onboarding/canvas`), for `collected courses import` and the quickstart's courses step. The server has no
 * courses until something imports them (the seed carries none), and the Canvas ingester only syncs tracked courses,
 * so a fresh local database needs this once after Canvas is connected.
 */

export type ImportResult = { created: string[]; skipped: { canvasCourseId: string; reason: string }[] };

/** The only part of the API this needs; the real clients satisfy it, tests pass a fake. */
export type EnrollApi = Pick<CollectedApi, 'get' | 'send'>;

/** What Canvas says you are enrolled in. Throws the route's own message when Canvas is not connected (409) or rejected the credential (502). */
export async function listEnrollments(api: EnrollApi): Promise<CanvasEnrollment[]> {
  try {
    return (await api.get<{ connected: boolean; courses: CanvasEnrollment[] }>('/api/onboarding/canvas')).courses;
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) throw new Error('Canvas is not connected: `collected connect canvas` first (or paste the cookie in Settings → Sources → Canvas)');
    throw e;
  }
}

const SEASON: Record<string, number> = { spring: 1, summer: 2, fall: 3, winter: 4 };

/** Orders term slugs ("2026-fall" → 20263); a slug that is not year-season ranks below every one that is. */
export function termRank(slug: string): number {
  const m = slug.match(/^(\d{4})-(spring|summer|fall|winter)$/);
  return m ? Number(m[1]) * 10 + SEASON[m[2]!]! : -1;
}

/** The newest term among the enrollments, by `termRank`; null when none has a year-season term. */
export function currentTerm(list: CanvasEnrollment[]): string | null {
  let best: string | null = null;
  for (const e of list) if (termRank(e.suggested.term) >= 0 && (best === null || termRank(e.suggested.term) > termRank(best))) best = e.suggested.term;
  return best;
}

/** What the import takes by default: the current term's enrollments that are not courses here yet; every untracked one when no term is dated. */
export function defaultSelection(list: CanvasEnrollment[]): CanvasEnrollment[] {
  const term = currentTerm(list);
  return list.filter((e) => !e.trackedAs && (term === null || e.suggested.term === term));
}

/** One enrollment as `POST /api/onboarding/canvas` takes it: the suggested slug parts, Canvas's name, the role Canvas reports. */
export const importBody = (picks: CanvasEnrollment[]) => ({ courses: picks.map((e) => ({ canvasCourseId: e.canvasCourseId, ...e.suggested, name: e.name, role: e.role })) });

export function importEnrollments(api: EnrollApi, picks: CanvasEnrollment[]): Promise<ImportResult> {
  if (!picks.length) return Promise.resolve({ created: [], skipped: [] });
  return api.send<ImportResult>('POST', '/api/onboarding/canvas', importBody(picks));
}

/** The enrollments as a table; `marked` ids get a `*` in the first column (the quickstart's default selection). */
export function enrollmentTable(list: CanvasEnrollment[], marked?: Set<string>): string {
  if (!list.length) return '(no active enrollments)';
  return table(
    ['', '#', 'Code', 'Term', 'Role', 'Name', 'Canvas id', 'Here'],
    list.map((e, i) => [marked?.has(e.canvasCourseId) ? '*' : '', String(i + 1), e.suggested.code, e.suggested.term, e.role, e.name, e.canvasCourseId, e.trackedAs ?? '']),
    48,
  );
}

/** "1,3-4" or Canvas ids → the enrollments picked; throws naming what matched nothing. */
export function pickEnrollments(list: CanvasEnrollment[], words: string[]): CanvasEnrollment[] {
  const out = new Map<string, CanvasEnrollment>();
  for (const w of words.flatMap((x) => x.split(',')).map((x) => x.trim()).filter(Boolean)) {
    const range = w.match(/^(\d+)-(\d+)$/);
    const nums = range ? Array.from({ length: Math.max(0, Number(range[2]) - Number(range[1]) + 1) }, (_, k) => Number(range[1]) + k) : [Number(w)];
    const byNumber = nums.map((n) => (n >= 1 && n <= list.length ? list[n - 1]! : null));
    const byId = list.find((e) => e.canvasCourseId === w);
    const hits = byId ? [byId] : byNumber.every(Boolean) ? (byNumber as CanvasEnrollment[]) : [];
    if (!hits.length) throw new Error(`"${w}" is neither a row number (1-${list.length}) nor a Canvas course id in the list`);
    for (const h of hits) out.set(h.canvasCourseId, h);
  }
  return [...out.values()];
}

/** The outcome in one or two lines. */
export function describeImport(r: ImportResult): string {
  const lines: string[] = [];
  if (r.created.length) lines.push(`imported ${r.created.length} course${r.created.length === 1 ? '' : 's'}: ${r.created.join(', ')}`);
  for (const s of r.skipped) lines.push(`skipped ${s.canvasCourseId}: ${s.reason}`);
  return lines.join('\n') || 'nothing imported';
}
