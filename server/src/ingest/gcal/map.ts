import type { NewItemRow } from '../../db/schema.js';
import { isoOrNull } from '../../lib/time.js';
import type { GEvent } from './api.js';

/** `YYYY-MM-DD` → ISO of local midnight (the server runs in the user's TZ). */
export function localDateToIso(date: string): string {
  return new Date(`${date}T00:00:00`).toISOString();
}

export function eventExternalId(calendarId: string, eventId: string): string {
  return `${calendarId}:${eventId}`;
}

export function eventToRow(ev: GEvent, calendarId: string, calendarName: string | null, color: string | null): NewItemRow {
  const allDay = !!ev.start?.date && !ev.start?.dateTime;
  const startsAt = allDay ? localDateToIso(ev.start!.date!) : isoOrNull(ev.start?.dateTime ?? null);
  const endsAt = allDay ? (ev.end?.date ? localDateToIso(ev.end.date) : null) : isoOrNull(ev.end?.dateTime ?? null);
  const ext = eventExternalId(calendarId, ev.id);
  return {
    id: `gcal:${ext}`,
    source: 'gcal',
    externalId: ext,
    kind: 'event',
    courseId: null,
    title: ev.summary?.trim() || '(no title)',
    description: ev.description?.slice(0, 2000) ?? null,
    url: ev.htmlLink ?? null,
    startsAt,
    endsAt,
    dueAt: null,
    allDay,
    status: ev.status === 'cancelled' ? 'cancelled' : ev.status === 'tentative' ? 'open' : 'open',
    points: null,
    score: null,
    labels: [],
    raw: {
      calendarId,
      calendarName,
      color,
      location: ev.location ?? null,
      recurringEventId: ev.recurringEventId ?? null,
      tentative: ev.status === 'tentative',
      updated: ev.updated ?? null,
    },
  };
}
