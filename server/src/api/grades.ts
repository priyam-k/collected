import { Hono } from 'hono';
import { asc, eq } from 'drizzle-orm';
import type { CourseGrades } from '@collected/shared';
import type { AppContext } from '../context.js';
import { courses } from '@collected/core/db/schema';
import { computeGrades, loadGradeInputs } from '@collected/core/lib/grades';
import { bad } from './util.js';

export function gradesRoutes(ctx: AppContext) {
  const r = new Hono();

  /** Current grade per active course, for the classes overview. */
  r.get('/', async (c) => {
    const rows = await ctx.db.select({ id: courses.id, role: courses.role }).from(courses).where(eq(courses.archived, false)).orderBy(asc(courses.code));
    const out: Record<string, Pick<CourseGrades, 'current' | 'weighted' | 'graded' | 'total'> & { canvasCurrent: number | null }> = {};
    for (const row of rows) {
      if (row.role === 'ta') continue;
      const inp = await loadGradeInputs(ctx, row.id);
      if (!inp) continue;
      const g = computeGrades(inp);
      out[row.id] = { current: g.current, weighted: g.weighted, graded: g.graded, total: g.total, canvasCurrent: g.canvas?.currentScore ?? null };
    }
    return c.json(out);
  });

  r.get('/:courseId', async (c) => {
    const inp = await loadGradeInputs(ctx, c.req.param('courseId'));
    if (!inp) bad('course not found', 404);
    return c.json(computeGrades(inp));
  });

  return r;
}
