import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { allowedTargets, fileSyncOverrideSchema, fileSyncReportSchema } from '@collected/shared';
import type { AppContext } from '../context.js';
import { courses } from '@collected/core/db/schema';
import { applyReport, buildManifest, configOf, courseView, listDevices, listSyncFiles, setManualTarget } from '@collected/core/lib/file-sync';
import { bad, parseBody } from './util.js';

/**
 * Course files → laptop folders (DESIGN "File sync to a laptop"). The agent pulls the manifest and posts a report;
 * the web reads one course's decisions and sets overrides. Auth is the API-wide middleware: Access JWT (browser or
 * service token) or the helper key.
 */
export function fileSyncRoutes(ctx: AppContext) {
  const r = new Hono();

  r.get('/manifest', async (c) => c.json(await buildManifest(ctx)));

  r.post('/report', async (c) => {
    const report = await parseBody(c, fileSyncReportSchema);
    const result = await applyReport(ctx, report);
    ctx.log.info({ device: report.device, ...result, errors: report.errors.length }, 'file sync report');
    return c.json({ ok: true, ...result });
  });

  r.get('/devices', async (c) => c.json(await listDevices(ctx)));

  r.get('/courses/:id', async (c) => {
    const course = await ctx.db.query.courses.findFirst({ where: eq(courses.id, c.req.param('id')) });
    if (!course) bad('course not found', 404);
    const view = await courseView(ctx, course);
    if (!view) bad('file sync is not set up for this course', 404);
    return c.json(view);
  });

  r.put('/courses/:id/files/:fileId', async (c) => {
    const course = await ctx.db.query.courses.findFirst({ where: eq(courses.id, c.req.param('id')) });
    if (!course) bad('course not found', 404);
    const config = configOf(course);
    if (!config) bad('file sync is not set up for this course', 409);
    const { target } = await parseBody(c, fileSyncOverrideSchema);
    if (target && !allowedTargets(config).includes(target)) bad(`unknown target "${target}"`, 422);
    const fileId = c.req.param('fileId');
    if (!(await listSyncFiles(ctx, course.id)).some((f) => f.fileId === fileId)) bad('no such file in this course', 404);
    await setManualTarget(ctx, course.id, fileId, target);
    const view = await courseView(ctx, course);
    return c.json(view!.files.find((f) => f.fileId === c.req.param('fileId')) ?? { ok: true });
  });

  return r;
}
