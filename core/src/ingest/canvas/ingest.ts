import { eq, inArray } from 'drizzle-orm';
import { sourceConfigSchemas } from '@collected/shared';
import type { AppContext } from '../../context.js';
import { courses, items, type NewItemRow } from '../../db/schema.js';
import { replaceCourseContent, upsertItems } from '../../lib/items.js';
import { getSourceConfig, setSourceConfig } from '../../lib/sources.js';
import { addDays } from '../../lib/time.js';
import { NeedsAuthError, NotConfiguredError, type Ingester } from '../types.js';
import { CanvasClient, isAbort, type CanvasConfig } from './client.js';
import {
  announcementToRow,
  assignmentToRow,
  filesToContent,
  LINK_RANK,
  linkedFileIds,
  linkedFilesToContent,
  gradeGroupsToContent,
  gradeSummaryToContent,
  matchCourses,
  modulesToContent,
  plannerToRow,
  syllabusToContent,
  type CanvasAnnouncement,
  type CanvasAssignment,
  type CanvasAssignmentGroup,
  type CanvasCourse,
  type CanvasFile,
  type CanvasFolder,
  type CanvasModule,
  moduleNamesByFileId,
  type CourseCtx,
  type LinkedFrom,
  type PlannerItem,
} from './map.js';

export const PLANNER_PAST_DAYS = 14;
export const PLANNER_FUTURE_DAYS = 60;
export const ANNOUNCEMENT_PAST_DAYS = 30;
/** Per course and run: how many linked-but-unlisted files to look up. Each is one request. */
export const MAX_LINKED_FILES = 40;

/**
 * Runs one Canvas sync against an already-built client. Split from the ingester so tests can inject
 * a client over fixtures.
 */
export async function syncCanvas(ctx: AppContext, client: CanvasClient, signal?: AbortSignal): Promise<Record<string, number>> {
  const baseUrl = client.baseUrl;
  const ours = await ctx.db.select().from(courses).where(eq(courses.archived, false));

  const canvasCourses = await client.getAll<CanvasCourse>('/api/v1/courses', { enrollment_state: 'active', 'include[]': ['term', 'total_scores'] }, { signal });
  const { matched, autoFilled } = matchCourses(ours, canvasCourses);
  for (const f of autoFilled) {
    await ctx.db.update(courses).set({ canvasCourseId: f.canvasCourseId }).where(eq(courses.id, f.courseId));
    ctx.log.info({ course: f.courseId, canvasCourseId: f.canvasCourseId }, 'canvas course id auto-filled');
  }
  const ctxByCanvasId = new Map<string, CourseCtx>();
  const canvasCourseById = new Map<string, CanvasCourse>();
  for (const c of ours) {
    const k = matched.get(c.id);
    if (k) {
      ctxByCanvasId.set(String(k.id), { courseId: c.id, role: c.role as CourseCtx['role'] });
      canvasCourseById.set(String(k.id), k);
    }
  }
  const trackedCourseIds = [...ctxByCanvasId.values()].map((c) => c.courseId);
  const counts: Record<string, number> = { canvasCourses: canvasCourses.length, matchedCourses: ctxByCanvasId.size, autoFilled: autoFilled.length };
  if (!ctxByCanvasId.size) {
    ctx.log.warn('no courses matched Canvas; set canvas ids in Settings → Courses');
    return counts;
  }

  // Assignments per course are the authoritative assignment list (full history, has descriptions and submission state).
  const rows = new Map<string, NewItemRow>();
  // Files that page bodies link to, per Canvas course: fileId → where it was found (DESIGN "File sync": linked files).
  const linked = new Map<string, Map<string, LinkedFrom>>();
  const noteLink = (canvasId: string, fileId: string, from: LinkedFrom) => {
    const m = linked.get(canvasId) ?? new Map<string, LinkedFrom>();
    const had = m.get(fileId);
    if (!had || LINK_RANK[from.kind] < LINK_RANK[had.kind]) m.set(fileId, from);
    linked.set(canvasId, m);
  };
  const noteLinks = (canvasId: string, html: string | null | undefined, from: LinkedFrom) => {
    for (const id of linkedFileIds(html)) noteLink(canvasId, id, from);
  };
  // A course whose assignments call failed is left out of the soft-delete scope below: an empty answer from a 5xx
  // or a cancelled run once read as "every assignment is gone" and the push sync deleted the Todoist tasks.
  const failedCourses = new Set<string>();
  for (const [canvasId, cc] of ctxByCanvasId) {
    let list: CanvasAssignment[];
    try {
      list = await client.getAll<CanvasAssignment>(`/api/v1/courses/${canvasId}/assignments`, { 'include[]': ['submission'], order_by: 'due_at' }, { signal });
    } catch (err) {
      if (err instanceof NeedsAuthError || isAbort(err, signal)) throw err;
      failedCourses.add(cc.courseId);
      ctx.log.warn({ err: (err as Error).message, course: cc.courseId }, 'canvas assignments unavailable; keeping existing rows');
      continue;
    }
    for (const a of list) {
      if (a.published === false) continue;
      rows.set(`canvas:assignment:${a.id}`, assignmentToRow(a, cc, baseUrl));
      noteLinks(canvasId, a.description, { kind: 'assignment', title: a.name });
    }
  }
  counts.assignments = rows.size;
  counts.coursesFailed = failedCourses.size;

  // Planner overlay: planner overrides (marked complete), missing flags, events, announcements in the window.
  const now = new Date();
  const planner = await client.tryGetAll<PlannerItem>(
    '/api/v1/planner/items',
    { start_date: addDays(now, -PLANNER_PAST_DAYS).toISOString(), end_date: addDays(now, PLANNER_FUTURE_DAYS).toISOString() },
    { signal, maxPages: 10 },
  );
  let plannerUsed = 0;
  for (const p of planner) {
    const cc = p.course_id != null ? ctxByCanvasId.get(String(p.course_id)) : undefined;
    if (!cc) continue; // untracked course (old term, advising shells)
    const row = plannerToRow(p, cc, baseUrl);
    if (!row) continue;
    plannerUsed++;
    const existing = rows.get(row.id);
    if (existing) {
      // keep the richer assignment row, but planner knows about overrides / missing
      const plannerSaysDone = row.status === 'done';
      rows.set(row.id, {
        ...existing,
        status: plannerSaysDone ? 'done' : existing.status === 'open' && row.status !== 'open' ? row.status : existing.status,
        url: existing.url ?? row.url,
        raw: { ...(existing.raw as object), plannerOverride: (row.raw as { plannerOverride?: unknown }).plannerOverride ?? null },
      });
    } else {
      rows.set(row.id, row);
    }
  }
  counts.plannerItems = plannerUsed;

  // Announcements for tracked courses (planner only shows unread ones).
  const contextCodes = [...ctxByCanvasId.keys()].map((id) => `course_${id}`);
  const anns = await client.tryGetAll<CanvasAnnouncement>(
    '/api/v1/announcements',
    { 'context_codes[]': contextCodes, start_date: addDays(now, -ANNOUNCEMENT_PAST_DAYS).toISOString().slice(0, 10), end_date: addDays(now, 7).toISOString().slice(0, 10) },
    { signal, maxPages: 3 },
  );
  for (const a of anns) {
    const canvasId = (a.context_code ?? '').replace('course_', '');
    const cc = ctxByCanvasId.get(canvasId);
    if (!cc) continue;
    rows.set(`canvas:announcement:${a.id}`, announcementToRow(a, cc, baseUrl));
    noteLinks(canvasId, a.message, { kind: 'announcement', title: a.title });
  }
  counts.announcements = anns.length;

  // Upsert. Soft-delete assignments for tracked courses that Canvas no longer returns; leave events/announcements to age out.
  const deleteScope = trackedCourseIds.filter((id) => !failedCourses.has(id));
  const result = await upsertItems(ctx, 'canvas', [...rows.values()], deleteScope.length ? [eq(items.kind, 'assignment'), inArray(items.courseId, deleteScope)] : undefined);
  counts.upserted = result.upserted;
  counts.created = result.created;
  counts.deleted = result.deleted;

  // Course content for the class widget and the file sync: syllabus, module items, files.
  let content = 0;
  let linkedFiles = 0;
  for (const [canvasId, cc] of ctxByCanvasId) {
    const detail = await client.tryGet<{ syllabus_body?: string | null }>(`/api/v1/courses/${canvasId}`, { 'include[]': ['syllabus_body'] }, signal);
    const mods = await client.tryGetAll<CanvasModule>(`/api/v1/courses/${canvasId}/modules`, { 'include[]': ['items'] }, { signal, maxPages: 3 });
    // Every file, with its folder: the file sync sorts on folder path and module name (DESIGN "File sync to a laptop").
    const files = await client.tryGetAll<CanvasFile>(`/api/v1/courses/${canvasId}/files`, { sort: 'updated_at', order: 'desc' }, { signal, maxPages: 10 });
    const folders = files.length ? await client.tryGetAll<CanvasFolder>(`/api/v1/courses/${canvasId}/folders`, {}, { signal, maxPages: 5 }) : [];
    // Files the syllabus, assignment descriptions, announcements or modules point at but the listing does not show:
    // they live in hidden Files folders (a syllabus PDF, an assignment's spec). One lookup each, capped.
    const moduleByFile = moduleNamesByFileId(mods);
    noteLinks(canvasId, detail?.syllabus_body, { kind: 'syllabus', title: 'Syllabus' });
    for (const m of mods) for (const it of m.items ?? []) if (it.type === 'File' && it.content_id != null) noteLink(canvasId, String(it.content_id), { kind: 'module', title: m.name });
    const listed = new Set(files.map((f) => String(f.id)));
    const extra: { file: CanvasFile; from: LinkedFrom }[] = [];
    for (const [fileId, from] of linked.get(canvasId) ?? []) {
      if (listed.has(fileId)) continue;
      if (extra.length >= MAX_LINKED_FILES) break;
      const f = (await client.getResource<CanvasFile>(`/api/v1/courses/${canvasId}/files/${fileId}`, signal)) ?? (await client.getResource<CanvasFile>(`/api/v1/files/${fileId}`, signal));
      if (f && f.id != null) extra.push({ file: f, from });
    }
    linkedFiles += extra.length;
    // Grades: assignment groups (weights, drop rules) and Canvas's own totals for the enrollment. Not for TA courses.
    const groups = cc.role === 'ta' ? [] : await client.tryGetAll<CanvasAssignmentGroup>(`/api/v1/courses/${canvasId}/assignment_groups`, {}, { signal, maxPages: 2 });
    const canvasCourse = canvasCourseById.get(canvasId);
    const syllabus = syllabusToContent(detail?.syllabus_body, cc.courseId, canvasId, baseUrl);
    const contentRows = [
      ...(syllabus ? [syllabus] : []),
      ...modulesToContent(mods, cc.courseId, baseUrl),
      ...filesToContent(files, cc.courseId, folders, moduleByFile),
      ...linkedFilesToContent(extra, cc.courseId, folders, moduleByFile),
      ...gradeGroupsToContent(groups, cc.courseId),
      ...(canvasCourse && cc.role !== 'ta' ? [gradeSummaryToContent(canvasCourse, cc.courseId, baseUrl)] : []),
    ];
    content += await replaceCourseContent(ctx, cc.courseId, ['syllabus', 'module_item', 'file', 'grade_group', 'grade_summary'], contentRows);
  }
  counts.content = content;
  counts.linkedFiles = linkedFiles;
  counts.requests = client.requestCount;
  return counts;
}

export const canvasIngester: Ingester = {
  id: 'canvas',
  intervalMinutes: 15,
  timeoutMs: 240_000,
  async run(ctx, signal) {
    const config = await getSourceConfig<CanvasConfig>(ctx, 'canvas');
    if (!config) throw new NotConfiguredError('Canvas is not set up: add an access token in Settings → Sources');
    const parsed = sourceConfigSchemas.canvas.parse(config);
    const client = await CanvasClient.fromConfig(parsed, ctx.log);
    try {
      const counts = await syncCanvas(ctx, client, signal);
      return { counts };
    } finally {
      // A cookie session is always persisted back: Canvas rotates the session cookie on responses, and the sliding
      // expiry only slides if we keep the newest value. A token does not rotate, so the stored config stays as is.
      if (client.authMode === 'cookie') {
        const jar = await client.serializeJar();
        await setSourceConfig(ctx, 'canvas', { baseUrl: parsed.baseUrl, cookieJar: jar });
      }
    }
  },
};
