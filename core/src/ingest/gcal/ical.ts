import ical, { type EventInstance, type VEvent } from 'node-ical';
import { gte, lte } from 'drizzle-orm';
import { sourceConfigSchemas } from '@collected/shared';
import type { AppContext } from '../../context.js';
import { items, type NewItemRow } from '../../db/schema.js';
import { assertAllowedOutboundUrl, MB, readText, withTimeout } from '../../lib/http.js';
import { upsertItems } from '../../lib/items.js';
import { getSourceConfig } from '../../lib/sources.js';
import { addDays, isoOrNull } from '../../lib/time.js';
import { NotConfiguredError, type Ingester } from '../types.js';

/**
 * Google Calendar without OAuth: the calendar's "Secret address in iCal format" (Google Calendar → Settings →
 * the calendar → Integrate calendar). Read-only, one calendar per URL, no client id needed. Google regenerates
 * the feed a few times an hour, so 30 minutes is as fresh as it gets.
 */
export const GCAL_ICAL_PAST_DAYS = 14;
export const GCAL_ICAL_FUTURE_DAYS = 60;
/** Per recurring event. A daily rule over the 74-day window is ~74 rows; 500 only trips on pathological rules. */
export const GCAL_ICAL_MAX_OCCURRENCES = 500;

type ParamValue = string | { val?: string } | undefined;
const str = (v: ParamValue): string => (typeof v === 'string' ? v : (v?.val ?? ''));
const httpOnly = (u: string | undefined): string | null => (u && /^https?:\/\//i.test(u) ? u : null);

/** Google uses `<id>@google.com`; anything else is passed through with only unsafe characters replaced. */
function safeUid(uid: string): string {
  return uid.replace(/[^a-zA-Z0-9@._-]/g, '_').slice(0, 200);
}

export function icalWindow(now: Date): { from: Date; to: Date } {
  return { from: addDays(now, -GCAL_ICAL_PAST_DAYS), to: addDays(now, GCAL_ICAL_FUTURE_DAYS) };
}

interface Instance {
  start: Date;
  end: Date | null;
  summary: string;
  allDay: boolean;
  recurring: boolean;
  override: boolean;
  status: string | undefined;
  location: string;
  description: string;
}

/**
 * Parses one Google ICS feed into event rows within [now-14d, now+60d]. Recurring events are expanded with
 * node-ical (EXDATE honoured, RECURRENCE-ID overrides applied), capped at GCAL_ICAL_MAX_OCCURRENCES each.
 * Every row carries `raw.calendarName` (from X-WR-CALNAME) so the popover can show which calendar it came from.
 */
export function parseGoogleIcs(text: string, now = new Date()): { rows: NewItemRow[]; calendarName: string | null; recurringEvents: number } {
  const data = ical.sync.parseICS(text);
  const { from, to } = icalWindow(now);
  const rows: NewItemRow[] = [];
  let calendarName: string | null = null;
  let recurringEvents = 0;

  for (const v of Object.values(data)) {
    if (!v) continue;
    if (v.type === 'VCALENDAR') {
      const name = (v as unknown as { 'WR-CALNAME'?: string })['WR-CALNAME'];
      if (typeof name === 'string' && name.trim()) calendarName = name.trim().slice(0, 200);
      continue;
    }
    if (v.type !== 'VEVENT') continue;
    const ev = v as VEvent;
    if (!ev.uid || !ev.start) continue;
    const base = {
      status: ev.status,
      location: str(ev.location as ParamValue),
      description: str(ev.description as ParamValue),
    };
    const instances: Instance[] = [];
    if (ev.rrule) {
      recurringEvents++;
      let expanded: EventInstance[];
      try {
        expanded = ical.expandRecurringEvent(ev, { from, to });
      } catch {
        expanded = [];
      }
      for (const inst of expanded.slice(0, GCAL_ICAL_MAX_OCCURRENCES)) {
        // An override instance carries its own VEVENT (status, location…); a plain one inherits the base.
        const own = (inst as unknown as { event?: Partial<VEvent> }).event;
        const src = inst.isOverride && own ? own : ev;
        instances.push({
          start: inst.start,
          end: inst.end ?? null,
          summary: str(inst.summary as ParamValue),
          allDay: inst.isFullDay,
          recurring: true,
          override: inst.isOverride,
          status: src.status ?? base.status,
          location: src === ev ? base.location : str(src.location as ParamValue) || base.location,
          description: src === ev ? base.description : str(src.description as ParamValue) || base.description,
        });
      }
    } else {
      if (ev.start < from || ev.start > to) continue;
      instances.push({
        start: ev.start,
        end: ev.end ?? null,
        summary: str(ev.summary as ParamValue),
        allDay: ev.datetype === 'date',
        recurring: false,
        override: false,
        ...base,
      });
    }

    const uid = safeUid(ev.uid);
    for (const inst of instances) {
      if (inst.status === 'CANCELLED') continue;
      if (inst.start < from || inst.start > to) continue;
      // One row per occurrence; the instance start makes the id stable across syncs until that occurrence moves.
      const externalId = inst.recurring ? `${uid}:${inst.start.toISOString()}` : uid;
      rows.push({
        id: `gcal_ical:${externalId}`,
        source: 'gcal_ical',
        externalId,
        kind: 'event',
        courseId: null,
        title: inst.summary.trim() || '(no title)',
        description: inst.description ? inst.description.slice(0, 2000) : null,
        url: httpOnly(ev.url),
        startsAt: isoOrNull(inst.start),
        endsAt: isoOrNull(inst.end),
        dueAt: null,
        allDay: inst.allDay,
        status: 'open',
        points: null,
        score: null,
        labels: [],
        raw: {
          uid: ev.uid,
          calendarName,
          color: null,
          location: inst.location || null,
          recurring: inst.recurring,
          override: inst.override,
          tentative: inst.status === 'TENTATIVE',
        },
      });
    }
  }
  // calendarName is read from the VCALENDAR block, which node-ical lists last; stamp it on every row now.
  if (calendarName) for (const r of rows) (r.raw as Record<string, unknown>).calendarName = calendarName;
  return { rows, calendarName, recurringEvents };
}

/** Fetches the configured feed and upserts its events, soft-deleting rows inside the window that are gone. */
export async function syncGcalIcal(ctx: AppContext, fetchImpl: typeof fetch = fetch, signal?: AbortSignal, now = new Date()) {
  const config = await getSourceConfig<{ url: string }>(ctx, 'gcal_ical');
  if (!config?.url) throw new NotConfiguredError('Google Calendar iCal address not set');
  const { url } = sourceConfigSchemas.gcal_ical.parse(config);
  assertAllowedOutboundUrl(url, 'the Google Calendar iCal address');
  const res = await fetchImpl(url, { signal: withTimeout(signal, 45_000), headers: { 'User-Agent': 'collected/0.1' } });
  if (!res.ok) throw new Error(`iCal fetch ${res.status}`);
  if (res.url && !res.url.startsWith(new URL(url).origin)) throw new Error('iCal feed redirected to another host');
  const text = await readText(res, 10 * MB);
  if (!/BEGIN:VCALENDAR/.test(text)) throw new Error('iCal URL did not return a calendar (is it the secret address, not the public one?)');
  const { rows, calendarName, recurringEvents } = parseGoogleIcs(text, now);
  const { from, to } = icalWindow(now);
  // Scope: only rows whose start lies in this run's window may be soft-deleted. An empty feed skips the delete
  // (upsertItems' guard), and a thrown fetch never reaches here, so a bad answer cannot wipe the calendar.
  const r = await upsertItems(ctx, 'gcal_ical', rows, [gte(items.startsAt, from.toISOString()), lte(items.startsAt, to.toISOString())]);
  return {
    counts: { events: rows.length, recurring: recurringEvents, upserted: r.upserted, created: r.created, deleted: r.deleted },
    meta: { calendarName },
  };
}

export const gcalIcalIngester: Ingester = {
  id: 'gcal_ical',
  intervalMinutes: 30,
  timeoutMs: 60_000,
  run: (ctx, signal) => syncGcalIcal(ctx, fetch, signal),
};
