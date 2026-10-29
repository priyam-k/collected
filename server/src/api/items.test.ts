import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { EffectiveItem } from '@collected/shared';
import { courses } from '@collected/core/db/schema';
import { testContext } from '../test-util.js';
import { itemsRoutes } from './items.js';

const json = (body: unknown, method = 'POST') => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('manual course events', () => {
  it('creates, lists through the effective items API, updates, and deletes', async () => {
    const ctx = await testContext();
    await ctx.db.insert(courses).values({ id: '2026-fall-cmsc422-0101', term: '2026-fall', code: 'CMSC422', role: 'student', submitsVia: 'both', color: '#7c3aed' });
    const app = new Hono().route('/api/items', itemsRoutes(ctx));

    const created = await app.request('/api/items/manual', json({ courseId: '2026-fall-cmsc422-0101', kind: 'exam', title: 'Midterm 1', date: '2026-10-14', start: '10:00', end: '11:15', location: 'IRB 0324' }));
    expect(created.status).toBe(201);
    const row = (await created.json()) as { id: string; externalId: string; kind: string; allDay: boolean; startsAt: string; endsAt: string; raw: { eventKind: string } };
    expect(row.id.startsWith('manual:')).toBe(true);
    expect(row.kind).toBe('event');
    expect(row.allDay).toBe(false);
    expect(new Date(row.endsAt).getTime() - new Date(row.startsAt).getTime()).toBe(75 * 60_000);
    expect(row.raw.eventKind).toBe('exam');

    const allDay = (await (await app.request('/api/items/manual', json({ courseId: '2026-fall-cmsc422-0101', kind: 'cancelled', title: 'Lecture cancelled', date: '2026-10-15', meetingKind: 'lecture' }))).json()) as { allDay: boolean; startsAt: string; endsAt: string };
    expect(allDay.allDay).toBe(true);
    expect(new Date(allDay.endsAt).getTime() - new Date(allDay.startsAt).getTime()).toBe(24 * 3600_000);

    const list = (await (await app.request('/api/items?kind=event&source=manual&course=2026-fall-cmsc422-0101')).json()) as EffectiveItem[];
    expect(list.map((i) => i.title).sort()).toEqual(['Lecture cancelled', 'Midterm 1']);
    expect(list[0]!.course?.code).toBe('CMSC422');

    const updated = await app.request(`/api/items/manual/${row.externalId}`, json({ courseId: '2026-fall-cmsc422-0101', kind: 'exam', title: 'Midterm 1 (moved)', date: '2026-10-16', start: '10:00', end: '11:15' }, 'PUT'));
    expect(updated.status).toBe(200);
    expect(((await updated.json()) as { title: string }).title).toBe('Midterm 1 (moved)');

    expect((await app.request('/api/items/manual', json({ title: 'x', date: '2026-10-14', end: '11:00' }))).status).toBe(422);
    expect((await app.request('/api/items/manual', json({ title: 'x', date: '2026-10-14', start: '11:00', end: '10:00' }))).status).toBe(422);
    expect((await app.request(`/api/items/manual/${row.externalId}`, { method: 'DELETE' })).status).toBe(200);
    expect((await app.request(`/api/items/manual/${row.externalId}`, { method: 'DELETE' })).status).toBe(404);
    expect((await app.request('/api/items/manual/canvas-assignment-1', { method: 'DELETE' })).status).toBe(404);
  });
});
