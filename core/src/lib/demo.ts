import { eq, inArray, like, or, sql } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import { courseContent, items, sources } from '../db/schema.js';
import { loadFixture } from '../ingest/canvas/fixture-client.js';
import { demoCalendars } from '../ingest/gcal/mock-api.js';

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
