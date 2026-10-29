import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { items } from '@collected/core/db/schema';
import { MockCalendarApi, demoCalendars } from '@collected/core/ingest/gcal/mock-api';
import { mergeSourceMeta } from '@collected/core/lib/sources';
import { testContext } from '../test-util.js';
import { calendarRoutes } from './calendar.js';

describe('POST /api/calendar/events', () => {
  it('creates the event in Google and upserts it locally', async () => {
    const ctx = await testContext();
    await mergeSourceMeta(ctx, 'gcal', { calendars: demoCalendars, defaultCalendarId: demoCalendars[0]!.id });
    const mock = new MockCalendarApi(demoCalendars, { pages: {} });
    const app = new Hono().route('/api/calendar', calendarRoutes(ctx, async () => mock));

    const res = await app.request('/api/calendar/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Study group', start: '2026-09-10T18:00:00.000Z', end: '2026-09-10T19:30:00.000Z', location: 'McKeldin' }),
    });
    expect(res.status).toBe(201);
    expect(mock.inserted).toEqual([{ calendarId: demoCalendars[0]!.id, body: { summary: 'Study group', description: undefined, location: 'McKeldin', start: { dateTime: '2026-09-10T18:00:00.000Z' }, end: { dateTime: '2026-09-10T19:30:00.000Z' } } }]);
    const row = await ctx.db.query.items.findFirst({ where: eq(items.id, `gcal:${demoCalendars[0]!.id}:new-1`) });
    expect(row?.title).toBe('Study group');
    expect(row?.kind).toBe('event');

    const allDay = await app.request('/api/calendar/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Rent', allDay: true, start: '2026-10-01', calendarId: demoCalendars[1]!.id }),
    });
    expect(allDay.status).toBe(201);
    expect(mock.inserted[1]!.body.start).toEqual({ date: '2026-10-01' });
    expect(mock.inserted[1]!.body.end).toEqual({ date: '2026-10-02' });

    const bad = await app.request('/api/calendar/events', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'x', start: 'not-a-date' }) });
    expect(bad.status).toBe(422);
  });
});
