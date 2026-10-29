import { count, eq, inArray, like, or, sql } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import { courseContent, courses, items, sources } from '../db/schema.js';
import { fixtureCanvasClient, loadFixture } from '../ingest/canvas/fixture-client.js';
import { syncCanvas } from '../ingest/canvas/ingest.js';
import type { CanvasCourse } from '../ingest/canvas/map.js';
import { activeEnrollments, importCanvasCourses, importFromEnrollment, toEnrollment } from '../ingest/canvas/onboarding.js';
import { syncGcal } from '../ingest/gcal/ingest.js';
import { MockCalendarApi, demoCalendars, demoScript } from '../ingest/gcal/mock-api.js';
import { fixtureGradescopeClient } from '../ingest/gradescope/fixture-client.js';
import { syncGradescope } from '../ingest/gradescope/ingest.js';
import type { GTask } from '../ingest/gtasks/api.js';
import { syncGtasks } from '../ingest/gtasks/ingest.js';
import { MockGTasksApi } from '../ingest/gtasks/mock-api.js';
import { syncTodoist } from '../ingest/todoist/ingest.js';
import { MockTodoistApi } from '../ingest/todoist/mock-api.js';
import { runDedup } from '../sync/dedup.js';
import { getSourceRow, mergeSourceMeta, setSourceStatus } from './sources.js';

export const DEMO_SOURCES = ['canvas', 'gradescope', 'gcal', 'todoist', 'gtasks'] as const;
export type DemoSource = (typeof DEMO_SOURCES)[number];
export const isDemoSource = (s: string | undefined): s is DemoSource => !!s && (DEMO_SOURCES as readonly string[]).includes(s);

export interface DemoLoaded {
  source: DemoSource;
  counts: Record<string, number>;
  /** Courses created from the fixture's enrollments because the database had none (Canvas only). */
  coursesCreated: string[];
  tagged: number;
  dedup: unknown;
}

const dayAt = (d: number, h = 18): Date => {
  const x = new Date();
  x.setDate(x.getDate() + d);
  x.setHours(h, 0, 0, 0);
  return x;
};
const ymd = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Loads one source's fixtures into this database through the real sync code, with the fixture client or mock API in
 * place of the network: the server's `cli demo`, the CLI's `collected demo` in local mode and the e2e suite all call
 * this. Rows are tagged so `clearDemoData` can take them out again. On a database with no courses, the Canvas loader
 * first imports the fixture's enrollments the way onboarding would, since nothing lands without a course to match.
 */
export async function loadDemo(ctx: AppContext, source: DemoSource): Promise<DemoLoaded> {
  const startedAt = new Date().toISOString();
  let counts: Record<string, number>;
  let coursesCreated: string[] = [];
  const now = () => new Date().toISOString();
  switch (source) {
    case 'canvas': {
      const client = fixtureCanvasClient();
      const [{ n }] = (await ctx.db.select({ n: count() }).from(courses)) as [{ n: number }];
      if (n === 0) {
        const list = await client.getAll<CanvasCourse>('/api/v1/courses', { enrollment_state: 'active', 'include[]': ['term'] });
        const picks = activeEnrollments(list)
          .map((k) => toEnrollment(k, null))
          .filter((e) => e.suggested.term !== 'default-term')
          .map(importFromEnrollment);
        coursesCreated = (await importCanvasCourses(ctx, picks)).created;
        ctx.log.info({ created: coursesCreated }, 'demo canvas: courses imported from the fixture enrollments');
      }
      counts = await syncCanvas(ctx, client);
      break;
    }
    case 'gradescope':
      counts = await syncGradescope(ctx, fixtureGradescopeClient());
      break;
    case 'gcal': {
      const api = new MockCalendarApi(demoCalendars, demoScript());
      const row = await getSourceRow(ctx, 'gcal');
      const r = await syncGcal(ctx, api, { ...(row.meta as object), selectedCalendars: demoCalendars.map((c) => c.id), syncTokens: {} });
      await mergeSourceMeta(ctx, 'gcal', { ...r.meta, defaultCalendarId: demoCalendars[0]!.id, demo: true });
      await setSourceStatus(ctx, 'gcal', 'connected', { lastSuccessAt: now(), lastError: null });
      counts = r.counts;
      break;
    }
    case 'todoist': {
      const api = new MockTodoistApi({
        projects: [{ id: 'p-school', name: 'School' }, { id: 'p-home', name: 'Home' }],
        labels: [{ id: 'l1', name: 'homework' }, { id: 'l2', name: 'grocery' }, { id: 'l3', name: 'cleaning' }, { id: 'l4', name: 'errands' }],
        tasks: [
          { id: 'd1', content: 'Buy oat milk', project_id: 'p-home', labels: ['grocery'], priority: 1, due: { date: ymd(dayAt(0)) } },
          { id: 'd2', content: 'Eggs, spinach, rice', project_id: 'p-home', labels: ['grocery'], priority: 1, due: null },
          { id: 'd3', content: 'Vacuum + take out trash', project_id: 'p-home', labels: ['cleaning'], priority: 2, due: { date: ymd(dayAt(1)), datetime: dayAt(1, 10).toISOString() } },
          { id: 'd4', content: 'Renew parking permit', project_id: 'p-home', labels: ['errands'], priority: 3, due: { date: ymd(dayAt(3)) } },
          { id: 'd5', content: 'Email advisor about spring schedule', project_id: 'p-school', labels: [], priority: 2, due: { date: ymd(dayAt(2)), datetime: dayAt(2, 9).toISOString() } },
          { id: 'd6', content: 'Read CIML ch. 1', project_id: 'p-school', labels: ['homework', 'cmsc422'], priority: 1, due: { date: ymd(dayAt(1)), datetime: dayAt(1, 23).toISOString() } },
          { id: 'd7', content: 'Call mom', project_id: 'inbox', labels: [], priority: 4, due: { date: ymd(dayAt(0)) } },
          { id: 'd8', content: 'Wipe counters', project_id: 'p-home', parent_id: 'd3', labels: [], priority: 1, due: null },
          { id: 'd9', content: 'Mop kitchen', project_id: 'p-home', parent_id: 'd3', labels: [], priority: 1, due: { date: ymd(dayAt(1)) } },
        ],
      });
      counts = await syncTodoist(ctx, api);
      await mergeSourceMeta(ctx, 'todoist', { projects: api.projects.map((p) => ({ id: p.id, name: p.name })), labels: api.labels.map((l) => l.name), demo: true });
      await setSourceStatus(ctx, 'todoist', 'connected', { lastSuccessAt: now(), lastError: null });
      break;
    }
    case 'gtasks': {
      const day = (d: number) => `${ymd(dayAt(d))}T00:00:00.000Z`;
      const t = (id: string, title: string, due: string | null, extra: Partial<GTask> = {}): GTask => ({ id, title, notes: null, due, status: 'needsAction', selfLink: `https://www.googleapis.com/tasks/v1/lists/x/tasks/${id}`, ...extra }) as GTask;
      const api = new MockGTasksApi({
        lists: [{ id: 'g-school', title: 'School' }, { id: 'g-life', title: 'Life' }],
        tasks: {
          'g-school': [t('g1', 'Outline STAT410 project', day(2)), t('g2', 'Office hours: ask about problem 4', day(1)), t('g3', 'Reread lecture 12 notes', null)],
          'g-life': [t('g4', 'Book dentist', day(5)), t('g5', 'Return library books', day(0)), t('g6', 'Pay electric bill', day(3), { status: 'completed', completed: new Date().toISOString() })],
        },
      });
      const r = await syncGtasks(ctx, api);
      await mergeSourceMeta(ctx, 'gtasks', { lists: r.lists.map((l) => ({ id: l.id, title: l.title })), demo: true });
      await setSourceStatus(ctx, 'gtasks', 'connected', { lastSuccessAt: now(), lastError: null });
      counts = r.counts;
      break;
    }
  }
  const tagged = await tagDemoRows(ctx, source, startedAt);
  const dedup = await runDedup(ctx);
  return { source, counts, coursesCreated, tagged, dedup };
}

/** Marks rows written by a demo loader so they can be removed later. */
export async function tagDemoRows(ctx: AppContext, source: string, sinceIso: string): Promise<number> {
  const r = await ctx.db
    .update(items)
    .set({ raw: sql`json_set(${items.raw}, '$.demo', json('true'))` })
    .where(sql`${items.source} = ${source} AND ${items.updatedAt} >= ${sinceIso}`)
    .returning({ id: items.id });
  await ctx.db.update(courseContent).set({ raw: sql`json_set(${courseContent.raw}, '$.demo', json('true'))` }).where(sql`${courseContent.updatedAt} >= ${sinceIso}`);
  return r.length;
}

/** Ids the fixture files can produce, so rows loaded before tagging existed can still be cleared. */
function fixtureItemIds(): string[] {
  const ids: string[] = [];
  try {
    for (const a of loadFixture<{ id: number }[]>('assignments.json')) ids.push(`canvas:assignment:${a.id}`);
    for (const p of loadFixture<{ plannable_type: string; plannable_id: number; plannable: { assignment_id?: number | null } }[]>('planner-items.json')) {
      if (p.plannable_type === 'announcement') ids.push(`canvas:announcement:${p.plannable_id}`);
      if (p.plannable_type === 'calendar_event') ids.push(`canvas:event:${p.plannable_id}`);
      if (p.plannable_type === 'assignment') ids.push(`canvas:assignment:${p.plannable_id}`);
      if (p.plannable_type === 'quiz' && p.plannable.assignment_id) ids.push(`canvas:assignment:${p.plannable.assignment_id}`);
    }
    for (const a of loadFixture<{ id: number }[]>('announcements.json')) ids.push(`canvas:announcement:${a.id}`);
  } catch {
    // fixtures not shipped (prod image) — fine
  }
  for (const gs of ['8499802', '8499810', '8499820', '8499830', '8599802', '8599810', '8599820', '8599830', '8502830', '8502840']) ids.push(`gradescope:assignment:${gs}`);
  for (let i = 1; i <= 7; i++) ids.push(`todoist:d${i}`);
  return ids;
}

/**
 * Removes everything the demo loaders created: tagged rows, fixture-id rows, demo calendars, demo meta.
 * Real syncs recreate anything that is genuinely there.
 */
export async function clearDemoData(ctx: AppContext): Promise<{ items: number; content: number }> {
  const calPrefixes = demoCalendars.map((c) => like(items.externalId, `${c.id}:%`));
  const gone = await ctx.db
    .delete(items)
    .where(or(sql`json_extract(${items.raw}, '$.demo') = 1`, inArray(items.id, fixtureItemIds()), ...calPrefixes)!)
    .returning({ id: items.id });
  const content = await ctx.db.delete(courseContent).where(sql`json_extract(${courseContent.raw}, '$.demo') = 1`).returning({ id: courseContent.id });
  // Strip demo calendars from the Google meta but keep everything a real connect wrote.
  const demoIds = new Set(demoCalendars.map((c) => c.id));
  const gcal = await ctx.db.query.sources.findFirst({ where: eq(sources.id, 'gcal') });
  if (gcal) {
    const meta = gcal.meta as { demo?: boolean; calendars?: { id: string }[]; selectedCalendars?: string[]; syncTokens?: Record<string, string>; defaultCalendarId?: string | null };
    const calendars = (meta.calendars ?? []).filter((c) => !demoIds.has(c.id));
    const selectedCalendars = (meta.selectedCalendars ?? []).filter((id) => !demoIds.has(id));
    const syncTokens = Object.fromEntries(Object.entries(meta.syncTokens ?? {}).filter(([k]) => !demoIds.has(k)));
    const defaultCalendarId = meta.defaultCalendarId && demoIds.has(meta.defaultCalendarId) ? (calendars.find((c) => (c as { primary?: boolean }).primary)?.id ?? null) : (meta.defaultCalendarId ?? null);
    const { demo: _d, ...rest } = meta;
    await ctx.db
      .update(sources)
      .set({ meta: { ...rest, calendars, selectedCalendars, syncTokens, defaultCalendarId }, status: gcal.configEnc ? gcal.status : 'disconnected' })
      .where(eq(sources.id, 'gcal'));
  }
  const todoist = await ctx.db.query.sources.findFirst({ where: eq(sources.id, 'todoist') });
  if (todoist && (todoist.meta as { demo?: boolean }).demo) {
    const { demo: _d, ...rest } = todoist.meta as Record<string, unknown>;
    await ctx.db.update(sources).set({ meta: rest, status: todoist.configEnc ? todoist.status : 'disconnected' }).where(eq(sources.id, 'todoist'));
  }
  ctx.log.info({ items: gone.length, content: content.length }, 'demo data cleared');
  return { items: gone.length, content: content.length };
}
