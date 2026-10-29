import { and, eq, inArray } from 'drizzle-orm';
import { sourceConfigSchemas, type ItemStatus } from '@collected/shared';
import type { AppContext } from '../../context.js';
import { courses, items, type CourseRow, type NewItemRow } from '../../db/schema.js';
import { replaceCourseContent, upsertItems } from '../../lib/items.js';
import { getSourceConfig, setSourceConfig } from '../../lib/sources.js';
import { NotConfiguredError, type Ingester } from '../types.js';
import { normCode, termLabel } from '../canvas/map.js';
import type { ContentRow } from '../canvas/map.js';
import { GradescopeClient, type GradescopeConfig } from './client.js';
import { parseAccount, parseInstructorAssignments, parseStudentCourse, type GsCourse, type GsInstructorAssignment, type GsStudentAssignment } from './parse.js';

export interface GsCourseCtx {
  courseId: string;
  role: 'student' | 'ta';
  gs: GsCourse;
}

/** Pairs our courses with Gradescope courses: explicit id, else unique (code, term, role) match. */
export function matchGradescopeCourses(ours: CourseRow[], gs: GsCourse[]): { matched: GsCourseCtx[]; autoFilled: { courseId: string; gradescopeCourseId: string }[] } {
  const matched: GsCourseCtx[] = [];
  const autoFilled: { courseId: string; gradescopeCourseId: string }[] = [];
  const byId = new Map(gs.map((g) => [g.id, g]));
  for (const c of ours) {
    if (c.archived) continue;
    const role = c.role as 'student' | 'ta';
    if (c.gradescopeCourseId) {
      const g = byId.get(c.gradescopeCourseId);
      if (g) matched.push({ courseId: c.id, role, gs: g });
      continue;
    }
    const want = normCode(c.code);
    const term = termLabel(c.term).toLowerCase();
    let cands = gs.filter((g) => normCode(g.shortname) === want || normCode(g.name).startsWith(want));
    cands = cands.filter((g) => g.term.toLowerCase() === term);
    if (cands.length > 1) cands = cands.filter((g) => g.role === role);
    if (cands.length === 1) {
      matched.push({ courseId: c.id, role, gs: cands[0]! });
      autoFilled.push({ courseId: c.id, gradescopeCourseId: cands[0]!.id });
    }
  }
  return { matched, autoFilled };
}

export function studentStatus(a: GsStudentAssignment): ItemStatus {
  switch (a.status) {
    case 'graded':
      return 'graded';
    case 'late':
      return 'late';
    case 'submitted':
      return 'submitted';
    case 'no_submission':
      return a.dueAt && new Date(a.dueAt) < new Date() ? 'missing' : 'open';
    default:
      return 'open';
  }
}

export function studentAssignmentToRow(a: GsStudentAssignment, cc: GsCourseCtx, baseUrl: string): NewItemRow {
  const ext = a.id ? `assignment:${a.id}` : `assignment-title:${cc.gs.id}:${a.title.toLowerCase().replace(/\s+/g, '-')}`;
  return {
    id: `gradescope:${ext}`,
    source: 'gradescope',
    externalId: ext,
    kind: 'assignment',
    courseId: cc.courseId,
    title: a.title,
    description: null,
    url: a.url ? `${baseUrl}${a.url}` : `${baseUrl}/courses/${cc.gs.id}`,
    dueAt: a.dueAt,
    startsAt: a.releaseAt,
    endsAt: a.lateDueAt,
    allDay: false,
    status: studentStatus(a),
    points: a.points,
    score: a.score,
    labels: [],
    raw: { gradescopeCourseId: cc.gs.id, statusText: a.statusText, lateDueAt: a.lateDueAt },
  };
}

export function instructorAssignmentToRow(a: GsInstructorAssignment, cc: GsCourseCtx, baseUrl: string): NewItemRow {
  return {
    id: `gradescope:assignment:${a.id}`,
    source: 'gradescope',
    externalId: `assignment:${a.id}`,
    kind: 'assignment',
    courseId: cc.courseId,
    title: a.title,
    description: null,
    url: a.url ? `${baseUrl}${a.url}` : `${baseUrl}/courses/${cc.gs.id}/assignments/${a.id}`,
    dueAt: a.dueAt,
    startsAt: a.releaseAt,
    endsAt: a.hardDueAt,
    allDay: false,
    status: 'open',
    points: a.totalPoints,
    score: null,
    labels: [],
    raw: {
      ta: true,
      gradescopeCourseId: cc.gs.id,
      gradingProgress: a.gradingProgress,
      numActiveSubmissions: a.numActiveSubmissions,
      isPublished: a.isPublished,
      openRegradeRequests: a.openRegradeRequests,
    },
  };
}

export function gradingToContent(list: GsInstructorAssignment[], cc: GsCourseCtx, baseUrl: string): ContentRow[] {
  return list.map((a, i) => ({
    id: `${cc.courseId}:grading:${a.id}`,
    courseId: cc.courseId,
    kind: 'grading',
    externalId: a.id,
    moduleName: null,
    title: a.title,
    url: a.url ? `${baseUrl}${a.url}` : `${baseUrl}/courses/${cc.gs.id}/assignments/${a.id}/grade`,
    position: i,
    raw: {
      dueAt: a.dueAt,
      hardDueAt: a.hardDueAt,
      submissions: a.numActiveSubmissions,
      gradingProgress: a.gradingProgress,
      published: a.isPublished,
      openRegradeRequests: a.openRegradeRequests,
    },
  }));
}

export async function syncGradescope(ctx: AppContext, client: GradescopeClient, signal?: AbortSignal): Promise<Record<string, number>> {
  const ours = await ctx.db.select().from(courses).where(eq(courses.archived, false));
  const gsCourses = parseAccount(await client.getHtml('/account', signal));
  const { matched, autoFilled } = matchGradescopeCourses(ours, gsCourses);
  for (const f of autoFilled) {
    await ctx.db.update(courses).set({ gradescopeCourseId: f.gradescopeCourseId }).where(eq(courses.id, f.courseId));
    ctx.log.info({ course: f.courseId, gradescopeCourseId: f.gradescopeCourseId }, 'gradescope course id auto-filled');
  }
  const counts: Record<string, number> = { gradescopeCourses: gsCourses.length, matchedCourses: matched.length, autoFilled: autoFilled.length };
  if (!matched.length) {
    ctx.log.warn('no courses matched Gradescope; set Gradescope ids in Settings → Courses');
    return counts;
  }

  const rows: NewItemRow[] = [];
  let grading = 0;
  for (const cc of matched) {
    if (cc.gs.role === 'ta') {
      const html = await client.getHtml(`/courses/${cc.gs.id}/assignments`, signal);
      const { assignments } = parseInstructorAssignments(html);
      for (const a of assignments) rows.push(instructorAssignmentToRow(a, cc, client.baseUrl));
      grading += await replaceCourseContent(ctx, cc.courseId, ['grading'], gradingToContent(assignments, cc, client.baseUrl));
    } else {
      const html = await client.getHtml(`/courses/${cc.gs.id}`, signal);
      for (const a of parseStudentCourse(html)) rows.push(studentAssignmentToRow(a, cc, client.baseUrl));
    }
  }
  const tracked = matched.map((m) => m.courseId);
  const r = await upsertItems(ctx, 'gradescope', rows, [and(eq(items.kind, 'assignment'), inArray(items.courseId, tracked))!]);
  return { ...counts, assignments: rows.length, upserted: r.upserted, created: r.created, deleted: r.deleted, grading, requests: client.requestCount, logins: client.logins };
}

export const gradescopeIngester: Ingester = {
  id: 'gradescope',
  intervalMinutes: 30,
  timeoutMs: 180_000,
  async run(ctx, signal) {
    const config = await getSourceConfig<GradescopeConfig>(ctx, 'gradescope');
    if (!config?.email || !config.password) throw new NotConfiguredError('Gradescope credentials not set');
    const creds = sourceConfigSchemas.gradescope.parse(config);
    const client = await GradescopeClient.fromConfig({ ...creds, cookieJar: config.cookieJar }, ctx.log);
    try {
      const counts = await syncGradescope(ctx, client, signal);
      return { counts };
    } finally {
      await setSourceConfig(ctx, 'gradescope', { ...creds, cookieJar: await client.serializeJar() });
    }
  },
};
