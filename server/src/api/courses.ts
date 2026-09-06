import { Hono } from 'hono';
import { asc, eq } from 'drizzle-orm';
import { courseInputSchema, type Course } from '@collected/shared';
import type { AppContext } from '../context.js';
import { courseContent, courses, widgetInstances } from '../db/schema.js';
import { courseSlug } from '../seed.js';
import { bad, parseBody } from './util.js';

const toPublic = (r: typeof courses.$inferSelect): Course => ({
  ...r,
  role: r.role as Course['role'],
  submitsVia: r.submitsVia as Course['submitsVia'],
});

export function coursesRoutes(ctx: AppContext) {
  const r = new Hono();

  r.get('/', async (c) => {
    const rows = await ctx.db.select().from(courses).orderBy(asc(courses.archived), asc(courses.code));
    return c.json(rows.map(toPublic));
  });

  r.post('/', async (c) => {
    const body = await parseBody(c, courseInputSchema);
    const id = courseSlug(body.term, body.code, body.section);
    const existing = await ctx.db.query.courses.findFirst({ where: eq(courses.id, id) });
    if (existing) bad(`course ${id} already exists`, 409);
    await ctx.db.insert(courses).values({ id, ...body });
    await ctx.db.insert(widgetInstances).values({ id: `class:${id}`, type: 'class', config: { courseId: id }, hidden: true }).onConflictDoNothing();
    const row = await ctx.db.query.courses.findFirst({ where: eq(courses.id, id) });
    return c.json(toPublic(row!), 201);
  });

  r.get('/:id', async (c) => {
    const row = await ctx.db.query.courses.findFirst({ where: eq(courses.id, c.req.param('id')) });
    if (!row) bad('course not found', 404);
    return c.json(toPublic(row));
  });

  r.put('/:id', async (c) => {
    const id = c.req.param('id');
    const row = await ctx.db.query.courses.findFirst({ where: eq(courses.id, id) });
    if (!row) bad('course not found', 404);
    const body = await parseBody(c, courseInputSchema.partial());
    await ctx.db.update(courses).set(body).where(eq(courses.id, id));
    const updated = await ctx.db.query.courses.findFirst({ where: eq(courses.id, id) });
    return c.json(toPublic(updated!));
  });

  r.delete('/:id', async (c) => {
    const id = c.req.param('id');
    await ctx.db.delete(courses).where(eq(courses.id, id));
    await ctx.db.delete(widgetInstances).where(eq(widgetInstances.id, `class:${id}`));
    await ctx.db.delete(courseContent).where(eq(courseContent.courseId, id));
    return c.json({ ok: true });
  });

  r.get('/:id/content', async (c) => {
    const rows = await ctx.db
      .select()
      .from(courseContent)
      .where(eq(courseContent.courseId, c.req.param('id')))
      .orderBy(asc(courseContent.kind), asc(courseContent.position));
    return c.json(rows);
  });

  return r;
}
