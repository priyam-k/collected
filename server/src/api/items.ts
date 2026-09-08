import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { and, eq, or } from 'drizzle-orm';
import { z } from 'zod';
import { ITEM_KINDS, SOURCE_IDS, manualEventInputSchema, overrideInputSchema, type ItemKind, type ManualEventInput, type ManualEventRaw, type SourceId } from '@collected/shared';
import type { AppContext } from '../context.js';
import { itemLinks, items, overrides, type NewItemRow } from '../db/schema.js';
import { queryEffectiveItems } from '../lib/effective.js';
import { bad, csv, parseBody } from './util.js';

/** A local wall-clock date/time (server TZ) as ISO. Dates in the tracker and course events are days, not instants. */
const localIso = (date: string, time: string | null | undefined): string => new Date(`${date}T${time ?? '00:00'}:00`).toISOString();
const nextDay = (date: string): string => {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString();
};

/** Builds the items row for a manual course event. Timed events carry start/end; all-day ones span the day. */
export function manualEventRow(id: string, b: ManualEventInput): NewItemRow {
  const allDay = !b.start;
  const raw: ManualEventRaw = {
    eventKind: b.kind,
    date: b.date,
    start: b.start ?? null,
    end: b.end ?? null,
    location: b.location || null,
    note: b.note || null,
    meetingKind: b.meetingKind ?? null,
  };
  return {
    id: `manual:${id}`,
    source: 'manual',
    externalId: id,
    kind: 'event',
    courseId: b.courseId,
    title: b.title,
    description: b.note || null,
    url: null,
    startsAt: allDay ? localIso(b.date, null) : localIso(b.date, b.start),
    endsAt: allDay ? nextDay(b.date) : b.end ? localIso(b.date, b.end) : null,
    dueAt: null,
    allDay,
    status: 'open',
    points: null,
    score: null,
    labels: [],
    raw: raw as unknown as Record<string, unknown>,
  };
}

export function itemsRoutes(ctx: AppContext) {
  const r = new Hono();

  /* ---------- manual course events ---------- */
  r.post('/manual', async (c) => {
    const body = await parseBody(c, manualEventInputSchema);
    const row = manualEventRow(randomUUID(), body);
    await ctx.db.insert(items).values(row);
    ctx.log.info({ item: row.id, kind: body.kind, course: body.courseId }, 'manual event added');
    return c.json(await ctx.db.query.items.findFirst({ where: eq(items.id, row.id) }), 201);
  });

  r.put('/manual/:id', async (c) => {
    const id = `manual:${c.req.param('id')}`;
    const existing = await ctx.db.query.items.findFirst({ where: eq(items.id, id) });
    if (!existing || existing.source !== 'manual') bad('manual event not found', 404);
    const body = await parseBody(c, manualEventInputSchema);
    const { id: _id, source: _s, externalId: _e, ...set } = manualEventRow(existing.externalId, body);
    await ctx.db.update(items).set({ ...set, updatedAt: new Date().toISOString(), deletedAt: null }).where(eq(items.id, id));
    return c.json(await ctx.db.query.items.findFirst({ where: eq(items.id, id) }));
  });

  r.delete('/manual/:id', async (c) => {
    const id = `manual:${c.req.param('id')}`;
    const existing = await ctx.db.query.items.findFirst({ where: eq(items.id, id) });
    if (!existing || existing.source !== 'manual') bad('manual event not found', 404);
    await ctx.db.delete(overrides).where(eq(overrides.itemId, id));
    await ctx.db.delete(items).where(eq(items.id, id));
    return c.json({ ok: true });
  });

  r.get('/', async (c) => {
    const q = c.req.query();
    const kind = csv(q.kind)?.filter((k): k is ItemKind => (ITEM_KINDS as readonly string[]).includes(k));
    const source = csv(q.source)?.filter((s): s is SourceId => (SOURCE_IDS as readonly string[]).includes(s));
    const rows = await queryEffectiveItems(ctx, {
      from: q.from,
      to: q.to,
      kind,
      source,
      courseId: q.course,
      includeDone: q.includeDone === '1' || q.includeDone === 'true',
      includeHidden: q.includeHidden === '1' || q.includeHidden === 'true',
      includeInformational: q.includeInformational === '1' || q.includeInformational === 'true',
      noCollapse: q.noCollapse === '1',
      limit: q.limit ? Number(q.limit) : undefined,
    });
    return c.json(rows);
  });

  r.post('/:id/override', async (c) => {
    const id = c.req.param('id');
    const item = await ctx.db.query.items.findFirst({ where: eq(items.id, id) });
    if (!item) bad('item not found', 404);
    const body = await parseBody(c, overrideInputSchema);
    await ctx.db
      .insert(overrides)
      .values({ itemId: id, ...body })
      .onConflictDoUpdate({ target: overrides.itemId, set: { ...body, updatedAt: new Date().toISOString() } });
    ctx.log.info({ item: id, ...body }, 'override set');
    return c.json(await ctx.db.query.overrides.findFirst({ where: eq(overrides.itemId, id) }));
  });

  const linkBody = z.object({ a: z.string(), b: z.string() });

  r.post('/link', async (c) => {
    const { a, b } = await parseBody(c, linkBody);
    if (a === b) bad('cannot link an item to itself');
    const [x, y] = [a, b].sort();
    await ctx.db
      .insert(itemLinks)
      .values({ aItemId: x!, bItemId: y!, method: 'manual', confidence: 1 })
      .onConflictDoUpdate({ target: [itemLinks.aItemId, itemLinks.bItemId], set: { method: 'manual', confidence: 1 } });
    return c.json({ ok: true });
  });

  r.post('/unlink', async (c) => {
    const { a, b } = await parseBody(c, linkBody);
    await ctx.db
      .delete(itemLinks)
      .where(or(and(eq(itemLinks.aItemId, a), eq(itemLinks.bItemId, b)), and(eq(itemLinks.aItemId, b), eq(itemLinks.bItemId, a)))!);
    return c.json({ ok: true });
  });

  return r;
}
