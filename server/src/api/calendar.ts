import { Hono } from 'hono';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { gcalApiForCtx, type GcalMeta } from '@collected/core/ingest/gcal/ingest';
import { eventToRow } from '@collected/core/ingest/gcal/map';
import type { CalendarApi } from '@collected/core/ingest/gcal/api';
import { upsertItems } from '@collected/core/lib/items';
import { getSourceRow } from '@collected/core/lib/sources';
import { bad, parseBody } from './util.js';

export const newEventSchema = z
  .object({
    calendarId: z.string().optional(),
    title: z.string().min(1).max(300),
    description: z.string().max(4000).optional(),
    location: z.string().max(300).optional(),
    allDay: z.boolean().default(false),
    start: z.string().min(1), // ISO datetime, or YYYY-MM-DD when allDay
    end: z.string().min(1).optional(),
  })
  .refine((v) => (v.allDay ? /^\d{4}-\d{2}-\d{2}$/.test(v.start) : !Number.isNaN(Date.parse(v.start))), { message: 'start must be YYYY-MM-DD for all-day events or an ISO datetime otherwise' });

export function calendarRoutes(ctx: AppContext, apiFactory: (ctx: AppContext) => Promise<CalendarApi> = gcalApiForCtx) {
  const r = new Hono();

  /** Write-through: create in Google, then upsert locally so the widget updates without waiting for the next sync. */
  r.post('/events', async (c) => {
    const body = await parseBody(c, newEventSchema);
    const row = await getSourceRow(ctx, 'gcal');
    const meta = row.meta as GcalMeta;
    const calendarId = body.calendarId ?? meta.defaultCalendarId ?? meta.calendars?.find((k) => k.primary)?.id;
    if (!calendarId) bad('no calendar selected; connect Google Calendar first', 409);
    const api = await apiFactory(ctx);
    let start: { date?: string; dateTime?: string };
    let end: { date?: string; dateTime?: string };
    if (body.allDay) {
      const next = new Date(`${body.start}T00:00:00`);
      next.setDate(next.getDate() + 1);
      start = { date: body.start };
      end = { date: body.end && /^\d{4}-\d{2}-\d{2}$/.test(body.end) ? body.end : next.toISOString().slice(0, 10) };
    } else {
      const s = new Date(body.start);
      const e = body.end ? new Date(body.end) : new Date(s.getTime() + 60 * 60_000);
      if (e <= s) bad('end must be after start');
      start = { dateTime: s.toISOString() };
      end = { dateTime: e.toISOString() };
    }
    const ev = await api.insertEvent(calendarId, { summary: body.title, description: body.description, location: body.location, start, end });
    const cal = meta.calendars?.find((k) => k.id === calendarId);
    const itemRow = eventToRow(ev, calendarId, cal?.summary ?? null, cal?.backgroundColor ?? null);
    await upsertItems(ctx, 'gcal', [itemRow]);
    ctx.log.info({ calendarId, id: ev.id }, 'calendar event created');
    return c.json(itemRow, 201);
  });

  return r;
}
