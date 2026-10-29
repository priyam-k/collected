import type { CanvasEnrollment, CourseRole } from '@collected/shared';
import type { AppContext } from '../../context.js';
import { courses, widgetInstances } from '../../db/schema.js';
import { COURSE_COLORS, courseSlug } from '../../seed.js';
import { enrollmentRole, type CanvasCourse } from './map.js';

/*
 * Turning what Canvas says you are enrolled in into course rows. The onboarding route offers the list and takes a
 * selection; the Canvas demo loader uses the same path on an empty database so the fixtures have courses to land in.
 */

/** "Fall 2026" → "2026-fall"; anything else is returned as a slug of itself. */
export function termSlug(name: string | null | undefined): string {
  const m = (name ?? '').trim().match(/^(fall|spring|summer|winter)\s+(\d{4})$/i) ?? (name ?? '').trim().match(/^(\d{4})\s+(fall|spring|summer|winter)$/i);
  if (m) {
    const [a, b] = [m[1]!.toLowerCase(), m[2]!.toLowerCase()];
    return /^\d{4}$/.test(a) ? `${a}-${b}` : `${b}-${a}`;
  }
  const s = (name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return s || 'term';
}

/** "CMSC330-0101,0102: Organization…" → { code: "CMSC330", section: "0101" }; "Math423 Linear Optimization" → { code: "MATH423" }. */
export function splitCourseCode(courseCode: string, name: string): { code: string; section: string | null } {
  const head = (courseCode || name).split(':')[0]!.trim();
  const m = head.match(/^([A-Za-z]{2,5}\s?\d{3}[A-Za-z]?)(?:[-\s]+(\d{3,4}[A-Za-z]?))?/);
  if (m) return { code: m[1]!.toUpperCase().replace(/\s+/g, ''), section: m[2] ?? null };
  return { code: head.toUpperCase().replace(/\s+/g, '').slice(0, 40) || 'COURSE', section: null };
}

export function toEnrollment(k: CanvasCourse, trackedAs: string | null): CanvasEnrollment {
  const { code, section } = splitCourseCode(k.course_code ?? '', k.name ?? '');
  const role = enrollmentRole(k);
  return {
    canvasCourseId: String(k.id),
    name: k.name ?? k.course_code ?? String(k.id),
    courseCode: k.course_code ?? '',
    termName: k.term?.name ?? null,
    role: role === 'other' ? 'student' : role,
    trackedAs,
    suggested: { term: termSlug(k.term?.name), code, section },
  };
}

/** Active, undeleted enrollments as the onboarding list shows them. */
export const activeEnrollments = (list: CanvasCourse[]): CanvasCourse[] => list.filter((k) => k.workflow_state !== 'deleted' && (k.enrollments ?? []).some((e) => !e.enrollment_state || e.enrollment_state === 'active'));

export interface CourseImport {
  canvasCourseId: string;
  term: string;
  code: string;
  section?: string | null | undefined;
  name?: string | null | undefined;
  role: CourseRole;
}

/** One enrollment as the import takes it: the suggested slug parts, the Canvas name, the role Canvas reports. */
export const importFromEnrollment = (e: CanvasEnrollment): CourseImport => ({ canvasCourseId: e.canvasCourseId, ...e.suggested, name: e.name, role: e.role });

/**
 * Creates a course row (plus its hidden class widget) per import, skipping a Canvas course that is already tracked or a
 * slug that already exists. Colors are handed out from the palette, unused ones first.
 */
export async function importCanvasCourses(ctx: AppContext, list: CourseImport[]): Promise<{ created: string[]; skipped: { canvasCourseId: string; reason: string }[] }> {
  const existing = await ctx.db.select({ id: courses.id, canvasCourseId: courses.canvasCourseId, color: courses.color }).from(courses);
  const byCanvasId = new Map(existing.filter((e) => e.canvasCourseId).map((e) => [e.canvasCourseId!, e.id]));
  const ids = new Set(existing.map((e) => e.id));
  const used = new Set(existing.map((e) => e.color).filter(Boolean));
  const created: string[] = [];
  const skipped: { canvasCourseId: string; reason: string }[] = [];
  for (const k of list) {
    if (byCanvasId.has(k.canvasCourseId)) {
      skipped.push({ canvasCourseId: k.canvasCourseId, reason: `already tracked as ${byCanvasId.get(k.canvasCourseId)}` });
      continue;
    }
    const id = courseSlug(k.term, k.code, k.section);
    if (ids.has(id)) {
      skipped.push({ canvasCourseId: k.canvasCourseId, reason: `course ${id} already exists` });
      continue;
    }
    const color = COURSE_COLORS.find((x) => !used.has(x)) ?? COURSE_COLORS[created.length % COURSE_COLORS.length]!;
    used.add(color);
    await ctx.db.insert(courses).values({ id, term: k.term, code: k.code.toUpperCase().replace(/\s+/g, ''), section: k.section ?? null, name: k.name ?? null, role: k.role, canvasCourseId: k.canvasCourseId, submitsVia: 'both', color, links: [], schedule: {}, archived: false });
    await ctx.db.insert(widgetInstances).values({ id: `class:${id}`, type: 'class', config: { courseId: id }, hidden: true }).onConflictDoNothing();
    ids.add(id);
    byCanvasId.set(k.canvasCourseId, id);
    created.push(id);
  }
  return { created, skipped };
}
