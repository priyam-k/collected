import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { count, eq } from 'drizzle-orm';
import { INGESTED_SOURCE_IDS, jobsFilterSchema, seedConfigSchema, todoistPushConfigSchema } from '@collected/shared';
import type { AppContext } from './context.js';
import { courses, settings, sources, widgetInstances } from './db/schema.js';

export const CORE_WIDGETS = ['calendar', 'todo', 'sources', 'jobs', 'classes'] as const;

export function courseSlug(term: string, code: string, section?: string | null): string {
  return [term, code, section].filter(Boolean).join('-').toLowerCase().replace(/[^a-z0-9-]+/g, '-');
}

export const COURSE_COLORS = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d'];

/** Idempotent. Sources rows every boot; everything else only when the courses table is empty. */
export async function seed(ctx: AppContext): Promise<void> {
  const { db, log, env } = ctx;

  for (const id of INGESTED_SOURCE_IDS) {
    await db.insert(sources).values({ id }).onConflictDoNothing();
  }

  const [{ n }] = (await db.select({ n: count() }).from(courses)) as [{ n: number }];
  if (n > 0) {
    await ensureSettingDefaults(ctx);
    return;
  }

  const seedPath = env.SEED_CONFIG_PATH
    ? path.resolve(env.rootDir, 'server', env.SEED_CONFIG_PATH)
    : path.resolve(env.rootDir, 'artifacts', 'seed-config.json');
  const candidates = [seedPath, path.resolve(env.rootDir, 'artifacts', 'seed-config.json'), env.SEED_CONFIG_PATH ?? ''].filter(
    (p) => p && existsSync(p),
  );
  const file = candidates[0];
  if (!file) {
    log.warn({ tried: seedPath }, 'no seed-config.json found; starting empty');
    await ensureCoreWidgets(ctx, []);
    return;
  }

  const parsed = seedConfigSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
  if (!parsed.success) {
    log.error({ issues: parsed.error.issues }, 'seed-config.json is invalid; starting empty');
    await ensureCoreWidgets(ctx, []);
    return;
  }
  const cfg = parsed.data;

  const courseIds: string[] = [];
  let i = 0;
  for (const c of cfg.courses) {
    const id = courseSlug(cfg.term, c.code, c.section);
    courseIds.push(id);
    await db
      .insert(courses)
      .values({
        id,
        term: cfg.term,
        code: c.code.toUpperCase(),
        section: c.section ?? null,
        name: c.name ?? null,
        role: c.role,
        canvasCourseId: c.canvas_course_id == null ? null : String(c.canvas_course_id),
        gradescopeCourseId: c.gradescope_course_id == null ? null : String(c.gradescope_course_id),
        submitsVia: c.submits_via,
        color: COURSE_COLORS[i % COURSE_COLORS.length] ?? null,
        links: c.links,
        schedule: c.schedule,
      })
      .onConflictDoNothing();
    i++;
  }

  const jobsFilter = jobsFilterSchema.parse(cfg.jobs?.filter ?? {});
  const todoistPush = todoistPushConfigSchema.parse({
    enabled: cfg.todoist?.push_sync_enabled ?? false,
    projectName: cfg.todoist?.project_name ?? 'School',
    commonLabel: cfg.todoist?.common_label ?? 'homework',
  });
  const defaults: Record<string, unknown> = {
    'jobs.filter': jobsFilter,
    'todoist.push': todoistPush,
    'todo.sections': [todoistPush.commonLabel],
    timezone: env.TZ ?? 'America/New_York',
  };
  for (const [key, value] of Object.entries(defaults)) {
    await db.insert(settings).values({ key, value }).onConflictDoNothing();
  }
  if (cfg.jobs?.sources?.length) {
    await db
      .update(sources)
      .set({ meta: { sources: cfg.jobs.sources } })
      .where(eq(sources.id, 'jobs'));
  }

  await ensureCoreWidgets(ctx, courseIds);
  log.info({ courses: courseIds.length, file }, 'seeded from seed-config.json');
}

/** Fills in settings keys that were added after this database was first seeded. Never overwrites existing values. */
async function ensureSettingDefaults(ctx: AppContext): Promise<void> {
  const defaults: Record<string, unknown> = {
    'jobs.filter': jobsFilterSchema.parse({}),
    'todoist.push': todoistPushConfigSchema.parse({}),
    'todo.sections': ['homework'],
    timezone: ctx.env.TZ ?? 'America/New_York',
  };
  for (const [key, value] of Object.entries(defaults)) {
    await ctx.db.insert(settings).values({ key, value }).onConflictDoNothing();
  }
}

async function ensureCoreWidgets(ctx: AppContext, courseIds: string[]): Promise<void> {
  for (const type of CORE_WIDGETS) {
    await ctx.db.insert(widgetInstances).values({ id: type, type, config: {} }).onConflictDoNothing();
  }
  for (const courseId of courseIds) {
    await ctx.db
      .insert(widgetInstances)
      .values({ id: `class:${courseId}`, type: 'class', config: { courseId }, hidden: true })
      .onConflictDoNothing();
  }
}
