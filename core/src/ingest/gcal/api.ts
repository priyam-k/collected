import { auth as googleAuth, calendar, type calendar_v3 } from '@googleapis/calendar';
import type { CoreConfig } from '../../config.js';
import { NeedsAuthError, NotConfiguredError } from '../types.js';

export interface GCalendar {
  id: string;
  summary: string;
  primary: boolean;
  backgroundColor: string | null;
  accessRole: string | null;
}

export interface GEvent {
  id: string;
  status?: string | null;
  summary?: string | null;
  description?: string | null;
  location?: string | null;
  htmlLink?: string | null;
  start?: { date?: string | null; dateTime?: string | null; timeZone?: string | null } | null;
  end?: { date?: string | null; dateTime?: string | null; timeZone?: string | null } | null;
  updated?: string | null;
  recurringEventId?: string | null;
  colorId?: string | null;
}

export interface EventsPage {
  items: GEvent[];
  nextPageToken: string | null;
  nextSyncToken: string | null;
}

export interface ListEventsParams {
  syncToken?: string;
  timeMin?: string;
  timeMax?: string;
  pageToken?: string;
}

export interface NewEvent {
  summary: string;
  description?: string;
  location?: string;
  start: { date?: string; dateTime?: string };
  end: { date?: string; dateTime?: string };
}

/** Thrown when Google says a sync token is no longer valid (HTTP 410): do a full sync. */
export class SyncTokenGoneError extends Error {
  constructor() {
    super('sync token expired');
    this.name = 'SyncTokenGoneError';
  }
}

export interface CalendarApi {
  listCalendars(): Promise<GCalendar[]>;
  listEvents(calendarId: string, params: ListEventsParams): Promise<EventsPage>;
  insertEvent(calendarId: string, body: NewEvent): Promise<GEvent>;
}

export const SCOPES = ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.readonly'];

export function redirectUri(env: CoreConfig): string {
  return `${env.PUBLIC_URL.replace(/\/$/, '')}/api/google/callback`;
}

export type OAuth2Client = InstanceType<typeof googleAuth.OAuth2>;

export function oauthClient(env: CoreConfig): OAuth2Client {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new NotConfiguredError('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set (see artifacts/SETUP.md, Phase 1)');
  }
  return new googleAuth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, redirectUri(env));
}

export function authUrl(env: CoreConfig, state: string): string {
  return oauthClient(env).generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES, state, include_granted_scopes: true });
}

/**
 * Consent for one more scope on the same client (incremental authorization). Used by Google Tasks, so connecting
 * Tasks never changes what the Calendar connect asks for and the Calendar consent never asks for Tasks.
 */
export function incrementalAuthUrl(env: CoreConfig, state: string, scopes: string[]): string {
  return oauthClient(env).generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: scopes, state, include_granted_scopes: true });
}

export async function exchangeCode(env: CoreConfig, code: string): Promise<{ refreshToken: string | null; scopes: string[] }> {
  const client = oauthClient(env);
  const { tokens } = await client.getToken(code);
  return { refreshToken: tokens.refresh_token ?? null, scopes: (tokens.scope ?? '').split(/\s+/).filter(Boolean) };
}

function classify(err: unknown): Error {
  const e = err as { code?: number | string; message?: string; response?: { status?: number; data?: unknown } };
  const status = Number(e.response?.status ?? e.code);
  const msg = e.message ?? String(err);
  if (status === 410) return new SyncTokenGoneError();
  if (status === 401 || /invalid_grant|invalid_rapt|Token has been expired or revoked/i.test(msg)) {
    return new NeedsAuthError(`Google rejected the refresh token: ${msg}`);
  }
  return err instanceof Error ? err : new Error(msg);
}

/** Real implementation over googleapis. */
export class GoogleCalendarApi implements CalendarApi {
  private readonly cal: calendar_v3.Calendar;

  constructor(auth: OAuth2Client) {
    this.cal = calendar({ version: 'v3', auth, timeout: 30_000 });
  }

  static fromRefreshToken(env: CoreConfig, refreshToken: string): GoogleCalendarApi {
    const client = oauthClient(env);
    client.setCredentials({ refresh_token: refreshToken });
    return new GoogleCalendarApi(client);
  }

  async listCalendars(): Promise<GCalendar[]> {
    try {
      const res = await this.cal.calendarList.list({ minAccessRole: 'reader', showHidden: false, maxResults: 250 });
      return (res.data.items ?? [])
        .filter((c) => c.id)
        .map((c) => ({ id: c.id!, summary: c.summaryOverride ?? c.summary ?? c.id!, primary: !!c.primary, backgroundColor: c.backgroundColor ?? null, accessRole: c.accessRole ?? null }));
    } catch (err) {
      throw classify(err);
    }
  }

  async listEvents(calendarId: string, p: ListEventsParams): Promise<EventsPage> {
    try {
      const res = await this.cal.events.list({
        calendarId,
        singleEvents: true,
        showDeleted: true,
        maxResults: 250,
        pageToken: p.pageToken,
        ...(p.syncToken ? { syncToken: p.syncToken } : { timeMin: p.timeMin, timeMax: p.timeMax }),
      });
      return {
        items: (res.data.items ?? []).filter((e) => !!e.id).map((e) => e as GEvent),
        nextPageToken: res.data.nextPageToken ?? null,
        nextSyncToken: res.data.nextSyncToken ?? null,
      };
    } catch (err) {
      throw classify(err);
    }
  }

  async insertEvent(calendarId: string, body: NewEvent): Promise<GEvent> {
    try {
      const res = await this.cal.events.insert({ calendarId, requestBody: body });
      return res.data as GEvent;
    } catch (err) {
      throw classify(err);
    }
  }
}
