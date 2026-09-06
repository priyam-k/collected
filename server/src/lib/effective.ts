import { and, gte, inArray, isNull, lte, or, eq, type SQL } from 'drizzle-orm';
import { DONE_STATUSES, type EffectiveItem, type ItemKind, type SourceId } from '@collected/shared';
import type { AppContext } from '../context.js';
import { courses, itemLinks, items, overrides, sources, todoistMap, type ItemRow, type OverrideRow } from '../db/schema.js';
import { hoursBetween } from './time.js';

export interface ItemQuery {
  from?: string; // ISO; items whose due/start/end fall within [from, to]
  to?: string;
  kind?: ItemKind[];
  courseId?: string;
  source?: SourceId[];
  includeDone?: boolean;
  includeHidden?: boolean;
  includeDeleted?: boolean;
  limit?: number;
}

const isDoneStatus = (s: string) => (DONE_STATUSES as readonly string[]).includes(s);

/**
 * Resolves each item's done/visibility using: own status, linked items, overrides, mirrored Todoist tasks.
 * Also hides canvas_ical rows while the cookie-based Canvas source is healthy, and TA-informational rows
 * are never "todo" (they keep effectiveDone=false but carry raw.ta for widgets to filter).
 */
export async function queryEffectiveItems(ctx: AppContext, q: ItemQuery): Promise<EffectiveItem[]> {
  const conds: SQL[] = [];
  if (!q.includeDeleted) conds.push(isNull(items.deletedAt));
  if (q.kind?.length) conds.push(inArray(items.kind, q.kind));
  if (q.source?.length) conds.push(inArray(items.source, q.source));
  if (q.courseId) conds.push(eq(items.courseId, q.courseId));
  if (q.from) conds.push(or(gte(items.dueAt, q.from), gte(items.endsAt, q.from), gte(items.startsAt, q.from))!);
  if (q.to) conds.push(or(lte(items.dueAt, q.to), lte(items.startsAt, q.to))!);

  const rows = await ctx.db
    .select()
    .from(items)
    .where(conds.length ? and(...conds) : undefined)
    .limit(q.limit ?? 2000);
  if (!rows.length) return [];

  const ids = rows.map((r) => r.id);
  const [ovs, links, maps, courseRows, sourceRows] = await Promise.all([
    ctx.db.select().from(overrides).where(inArray(overrides.itemId, ids)),
    ctx.db.select().from(itemLinks).where(or(inArray(itemLinks.aItemId, ids), inArray(itemLinks.bItemId, ids))!),
    ctx.db.select().from(todoistMap).where(inArray(todoistMap.itemId, ids)),
    ctx.db.select({ id: courses.id, code: courses.code, color: courses.color, role: courses.role }).from(courses),
    ctx.db.select({ id: sources.id, status: sources.status, lastSuccessAt: sources.lastSuccessAt }).from(sources),
  ]);

  // Linked partners may lie outside the query window; fetch them for done-state only.
  const partnerIds = new Set<string>();
  for (const l of links) {
    if (!ids.includes(l.aItemId)) partnerIds.add(l.aItemId);
    if (!ids.includes(l.bItemId)) partnerIds.add(l.bItemId);
  }
  const partners = partnerIds.size ? await ctx.db.select().from(items).where(inArray(items.id, [...partnerIds])) : [];
  const partnerOv = partnerIds.size ? await ctx.db.select().from(overrides).where(inArray(overrides.itemId, [...partnerIds])) : [];

  const ovById = new Map<string, OverrideRow>([...ovs, ...partnerOv].map((o) => [o.itemId, o]));
  const rowById = new Map<string, ItemRow>([...rows, ...partners].map((r) => [r.id, r]));
  const linkedOf = new Map<string, string[]>();
  for (const l of links) {
    linkedOf.set(l.aItemId, [...(linkedOf.get(l.aItemId) ?? []), l.bItemId]);
    linkedOf.set(l.bItemId, [...(linkedOf.get(l.bItemId) ?? []), l.aItemId]);
  }
  const mirrorClosed = new Set<string>();
  // A closed mirrored Todoist task (raw.mirror) marks its item done. The todoist ingester stores mirrors as items
  // with source=todoist and raw.mirror=true and raw.mirrorOf=<itemId>.
  const mirrorRows = await ctx.db.select().from(items).where(and(eq(items.source, 'todoist'), eq(items.status, 'done')));
  for (const m of mirrorRows) {
    const of = (m.raw as { mirrorOf?: string }).mirrorOf;
    if (of) mirrorClosed.add(of);
  }
  for (const m of maps) {
    // If the mapped Todoist task exists in items and is done, count it.
    const t = rowById.get(`todoist:${m.todoistTaskId}`);
    if (t?.status === 'done') mirrorClosed.add(m.itemId);
  }

  const courseById = new Map(courseRows.map((c) => [c.id, c]));
  const canvas = sourceRows.find((s) => s.id === 'canvas');
  const canvasHealthy = !!canvas && canvas.status === 'connected' && !!canvas.lastSuccessAt && hoursBetween(canvas.lastSuccessAt, new Date()) < 2;

  const selfDone = (r: ItemRow): boolean => isDoneStatus(r.status) || !!ovById.get(r.id)?.done || mirrorClosed.has(r.id);

  const out: EffectiveItem[] = [];
  for (const r of rows) {
    if (r.source === 'canvas_ical' && canvasHealthy) continue;
    if (r.source === 'todoist' && (r.raw as { mirror?: boolean }).mirror) continue;
    const ov = ovById.get(r.id) ?? null;
    const linkedIds = linkedOf.get(r.id) ?? [];
    const linkedDone = linkedIds.some((id) => {
      const p = rowById.get(id);
      return p ? selfDone(p) : false;
    });
    const effectiveDone = selfDone(r) || linkedDone;
    const snoozed = !!ov?.snoozedUntil && new Date(ov.snoozedUntil) > new Date();
    const effectiveHidden = !!ov?.hidden || snoozed;
    if (effectiveDone && !q.includeDone) continue;
    if (effectiveHidden && !q.includeHidden) continue;
    const c = r.courseId ? courseById.get(r.courseId) : undefined;
    out.push({
      ...(r as unknown as EffectiveItem),
      effectiveDone,
      effectiveHidden,
      linkedIds,
      override: ov,
      course: c ? { id: c.id, code: c.code, color: c.color, role: c.role as 'student' | 'ta' } : null,
    });
  }
  out.sort((a, b) => (a.dueAt ?? a.startsAt ?? '9').localeCompare(b.dueAt ?? b.startsAt ?? '9'));
  return out;
}
