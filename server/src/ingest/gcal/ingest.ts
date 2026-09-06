import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { sourceConfigSchemas } from '@collected/shared';
import type { AppContext } from '../../context.js';
import { items, type NewItemRow } from '../../db/schema.js';
import { upsertItems } from '../../lib/items.js';
import { getSourceConfig, getSourceRow } from '../../lib/sources.js';
import { addDays, nowIso } from '../../lib/time.js';
import { NotConfiguredError, type Ingester } from '../types.js';
import { GoogleCalendarApi, SyncTokenGoneError, type CalendarApi, type GCalendar, type GEvent } from './api.js';
import { eventToRow } from './map.js';

export const GCAL_PAST_DAYS = 30;
export const GCAL_FUTURE_DAYS = 90;

export interface GcalMeta {
  calendars?: GCalendar[];
  selectedCalendars?: string[];
  defaultCalendarId?: string;
  syncTokens?: Record<string, string>;
  lastFullSyncAt?: Record<string, string>;
}

export function selectedCalendarIds(meta: GcalMeta): string[] {
  if (meta.selectedCalendars?.length) return meta.selectedCalendars;
  const primary = meta.calendars?.find((c) => c.primary);
  return primary ? [primary.id] : (meta.calendars ?? []).slice(0, 1).map((c) => c.id);
}

async function fetchAll(api: CalendarApi, calendarId: string, params: { syncToken?: string; timeMin?: string; timeMax?: string }): Promise<{ events: GEvent[]; syncToken: string | null }> {
  const events: GEvent[] = [];
  let pageToken: string | undefined;
  let syncToken: string | null = null;
  for (let i = 0; i < 40; i++) {
    const page = await api.listEvents(calendarId, { ...params, pageToken });
    events.push(...page.items);
    if (page.nextSyncToken) syncToken = page.nextSyncToken;
    if (!page.nextPageToken) break;
    pageToken = page.nextPageToken;
  }
  return { events, syncToken };
}

/** Full or incremental sync of every selected calendar. Returns counts and the meta patch (new sync tokens). */
export async function syncGcal(ctx: AppContext, api: CalendarApi, meta: GcalMeta, now = new Date()): Promise<{ counts: Record<string, number>; meta: GcalMeta }> {
  const calendars = (await api.listCalendars()).length ? await api.listCalendars() : (meta.calendars ?? []);
  const nextMeta: GcalMeta = { ...meta, calendars, syncTokens: { ...(meta.syncTokens ?? {}) }, lastFullSyncAt: { ...(meta.lastFullSyncAt ?? {}) } };
  const selected = selectedCalendarIds(nextMeta);
  const counts: Record<string, number> = { calendars: calendars.length, selected: selected.length, upserted: 0, created: 0, deleted: 0, cancelled: 0, fullSyncs: 0, incremental: 0 };
  const timeMin = addDays(now, -GCAL_PAST_DAYS).toISOString();
  const timeMax = addDays(now, GCAL_FUTURE_DAYS).toISOString();

  for (const calId of selected) {
    const cal = calendars.find((c) => c.id === calId);
    const color = cal?.backgroundColor ?? null;
    const name = cal?.summary ?? null;
    let token = nextMeta.syncTokens![calId];
    let full = !token;
    let result: { events: GEvent[]; syncToken: string | null };
    try {
      result = await fetchAll(api, calId, token ? { syncToken: token } : { timeMin, timeMax });
    } catch (err) {
      if (!(err instanceof SyncTokenGoneError)) throw err;
      ctx.log.info({ calendar: calId }, 'gcal sync token expired; full sync');
      token = undefined;
      full = true;
      result = await fetchAll(api, calId, { timeMin, timeMax });
    }
    if (full) counts.fullSyncs!++;
    else counts.incremental!++;

    const live: NewItemRow[] = [];
    const cancelledIds: string[] = [];
    for (const ev of result.events) {
      const row = eventToRow(ev, calId, name, color);
      if (row.status === 'cancelled') cancelledIds.push(row.id);
      else live.push(row);
    }
    const scope = full
      ? [sql`${items.externalId} LIKE ${`${calId}:%`}`, gte(items.startsAt, timeMin), lte(items.startsAt, timeMax)]
      : undefined;
    const r = await upsertItems(ctx, 'gcal', live, scope);
    counts.upserted! += r.upserted;
    counts.created! += r.created;
    counts.deleted! += r.deleted;
    if (cancelledIds.length) {
      const gone = await ctx.db.update(items).set({ deletedAt: nowIso(), status: 'cancelled' }).where(and(eq(items.source, 'gcal'), inArray(items.id, cancelledIds))).returning({ id: items.id });
      counts.cancelled! += gone.length;
    }
    if (result.syncToken) nextMeta.syncTokens![calId] = result.syncToken;
    if (full) nextMeta.lastFullSyncAt![calId] = nowIso();
  }
  // Drop tokens for calendars that are no longer selected so re-selecting does a clean full sync.
  for (const k of Object.keys(nextMeta.syncTokens!)) if (!selected.includes(k)) delete nextMeta.syncTokens![k];
  return { counts, meta: nextMeta };
}

export async function gcalApiForCtx(ctx: AppContext): Promise<GoogleCalendarApi> {
  const config = await getSourceConfig<{ refreshToken: string }>(ctx, 'gcal');
  if (!config?.refreshToken) throw new NotConfiguredError('Google Calendar is not connected');
  const { refreshToken } = sourceConfigSchemas.gcal.parse(config);
  return GoogleCalendarApi.fromRefreshToken(ctx.env, refreshToken);
}

export const gcalIngester: Ingester = {
  id: 'gcal',
  intervalMinutes: 5,
  timeoutMs: 120_000,
  async run(ctx) {
    const api = await gcalApiForCtx(ctx);
    const row = await getSourceRow(ctx, 'gcal');
    const { counts, meta } = await syncGcal(ctx, api, row.meta as GcalMeta);
    return { counts, meta: meta as unknown as Record<string, unknown> };
  },
};
