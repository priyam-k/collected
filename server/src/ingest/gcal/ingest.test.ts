import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { items } from '../../db/schema.js';
import { testContext } from '../../test-util.js';
import { localDateToIso } from './map.js';
import { MockCalendarApi, demoCalendars } from './mock-api.js';
import { syncGcal } from './ingest.js';

const cal = 'primary@example.com';
const ev = (id: string, summary: string, start: string, end: string, status = 'confirmed') => ({ id, status, summary, start: { dateTime: start }, end: { dateTime: end } });

describe('gcal sync', () => {
  it('does a paged full sync, stores the sync token, then goes incremental and applies cancellations', async () => {
    const ctx = await testContext();
    const api = new MockCalendarApi([demoCalendars[0]!], {
      pages: {
        [`${cal}|full|`]: { items: [ev('a', 'A', '2026-09-07T14:00:00Z', '2026-09-07T15:00:00Z')], nextPageToken: 'p2', nextSyncToken: null },
        [`${cal}|full|p2`]: {
          items: [ev('b', 'B', '2026-09-08T14:00:00Z', '2026-09-08T15:00:00Z'), { id: 'allday', status: 'confirmed', summary: 'Rent', start: { date: '2026-09-10' }, end: { date: '2026-09-11' } }],
          nextPageToken: null,
          nextSyncToken: 'T1',
        },
        [`${cal}|T1|`]: { items: [ev('a', 'A renamed', '2026-09-07T14:00:00Z', '2026-09-07T15:00:00Z'), ev('b', 'B', '2026-09-08T14:00:00Z', '2026-09-08T15:00:00Z', 'cancelled')], nextPageToken: null, nextSyncToken: 'T2' },
        [`${cal}|T2|`]: 'gone',
      },
    });
    const now = new Date('2026-09-06T12:00:00Z');
    const r1 = await syncGcal(ctx, api, {}, now);
    expect(r1.counts).toMatchObject({ selected: 1, upserted: 3, created: 3, fullSyncs: 1, incremental: 0 });
    expect(r1.meta.syncTokens).toEqual({ [cal]: 'T1' });
    const allday = await ctx.db.query.items.findFirst({ where: eq(items.id, `gcal:${cal}:allday`) });
    expect(allday?.allDay).toBe(true);
    expect(allday?.startsAt).toBe(localDateToIso('2026-09-10'));

    const r2 = await syncGcal(ctx, api, r1.meta, now);
    expect(r2.counts).toMatchObject({ incremental: 1, cancelled: 1, upserted: 1 });
    expect(r2.meta.syncTokens).toEqual({ [cal]: 'T2' });
    const a = await ctx.db.query.items.findFirst({ where: eq(items.id, `gcal:${cal}:a`) });
    expect(a?.title).toBe('A renamed');
    const b = await ctx.db.query.items.findFirst({ where: eq(items.id, `gcal:${cal}:b`) });
    expect(b?.deletedAt).toBeTruthy();

    // 410 → full resync using the full pages again
    const r3 = await syncGcal(ctx, api, r2.meta, now);
    expect(r3.counts.fullSyncs).toBe(1);
    expect(api.calls.filter((c) => c.method === 'listEvents' && c.params?.syncToken === 'T2').length).toBe(1);
    expect(r3.meta.syncTokens).toEqual({ [cal]: 'T1' });
  });

  it('defaults to the primary calendar and forgets tokens of deselected calendars', async () => {
    const ctx = await testContext();
    const api = new MockCalendarApi(demoCalendars, {
      pages: { [`${cal}|full|`]: { items: [], nextPageToken: null, nextSyncToken: 'X' } },
    });
    const r = await syncGcal(ctx, api, { syncTokens: { 'clubs@group.calendar.google.com': 'old' } }, new Date());
    expect(r.counts.selected).toBe(1);
    expect(r.meta.syncTokens).toEqual({ [cal]: 'X' });
  });
});
