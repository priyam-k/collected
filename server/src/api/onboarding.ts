import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { COURSE_ROLES, sourceConfigSchemas } from '@collected/shared';
import type { AppContext } from '../context.js';
import { courses } from '@collected/core/db/schema';
import { CanvasClient, needsAuthMessage, type CanvasConfig } from '@collected/core/ingest/canvas/client';
import { canvasIngester } from '@collected/core/ingest/canvas/ingest';
import type { CanvasCourse } from '@collected/core/ingest/canvas/map';
import { activeEnrollments, importCanvasCourses, splitCourseCode, termSlug, toEnrollment } from '@collected/core/ingest/canvas/onboarding';
import { runIngester } from '@collected/core/ingest/runner';
import { NeedsAuthError } from '@collected/core/ingest/types';
import { getSourceConfig, setSourceStatus } from '@collected/core/lib/sources';
import { bad, parseBody } from './util.js';
import type { CanvasClientFactory } from './canvas.js';

// termSlug, splitCourseCode and toEnrollment live in core (ingest/canvas/onboarding.ts); re-exported for their tests.
export { splitCourseCode, termSlug, toEnrollment };

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
      const out = activeEnrollments(list).map((k) => toEnrollment(k, tracked.get(String(k.id)) ?? null));
      c.header('Cache-Control', 'no-store');
      return c.json({ connected: true, courses: out });
    } catch (err) {
      if (err instanceof NeedsAuthError) {
        await setSourceStatus(ctx, 'canvas', 'needs_auth', { lastError: err.message });
        return c.json({ error: needsAuthMessage(client), connected: false, courses: [] }, 502);
      }
      throw err;
    }
  });

  r.post('/canvas', async (c) => {
    const body = await parseBody(c, importSchema);
    const { created, skipped } = await importCanvasCourses(ctx, body.courses);
    if (created.length && !ctx.env.SCHEDULER_DISABLED) void runIngester(ctx, canvasIngester, { force: true });
    ctx.log.info({ created, skipped: skipped.length }, 'courses imported from canvas');
    return c.json({ created, skipped }, created.length ? 201 : 200);
  });

  return r;
}

export const canvasCourseExists = async (ctx: AppContext, id: string) => !!(await ctx.db.query.courses.findFirst({ where: eq(courses.id, id) }));
