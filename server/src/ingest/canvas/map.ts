import type { CourseRole, ItemStatus } from '@collected/shared';
import type { CourseRow, NewItemRow } from '../../db/schema.js';
import { isoOrNull } from '../../lib/time.js';

/* ---------- Canvas shapes (only the fields we read) ---------- */

export interface CanvasCourse {
  id: number | string;
  name: string;
  course_code: string;
  sis_course_id?: string | null;
  workflow_state?: string;
  term?: { id: number | string; name: string } | null;
  enrollments?: { type: string; role?: string; enrollment_state?: string }[];
  calendar?: { ics?: string };
}

export interface CanvasSubmission {
  workflow_state?: string; // unsubmitted | submitted | graded | pending_review
  submitted_at?: string | null;
  late?: boolean;
  missing?: boolean;
  excused?: boolean | null;
  score?: number | null;
  grade?: string | null;
}

export interface CanvasAssignment {
  id: number | string;
  course_id: number | string;
  name: string;
  description?: string | null;
  html_url?: string;
  due_at?: string | null;
  unlock_at?: string | null;
  lock_at?: string | null;
  points_possible?: number | null;
  published?: boolean;
  submission_types?: string[];
  is_quiz_assignment?: boolean;
  quiz_id?: number | string | null;
  needs_grading_count?: number | null;
  has_submitted_submissions?: boolean;
  submission?: CanvasSubmission | null;
  updated_at?: string;
}

export interface PlannerItem {
  context_type?: string;
  context_name?: string;
  course_id?: number | string | null;
  html_url?: string | null;
  plannable_type: string; // assignment | quiz | discussion_topic | announcement | calendar_event | planner_note | wiki_page | assessment_request
  plannable_id: number | string;
  plannable_date?: string;
  plannable: {
    id: number | string;
    title?: string;
    due_at?: string | null;
    todo_date?: string | null;
    start_at?: string | null;
    end_at?: string | null;
    all_day?: boolean;
    points_possible?: number | null;
    assignment_id?: number | string | null;
    location_name?: string | null;
    details?: string | null;
  };
  planner_override?: { marked_complete?: boolean; dismissed?: boolean } | null;
  submissions?:
    | false
    | { submitted?: boolean; graded?: boolean; late?: boolean; missing?: boolean; excused?: boolean; needs_grading?: boolean }
    | undefined;
}

export interface CanvasAnnouncement {
  id: number | string;
  title: string;
  message?: string | null;
  html_url?: string;
  posted_at?: string | null;
  created_at?: string;
  context_code?: string; // course_1408462
}

export interface CanvasModule {
  id: number | string;
  name: string;
  position?: number;
  items?: CanvasModuleItem[];
}

export interface CanvasModuleItem {
  id: number | string;
  title: string;
  type: string; // File | Page | Discussion | Assignment | Quiz | SubHeader | ExternalUrl | ExternalTool
  position?: number;
  indent?: number;
  html_url?: string;
  external_url?: string;
  url?: string;
  content_id?: number | string;
  published?: boolean;
}

export interface CanvasFile {
  id: number | string;
  display_name?: string;
  filename?: string;
  url?: string;
  size?: number;
  'content-type'?: string;
  updated_at?: string;
  modified_at?: string;
  hidden_for_user?: boolean;
  locked_for_user?: boolean;
}

/* ---------- helpers ---------- */

const SEASONS: Record<string, string> = { fall: 'Fall', spring: 'Spring', summer: 'Summer', winter: 'Winter' };

/** "2026-fall" → "Fall 2026"; anything else is returned as-is. */
export function termLabel(slug: string): string {
  const m = slug.trim().toLowerCase().match(/^(\d{4})[-_ ]?(fall|spring|summer|winter)$/) ?? slug.trim().toLowerCase().match(/^(fall|spring|summer|winter)[-_ ]?(\d{4})$/);
  if (!m) return slug;
  const [a, b] = [m[1]!, m[2]!];
  const year = /^\d{4}$/.test(a) ? a : b;
  const season = /^\d{4}$/.test(a) ? b : a;
  return `${SEASONS[season] ?? season} ${year}`;
}

export const normCode = (s: string | null | undefined): string => (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export function absUrl(baseUrl: string, url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^https?:\/\//.test(url)) return url;
  return `${baseUrl.replace(/\/$/, '')}${url.startsWith('/') ? '' : '/'}${url}`;
}

export function enrollmentRole(course: CanvasCourse): CourseRole | 'other' {
  const types = new Set((course.enrollments ?? []).map((e) => e.type));
  if (types.has('ta') || types.has('teacher') || types.has('designer')) return 'ta';
  if (types.has('student') || types.has('observer')) return 'student';
  return 'other';
}

/**
 * Pairs our courses with Canvas courses.
 * Explicit canvasCourseId wins. Otherwise: same normalized code, same term label, role agrees; must be unambiguous.
 */
export function matchCourses(ours: CourseRow[], canvas: CanvasCourse[]): { matched: Map<string, CanvasCourse>; autoFilled: { courseId: string; canvasCourseId: string }[] } {
  const matched = new Map<string, CanvasCourse>();
  const autoFilled: { courseId: string; canvasCourseId: string }[] = [];
  const byId = new Map(canvas.map((c) => [String(c.id), c]));
  for (const c of ours) {
    if (c.archived) continue;
    if (c.canvasCourseId && byId.has(c.canvasCourseId)) {
      matched.set(c.id, byId.get(c.canvasCourseId)!);
      continue;
    }
    if (c.canvasCourseId) continue; // explicit id that Canvas didn't return; leave alone
    const want = normCode(c.code);
    const term = termLabel(c.term).toLowerCase();
    let candidates = canvas.filter((k) => normCode(k.course_code) === want || normCode(k.name).startsWith(want));
    candidates = candidates.filter((k) => (k.term?.name ?? '').toLowerCase() === term || sisTermMatches(k.sis_course_id, c.term));
    if (candidates.length > 1) candidates = candidates.filter((k) => enrollmentRole(k) === c.role);
    if (candidates.length === 1) {
      const k = candidates[0]!;
      matched.set(c.id, k);
      autoFilled.push({ courseId: c.id, canvasCourseId: String(k.id) });
    }
  }
  return { matched, autoFilled };
}

/** UMD SIS ids look like 202608-CMSC330-…: YYYYMM where 01=spring, 05=summer, 08=fall. */
function sisTermMatches(sis: string | null | undefined, termSlug: string): boolean {
  if (!sis) return false;
  const m = sis.match(/^(\d{4})(\d{2})-/);
  if (!m) return false;
  const season = { '01': 'spring', '05': 'summer', '08': 'fall', '12': 'winter' }[m[2]!];
  return termLabel(termSlug).toLowerCase() === `${season} ${m[1]}`;
}

export function submissionStatus(sub: CanvasSubmission | null | undefined): ItemStatus {
  if (!sub) return 'open';
  if (sub.excused) return 'done';
  if (sub.missing) return 'missing';
  const state = sub.workflow_state ?? '';
  if (state === 'graded') return sub.late ? 'late' : 'graded';
  if (state === 'submitted' || state === 'pending_review' || sub.submitted_at) return sub.late ? 'late' : 'submitted';
  return 'open';
}

export function plannerStatus(p: PlannerItem): ItemStatus {
  if (p.planner_override?.marked_complete) return 'done';
  const s = p.submissions;
  if (!s) return 'open';
  if (s.excused) return 'done';
  if (s.missing) return 'missing';
  if (s.graded) return s.late ? 'late' : 'graded';
  if (s.submitted) return s.late ? 'late' : 'submitted';
  return 'open';
}

/* ---------- row builders ---------- */

export interface CourseCtx {
  courseId: string;
  role: CourseRole;
}

export function assignmentToRow(a: CanvasAssignment, course: CourseCtx, baseUrl: string): NewItemRow {
  const ta = course.role === 'ta';
  return {
    id: `canvas:assignment:${a.id}`,
    source: 'canvas',
    externalId: `assignment:${a.id}`,
    kind: 'assignment',
    courseId: course.courseId,
    title: a.name,
    description: a.description ? stripHtml(a.description).slice(0, 2000) : null,
    url: absUrl(baseUrl, a.html_url) ?? `${baseUrl}/courses/${a.course_id}/assignments/${a.id}`,
    dueAt: isoOrNull(a.due_at),
    startsAt: isoOrNull(a.unlock_at),
    endsAt: isoOrNull(a.lock_at),
    allDay: false,
    status: ta ? 'open' : submissionStatus(a.submission),
    points: a.points_possible ?? null,
    score: a.submission?.score ?? null,
    labels: [],
    raw: {
      ta,
      canvasCourseId: String(a.course_id),
      submissionTypes: a.submission_types ?? [],
      isQuiz: !!a.is_quiz_assignment,
      quizId: a.quiz_id ?? null,
      needsGradingCount: a.needs_grading_count ?? null,
      published: a.published ?? true,
      submittedAt: a.submission?.submitted_at ?? null,
      late: !!a.submission?.late,
      updatedAt: a.updated_at ?? null,
    },
  };
}

/**
 * Planner items overlay: gives us calendar events, announcements, and the planner override / missing flags.
 * Returns null for plannable types we don't track (bare discussions, wiki pages, peer reviews).
 */
export function plannerToRow(p: PlannerItem, course: CourseCtx | null, baseUrl: string): NewItemRow | null {
  const ta = course?.role === 'ta';
  const t = p.plannable_type;
  const base = {
    source: 'canvas' as const,
    courseId: course?.courseId ?? null,
    allDay: false,
    labels: [] as string[],
    score: null,
  };
  const url = absUrl(baseUrl, p.html_url ?? null);
  if (t === 'assignment' || t === 'quiz' || (t === 'discussion_topic' && p.plannable.assignment_id)) {
    const assignmentId = t === 'assignment' ? p.plannable.id : (p.plannable.assignment_id ?? null);
    const externalId = assignmentId ? `assignment:${assignmentId}` : `quiz:${p.plannable.id}`;
    return {
      ...base,
      id: `canvas:${externalId}`,
      externalId,
      kind: 'assignment',
      title: p.plannable.title ?? 'Untitled',
      description: null,
      url,
      dueAt: isoOrNull(p.plannable.due_at ?? p.plannable_date),
      startsAt: null,
      endsAt: null,
      status: ta ? 'open' : plannerStatus(p),
      points: p.plannable.points_possible ?? null,
      raw: { ta, plannerType: t, plannerOverride: p.planner_override ?? null, plannerSubmissions: p.submissions ?? null, contextName: p.context_name ?? null },
    };
  }
  if (t === 'announcement') {
    return {
      ...base,
      id: `canvas:announcement:${p.plannable.id}`,
      externalId: `announcement:${p.plannable.id}`,
      kind: 'announcement',
      title: p.plannable.title ?? 'Announcement',
      description: null,
      url,
      startsAt: isoOrNull(p.plannable_date),
      endsAt: null,
      dueAt: null,
      status: 'open',
      points: null,
      raw: { plannerType: t, contextName: p.context_name ?? null },
    };
  }
  if (t === 'calendar_event') {
    return {
      ...base,
      id: `canvas:event:${p.plannable.id}`,
      externalId: `event:${p.plannable.id}`,
      kind: 'event',
      title: p.plannable.title ?? 'Event',
      description: p.plannable.location_name ?? null,
      url,
      startsAt: isoOrNull(p.plannable.start_at ?? p.plannable_date),
      endsAt: isoOrNull(p.plannable.end_at),
      dueAt: null,
      allDay: !!p.plannable.all_day,
      status: 'open',
      points: null,
      raw: { plannerType: t, location: p.plannable.location_name ?? null, contextName: p.context_name ?? null },
    };
  }
  if (t === 'planner_note') {
    return {
      ...base,
      id: `canvas:note:${p.plannable.id}`,
      externalId: `note:${p.plannable.id}`,
      kind: 'task',
      title: p.plannable.title ?? 'Note',
      description: p.plannable.details ?? null,
      url,
      dueAt: isoOrNull(p.plannable.todo_date ?? p.plannable_date),
      startsAt: null,
      endsAt: null,
      status: p.planner_override?.marked_complete ? 'done' : 'open',
      points: null,
      raw: { plannerType: t },
    };
  }
  return null;
}

export function announcementToRow(a: CanvasAnnouncement, course: CourseCtx, baseUrl: string): NewItemRow {
  return {
    id: `canvas:announcement:${a.id}`,
    source: 'canvas',
    externalId: `announcement:${a.id}`,
    kind: 'announcement',
    courseId: course.courseId,
    title: a.title,
    description: a.message ? stripHtml(a.message).slice(0, 2000) : null,
    url: absUrl(baseUrl, a.html_url),
    startsAt: isoOrNull(a.posted_at ?? a.created_at),
    endsAt: null,
    dueAt: null,
    allDay: false,
    status: 'open',
    points: null,
    score: null,
    labels: [],
    raw: { contextCode: a.context_code ?? null },
  };
}

export interface ContentRow {
  id: string;
  courseId: string;
  kind: string;
  externalId: string;
  moduleName: string | null;
  title: string;
  url: string | null;
  position: number | null;
  raw: Record<string, unknown>;
}

export function modulesToContent(mods: CanvasModule[], courseId: string, baseUrl: string): ContentRow[] {
  const out: ContentRow[] = [];
  for (const m of mods) {
    for (const it of m.items ?? []) {
      if (it.type === 'SubHeader') continue;
      if (it.published === false) continue;
      out.push({
        id: `${courseId}:module_item:${it.id}`,
        courseId,
        kind: 'module_item',
        externalId: String(it.id),
        moduleName: m.name,
        title: it.title,
        url: absUrl(baseUrl, it.html_url ?? it.external_url ?? null),
        position: (m.position ?? 0) * 1000 + (it.position ?? 0),
        raw: { type: it.type, indent: it.indent ?? 0, moduleId: String(m.id), contentId: it.content_id ?? null },
      });
    }
  }
  return out;
}

export function filesToContent(files: CanvasFile[], courseId: string): ContentRow[] {
  return files
    .filter((f) => !f.hidden_for_user && !f.locked_for_user)
    .map((f, i) => ({
      id: `${courseId}:file:${f.id}`,
      courseId,
      kind: 'file',
      externalId: String(f.id),
      moduleName: null,
      title: f.display_name || f.filename || `file ${f.id}`,
      url: f.url ?? null,
      position: i,
      raw: { size: f.size ?? null, contentType: f['content-type'] ?? null, updatedAt: f.updated_at ?? f.modified_at ?? null },
    }));
}

export function syllabusToContent(body: string | null | undefined, courseId: string, canvasCourseId: string, baseUrl: string): ContentRow | null {
  if (!body || !stripHtml(body).trim()) return null;
  return {
    id: `${courseId}:syllabus:syllabus`,
    courseId,
    kind: 'syllabus',
    externalId: 'syllabus',
    moduleName: null,
    title: 'Syllabus',
    url: `${baseUrl}/courses/${canvasCourseId}/assignments/syllabus`,
    position: 0,
    raw: { html: body.slice(0, 40_000), text: stripHtml(body).slice(0, 8000) },
  };
}

export function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>(?=.)/gi, '\n')
    .replace(/<\/(p|div|li|h\d|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
