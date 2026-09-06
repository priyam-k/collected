import { Hono } from 'hono';
import { z } from 'zod';
import { courseInputSchema, layoutsSchema, widgetInstanceInputSchema } from '@collected/shared';
import type { AppContext } from '../context.js';
import { courses, layouts, settings, widgetInstances } from '../db/schema.js';
import { courseSlug } from '../seed.js';
import { parseBody } from './util.js';

const exportSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string().optional(),
  courses: z.array(courseInputSchema.extend({ id: z.string().optional() })).default([]),
  settings: z.record(z.string(), z.unknown()).default({}),
  widgets: z.array(widgetInstanceInputSchema).default([]),
  layouts: layoutsSchema.default({}),
});

/** Everything non-secret and user-authored: courses, settings, widget instances, layouts. */
export async function buildExport(ctx: AppContext) {
  const [cs, ss, ws, ls] = await Promise.all([
    ctx.db.select().from(courses),
    ctx.db.select().from(settings),
    ctx.db.select().from(widgetInstances),
    ctx.db.select().from(layouts),
  ]);
  return {
    version: 1 as const,
    exportedAt: new Date().toISOString(),
    courses: cs.map(({ createdAt: _c, updatedAt: _u, ...rest }) => rest),
    settings: Object.fromEntries(ss.map((s) => [s.key, s.value])),
    widgets: ws.map(({ createdAt: _c, ...rest }) => rest),
    layouts: Object.fromEntries(ls.map((l) => [l.breakpoint, l.layout])),
  };
}

export async function applyImport(ctx: AppContext, data: z.infer<typeof exportSchema>) {
  for (const course of data.courses) {
    const { id: givenId, ...rest } = course;
    const id = givenId ?? courseSlug(rest.term, rest.code, rest.section);
    await ctx.db
      .insert(courses)
      .values({ id, ...rest })
      .onConflictDoUpdate({ target: courses.id, set: rest });
    await ctx.db.insert(widgetInstances).values({ id: `class:${id}`, type: 'class', config: { courseId: id }, hidden: true }).onConflictDoNothing();
  }
  for (const [key, value] of Object.entries(data.settings)) {
    await ctx.db
      .insert(settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: settings.key, set: { value } });
  }
  for (const w of data.widgets) {
    await ctx.db
      .insert(widgetInstances)
      .values(w)
      .onConflictDoUpdate({ target: widgetInstances.id, set: { type: w.type, config: w.config, hidden: w.hidden } });
  }
  for (const [bp, layout] of Object.entries(data.layouts)) {
    if (!layout) continue;
    await ctx.db
      .insert(layouts)
      .values({ breakpoint: bp, layout })
      .onConflictDoUpdate({ target: layouts.breakpoint, set: { layout } });
  }
  return { courses: data.courses.length, settings: Object.keys(data.settings).length, widgets: data.widgets.length, layouts: Object.keys(data.layouts).length };
}

export const importSchema = exportSchema;

export function exportRoutes(ctx: AppContext) {
  const r = new Hono();
  r.get('/export', async (c) => c.json(await buildExport(ctx)));
  r.post('/import', async (c) => {
    const data = await parseBody(c, exportSchema);
    return c.json(await applyImport(ctx, data));
  });
  return r;
}
