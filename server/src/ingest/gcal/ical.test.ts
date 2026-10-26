import { readFileSync } from 'node:fs';
import path from 'node:path';
import { and, eq, isNull } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { items, sources } from '../../db/schema.js';
import { setSourceConfig } from '../../lib/sources.js';
import { testContext } from '../../test-util.js';
import { runIngester } from '../runner.js';
import { gcalIcalIngester, parseGoogleIcs, syncGcalIcal } from './ical.js';
import { localDateToIso } from './map.js';

const fixture = readFileSync(path.resolve(import.meta.dirname, 'fixtures', 'google.ics'), 'utf8');
const FEED = 'https://calendar.google.com/calendar/ical/someone%40gmail.com/private-0123456789abcdef/basic.ics';
/** Window: 2026-10-06 → 2026-12-19. */
const now = new Date('2026-10-20T12:00:00Z');

const icsResponse = (body: string, status = 200) => {
  const res = new Response(body, { status, headers: { 'content-type': 'text/calendar; charset=UTF-8' } });
  Object.defineProperty(res, 'url', { value: FEED });
  return res;
};
const fetchOf = (body: string, status = 200): typeof fetch => async () => icsResponse(body, status);

async function liveIds(ctx: Awaited<ReturnType<typeof testContext>>) {
  const rows = await ctx.db.select({ id: items.id }).from(items).where(and(eq(items.source, 'gcal_ical'), isNull(items.deletedAt)));
  return rows.map((r) => r.id).sort();
}

describe('gcal ical parse', () => {
  it('maps timed, all-day and recurring events inside the window, honouring EXDATE and overrides', () => {
    const { rows, calendarName, recurringEvents } = parseGoogleIcs(fixture, now);
    expect(calendarName).toBe('Personal');
    expect(recurringEvents).toBe(1);

    const dentist = rows.find((r) => r.externalId === 'dentist2026@google.com')!;
    expect(dentist).toMatchObject({ id: 'gcal_ical:dentist2026@google.com', kind: 'event', allDay: false, status: 'open', startsAt: '2026-10-22T18:00:00.000Z', endsAt: '2026-10-22T19:00:00.000Z', title: 'Dentist', description: 'Bring the insurance card.' });
    expect(dentist.raw).toMatchObject({ calendarName: 'Personal', location: '4321 Main St', recurring: false });

    const halloween = rows.find((r) => r.externalId === 'halloween2026@google.com')!;
    expect(halloween.allDay).toBe(true);
    expect(halloween.startsAt).toBe(localDateToIso('2026-10-31'));
    expect(halloween.description).toBeNull();

    const standups = rows.filter((r) => r.externalId.startsWith('standup@google.com:')).sort((a, b) => a.startsAt!.localeCompare(b.startsAt!));
    // Oct 5 is before the window, Oct 19 is an EXDATE, Oct 26 is moved by a RECURRENCE-ID override, Dec 21 is after.
    expect(standups.map((r) => r.startsAt)).toEqual([
      '2026-10-12T14:00:00.000Z',
      '2026-10-26T15:00:00.000Z',
      '2026-11-02T15:00:00.000Z',
      '2026-11-09T15:00:00.000Z',
      '2026-11-16T15:00:00.000Z',
      '2026-11-23T15:00:00.000Z',
      '2026-11-30T15:00:00.000Z',
      '2026-12-07T15:00:00.000Z',
      '2026-12-14T15:00:00.000Z',
    ]);
    const moved = standups[1]!;
    expect(moved.title).toBe('Standup (moved)');
    expect(moved.endsAt).toBe('2026-10-26T15:30:00.000Z');
    expect(moved.raw).toMatchObject({ recurring: true, override: true, location: 'Room 2' });
    expect(standups[0]!.raw).toMatchObject({ recurring: true, override: false, location: 'Room 1' });
    expect(standups[0]!.description).toBe('Weekly sync');

    // Out of window and cancelled events are left out entirely.
    expect(rows.some((r) => r.externalId === 'old2025@google.com')).toBe(false);
    expect(rows.some((r) => r.externalId === 'cancelled2026@google.com')).toBe(false);
    expect(rows).toHaveLength(11);
    expect(new Set(rows.map((r) => r.id)).size).toBe(11);
  });

  it('caps a runaway rule', () => {
    const ics = fixture.replace('RRULE:FREQ=WEEKLY;BYDAY=MO', 'RRULE:FREQ=HOURLY');
    const { rows } = parseGoogleIcs(ics, now);
    expect(rows.filter((r) => r.externalId.startsWith('standup@google.com:'))).toHaveLength(500);
  });
});

describe('gcal ical sync', () => {
  it('upserts the feed, keeps rows on a failed or empty answer, and soft-deletes only what the feed dropped', async () => {
    const ctx = await testContext();
    await setSourceConfig(ctx, 'gcal_ical', { url: FEED });

    const r1 = await syncGcalIcal(ctx, fetchOf(fixture), undefined, now);
    expect(r1.counts).toMatchObject({ events: 11, upserted: 11, created: 11, deleted: 0, recurring: 1 });
    expect(r1.meta.calendarName).toBe('Personal');
    const before = await liveIds(ctx);
    expect(before).toHaveLength(11);

    // A 500 is an error, and nothing is touched.
    await expect(syncGcalIcal(ctx, fetchOf('nope', 500), undefined, now)).rejects.toThrow('iCal fetch 500');
    expect(await liveIds(ctx)).toEqual(before);

    // A network failure is an error, and nothing is touched.
    const failing: typeof fetch = async () => {
      throw new Error('ECONNRESET');
    };
    await expect(syncGcalIcal(ctx, failing, undefined, now)).rejects.toThrow('ECONNRESET');
    expect(await liveIds(ctx)).toEqual(before);

    // Not a calendar at all (the public HTML address instead of the secret one).
    await expect(syncGcalIcal(ctx, fetchOf('<html>Sign in</html>'), undefined, now)).rejects.toThrow('did not return a calendar');
    expect(await liveIds(ctx)).toEqual(before);

    // A calendar with zero events parses fine but trips upsertItems' empty guard: no soft-delete.
    const empty = 'BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Google Inc//Google Calendar 70.9054//EN\nEND:VCALENDAR\n';
    const r2 = await syncGcalIcal(ctx, fetchOf(empty), undefined, now);
    expect(r2.counts).toMatchObject({ events: 0, deleted: 0 });
    expect(await liveIds(ctx)).toEqual(before);

    // The dentist appointment disappears from the feed: that one row goes, the rest stay.
    const withoutDentist = fixture.replace(/BEGIN:VEVENT\n(?:(?!END:VEVENT)[\s\S])*UID:dentist2026@google\.com(?:(?!END:VEVENT)[\s\S])*END:VEVENT\n/, '');
    expect(withoutDentist).not.toContain('dentist2026');
    const r3 = await syncGcalIcal(ctx, fetchOf(withoutDentist), undefined, now);
    expect(r3.counts).toMatchObject({ events: 10, deleted: 1 });
    const after = await liveIds(ctx);
    expect(after).toHaveLength(10);
    expect(after).not.toContain('gcal_ical:dentist2026@google.com');
    const gone = await ctx.db.query.items.findFirst({ where: eq(items.id, 'gcal_ical:dentist2026@google.com') });
    expect(gone?.deletedAt).toBeTruthy();
  });

  it('is disconnected without a URL and records an error status through the runner', async () => {
    const ctx = await testContext();
    const unconfigured = await runIngester(ctx, gcalIcalIngester, { force: true });
    expect(unconfigured).toMatchObject({ ok: false, status: 'disconnected' });

    await setSourceConfig(ctx, 'gcal_ical', { url: FEED });
    const failing: typeof fetch = async () => icsResponse('oops', 503);
    const outcome = await runIngester(ctx, { ...gcalIcalIngester, run: (c, signal) => syncGcalIcal(c, failing, signal, now) }, { force: true });
    expect(outcome).toMatchObject({ ok: false, status: 'error' });
    const row = await ctx.db.query.sources.findFirst({ where: eq(sources.id, 'gcal_ical') });
    expect(row?.status).toBe('error');
    expect(row?.lastError).toContain('503');

    const ok = await runIngester(ctx, { ...gcalIcalIngester, run: (c, signal) => syncGcalIcal(c, fetchOf(fixture), signal, now) }, { force: true });
    expect(ok.ok).toBe(true);
    const row2 = await ctx.db.query.sources.findFirst({ where: eq(sources.id, 'gcal_ical') });
    expect(row2?.status).toBe('connected');
    expect((row2?.meta as { calendarName?: string }).calendarName).toBe('Personal');
  });

  it('refuses a non-https or private feed address', async () => {
    const ctx = await testContext();
    await setSourceConfig(ctx, 'gcal_ical', { url: 'http://10.0.0.5/basic.ics' });
    await expect(syncGcalIcal(ctx, fetchOf(fixture), undefined, now)).rejects.toThrow();
    expect(await liveIds(ctx)).toEqual([]);
  });
});
