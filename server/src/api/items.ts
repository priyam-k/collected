import { Hono } from 'hono';
import { and, eq, or } from 'drizzle-orm';
import { z } from 'zod';
import { ITEM_KINDS, SOURCE_IDS, overrideInputSchema, type ItemKind, type SourceId } from '@collected/shared';
import type { AppContext } from '../context.js';
import { itemLinks, items, overrides } from '../db/schema.js';
import { queryEffectiveItems } from '../lib/effective.js';
import { bad, csv, parseBody } from './util.js';

export function itemsRoutes(ctx: AppContext) {
  const r = new Hono();

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
