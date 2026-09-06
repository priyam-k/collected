import { SyncTokenGoneError, type CalendarApi, type EventsPage, type GCalendar, type GEvent, type ListEventsParams, type NewEvent } from './api.js';

export interface Scripted {
  /** Responses keyed by `${calendarId}|${syncToken ?? 'full'}|${pageToken ?? ''}`; a value of 'gone' throws 410. */
  pages: Record<string, EventsPage | 'gone'>;
}

/** Deterministic CalendarApi for tests and `cli demo gcal`. Records every call. */
export class MockCalendarApi implements CalendarApi {
  calls: { method: string; calendarId?: string; params?: ListEventsParams }[] = [];
  inserted: { calendarId: string; body: NewEvent }[] = [];
  constructor(
    public calendars: GCalendar[],
    public script: Scripted,
  ) {}

  async listCalendars(): Promise<GCalendar[]> {
    this.calls.push({ method: 'listCalendars' });
    return this.calendars;
  }

  async listEvents(calendarId: string, params: ListEventsParams): Promise<EventsPage> {
    this.calls.push({ method: 'listEvents', calendarId, params });
    const key = `${calendarId}|${params.syncToken ?? 'full'}|${params.pageToken ?? ''}`;
    const res = this.script.pages[key];
    if (!res) throw new Error(`mock: no scripted page for ${key}`);
    if (res === 'gone') throw new SyncTokenGoneError();
    return res;
  }

  async insertEvent(calendarId: string, body: NewEvent): Promise<GEvent> {
    this.inserted.push({ calendarId, body });
    return { id: `new-${this.inserted.length}`, status: 'confirmed', summary: body.summary, description: body.description, location: body.location, start: body.start, end: body.end, htmlLink: 'https://calendar.google.com/event?eid=new' };
  }
}

export const demoCalendars: GCalendar[] = [
  { id: 'primary@example.com', summary: 'Priyam', primary: true, backgroundColor: '#4285f4', accessRole: 'owner' },
  { id: 'clubs@group.calendar.google.com', summary: 'Clubs', primary: false, backgroundColor: '#0b8043', accessRole: 'reader' },
];

/** A week of plausible events around `now`, for UI development. */
export function demoScript(now = new Date()): Scripted {
  const d = (offsetDays: number, h: number, m = 0) => {
    const x = new Date(now);
    x.setDate(x.getDate() + offsetDays);
    x.setHours(h, m, 0, 0);
    return x.toISOString();
  };
  const day = (offsetDays: number) => {
    const x = new Date(now);
    x.setDate(x.getDate() + offsetDays);
    return x.toISOString().slice(0, 10);
  };
  const ev = (id: string, summary: string, start: string, end: string, extra: Partial<GEvent> = {}): GEvent => ({ id, status: 'confirmed', summary, start: { dateTime: start }, end: { dateTime: end }, htmlLink: `https://calendar.google.com/event?eid=${id}`, ...extra });
  return {
    pages: {
      'primary@example.com|full|': {
        items: [
          ev('e1', 'CMSC422 lecture', d(0, 14), d(0, 15, 15), { location: 'IRB 0324' }),
          ev('e2', 'Gym', d(0, 18), d(0, 19)),
          ev('e3', 'CMSC330 discussion (teach)', d(1, 11), d(1, 11, 50), { location: 'CSI 2107' }),
          ev('e4', 'Dinner w/ roommates', d(1, 19, 30), d(1, 21)),
          ev('e5', 'STAT410 lecture', d(2, 9, 30), d(2, 10, 45)),
          ev('e6', 'Career fair', d(3, 12), d(3, 16), { location: 'Xfinity Center' }),
          { id: 'e7', status: 'confirmed', summary: 'Rent due', start: { date: day(4) }, end: { date: day(5) } },
          ev('e8', 'Office hours (hold)', d(5, 15), d(5, 17)),
          ev('e9', 'Brunch', d(6, 11), d(6, 12, 30)),
          ev('e10', 'Old meeting', d(-3, 10), d(-3, 11)),
        ],
        nextPageToken: null,
        nextSyncToken: 'demo-token-1',
      },
      'clubs@group.calendar.google.com|full|': {
        items: [ev('c1', 'Robotics club GBM', d(2, 18), d(2, 19, 30), { location: 'IRB 1116' }), ev('c2', 'Hackathon info session', d(4, 17), d(4, 18))],
        nextPageToken: null,
        nextSyncToken: 'demo-token-c1',
      },
      'primary@example.com|demo-token-1|': { items: [], nextPageToken: null, nextSyncToken: 'demo-token-1' },
      'clubs@group.calendar.google.com|demo-token-c1|': { items: [], nextPageToken: null, nextSyncToken: 'demo-token-c1' },
    },
  };
}
