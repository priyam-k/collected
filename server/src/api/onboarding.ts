import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { COURSE_ROLES, sourceConfigSchemas, type CanvasEnrollment } from '@collected/shared';
import type { AppContext } from '../context.js';
import { courses, widgetInstances } from '@collected/core/db/schema';
import { CanvasClient, type CanvasConfig } from '@collected/core/ingest/canvas/client';
import { canvasIngester } from '@collected/core/ingest/canvas/ingest';
import { enrollmentRole, type CanvasCourse } from '@collected/core/ingest/canvas/map';
import { runIngester } from '@collected/core/ingest/runner';
import { NeedsAuthError } from '@collected/core/ingest/types';
import { getSourceConfig, setSourceStatus } from '@collected/core/lib/sources';
import { COURSE_COLORS, courseSlug } from '@collected/core/seed';
import { bad, parseBody } from './util.js';
import type { CanvasClientFactory } from './canvas.js';

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

const importSchema = z.object({
  courses: z
    .array(
      z.object({
        canvasCourseId: z.string().min(1).max(40),
        term: z.string().trim().min(1).max(40),
        code: z.string().trim().min(1).max(40),
        section: z.string().trim().max(40).nullable().optional(),
        name: z.string().trim().max(200).nullable().optional(),
        role: z.enum(COURSE_ROLES).default('student'),
      }),
    )
    .min(1)
    .max(50),
});

/**
 * First-run onboarding: what Canvas says you are enrolled in, and one call to turn a selection into course rows.
 * Replaces hand-editing seed-config.json (DESIGN "Onboarding").
 */
export function onboardingRoutes(ctx: AppContext, clientFor: CanvasClientFactory = (config) => CanvasClient.fromConfig(config, ctx.log)) {
  const r = new Hono();

  r.get('/canvas', async (c) => {
    const config = await getSourceConfig<CanvasConfig>(ctx, 'canvas');
    if (!config) return c.json({ error: 'Canvas is not connected', connected: false, courses: [] }, 409);
    const client = await clientFor(sourceConfigSchemas.canvas.parse(config));
    try {
      const list = await client.getAll<CanvasCourse>('/api/v1/courses', { enrollment_state: 'active', 'include[]': ['term'] }, { signal: AbortSignal.timeout(45_000), maxPages: 5 });
      const ours = await ctx.db.select({ id: courses.id, canvasCourseId: courses.canvasCourseId }).from(courses);
      const tracked = new Map(ours.filter((o) => o.canvasCourseId).map((o) => [o.canvasCourseId!, o.id]));
      const out = list
        .filter((k) => k.workflow_state !== 'deleted' && (k.enrollments ?? []).some((e) => !e.enrollment_state || e.enrollment_state === 'active'))
        .map((k) => toEnrollment(k, tracked.get(String(k.id)) ?? null));
      c.header('Cache-Control', 'no-store');
      return c.json({ connected: true, courses: out });
    } catch (err) {
      if (err instanceof NeedsAuthError) {
        await setSourceStatus(ctx, 'canvas', 'needs_auth', { lastError: err.message });
        return c.json({ error: 'Canvas session expired; reconnect it', connected: false, courses: [] }, 502);
      }
      throw err;
    }
  });

  r.post('/canvas', async (c) => {
    const body = await parseBody(c, importSchema);
    const existing = await ctx.db.select({ id: courses.id, canvasCourseId: courses.canvasCourseId, color: courses.color }).from(courses);
    const byCanvasId = new Map(existing.filter((e) => e.canvasCourseId).map((e) => [e.canvasCourseId!, e.id]));
    const ids = new Set(existing.map((e) => e.id));
    const used = new Set(existing.map((e) => e.color).filter(Boolean));
    const created: string[] = [];
    const skipped: { canvasCourseId: string; reason: string }[] = [];
    for (const k of body.courses) {
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
    if (created.length && !ctx.env.SCHEDULER_DISABLED) void runIngester(ctx, canvasIngester, { force: true });
    ctx.log.info({ created, skipped: skipped.length }, 'courses imported from canvas');
    return c.json({ created, skipped }, created.length ? 201 : 200);
  });

  return r;
}

export const canvasCourseExists = async (ctx: AppContext, id: string) => !!(await ctx.db.query.courses.findFirst({ where: eq(courses.id, id) }));
