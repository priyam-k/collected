import { Hono } from 'hono';
import { layoutsSchema, widgetInstanceInputSchema, type Breakpoint, type Layouts, type WidgetInstance } from '@collected/shared';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { layouts, widgetInstances } from '../db/schema.js';
import { bad, parseBody } from './util.js';

export function layoutRoutes(ctx: AppContext) {
  const r = new Hono();

  r.get('/', async (c) => {
    const rows = await ctx.db.select().from(layouts);
    const out: Layouts = {};
    for (const row of rows) out[row.breakpoint as Breakpoint] = row.layout;
    return c.json(out);
  });

  /** Replaces every breakpoint present in the body; omitted breakpoints are left alone. */
  r.put('/', async (c) => {
    const body = await parseBody(c, layoutsSchema);
    for (const [bp, layout] of Object.entries(body)) {
      if (!layout) continue;
      await ctx.db
        .insert(layouts)
        .values({ breakpoint: bp, layout })
        .onConflictDoUpdate({ target: layouts.breakpoint, set: { layout, updatedAt: new Date().toISOString() } });
    }
    return c.json({ ok: true });
  });

  r.delete('/', async (c) => {
    await ctx.db.delete(layouts);
    return c.json({ ok: true });
  });

  return r;
}

export function widgetRoutes(ctx: AppContext) {
  const r = new Hono();

  r.get('/', async (c) => {
    const rows = await ctx.db.select().from(widgetInstances);
    return c.json(rows as WidgetInstance[]);
  });

  r.put('/:id', async (c) => {
    const id = c.req.param('id');
    const body = await parseBody(c, widgetInstanceInputSchema.omit({ id: true }).partial().extend({ type: z.string().min(1).optional() }));
    const existing = await ctx.db.query.widgetInstances.findFirst({ where: eq(widgetInstances.id, id) });
    if (existing) {
      await ctx.db.update(widgetInstances).set(body).where(eq(widgetInstances.id, id));
    } else {
      if (!body.type) bad('type required to create a widget instance', 422);
      await ctx.db.insert(widgetInstances).values({ id, type: body.type, config: body.config ?? {}, hidden: body.hidden ?? false });
    }
    return c.json(await ctx.db.query.widgetInstances.findFirst({ where: eq(widgetInstances.id, id) }));
  });

  r.delete('/:id', async (c) => {
    await ctx.db.delete(widgetInstances).where(eq(widgetInstances.id, c.req.param('id')));
    return c.json({ ok: true });
  });

  return r;
}
