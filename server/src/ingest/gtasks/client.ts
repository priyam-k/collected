import type { Env } from '../../env.js';
import { MB, readText, safeUrlForLog, withTimeout } from '../../lib/http.js';
import { oauthClient } from '../gcal/api.js';
import { NeedsAuthError } from '../types.js';
import { MAX_TASKS_PER_LIST, TASKS_BASE, type GTask, type GTaskList, type GTasksApi, type NewGTask } from './api.js';

const REQUEST_TIMEOUT_MS = 30_000;
const PAGE_SIZE = 100;

/** Mints an access token from the stored refresh token (google-auth-library caches and refreshes it). */
export function accessTokenFromRefreshToken(env: Env, refreshToken: string): () => Promise<string> {
  const client = oauthClient(env);
  client.setCredentials({ refresh_token: refreshToken });
  return async () => {
    try {
      const { token } = await client.getAccessToken();
      if (!token) throw new NeedsAuthError('Google returned no access token for Tasks');
      return token;
    } catch (err) {
      if (err instanceof NeedsAuthError) throw err;
      const msg = (err as Error).message ?? String(err);
      if (/invalid_grant|invalid_rapt|expired or revoked|unauthorized_client/i.test(msg)) throw new NeedsAuthError(`Google rejected the refresh token: ${msg}`);
      throw err;
    }
  };
}

/**
 * Google Tasks REST over fetch. Every request has its own deadline and a byte budget; requests only ever go to
 * TASKS_BASE (ids are path-encoded, page tokens are query values). 401 and scope errors → NeedsAuthError.
 */
export class GTasksHttpApi implements GTasksApi {
  requestCount = 0;
  signal?: AbortSignal;

  constructor(
    private readonly token: () => Promise<string>,
    private readonly fetchImpl: typeof fetch = fetch,
    readonly base = TASKS_BASE,
  ) {}

  private async req<T>(method: string, path: string, opts: { query?: Record<string, string | number | undefined>; body?: unknown } = {}): Promise<T> {
    this.requestCount++;
    const url = new URL(`${this.base}${path}`);
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
    const res = await this.fetchImpl(url, {
      method,
      redirect: 'error',
      signal: withTimeout(this.signal, REQUEST_TIMEOUT_MS),
      headers: { Authorization: `Bearer ${await this.token()}`, Accept: 'application/json', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const text = await readText(res, 8 * MB);
    if (!res.ok) {
      let message = '';
      try {
        message = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? '';
      } catch {
        /* not JSON */
      }
      if (res.status === 401 || (res.status === 403 && /insufficient|scope/i.test(message + text.slice(0, 500)))) {
        throw new NeedsAuthError(`Google Tasks rejected the credentials (${res.status}); reconnect Google Tasks`);
      }
      throw new Error(`Google Tasks ${method} ${safeUrlForLog(url.toString())} → ${res.status}${message ? `: ${message.slice(0, 300)}` : ''}`);
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  async listTaskLists(): Promise<GTaskList[]> {
    const out: GTaskList[] = [];
    let pageToken: string | undefined;
    for (let i = 0; i < 10; i++) {
      const page = await this.req<{ items?: GTaskList[]; nextPageToken?: string }>('GET', '/users/@me/lists', { query: { maxResults: PAGE_SIZE, pageToken } });
      out.push(...(page.items ?? []).filter((l) => !!l.id));
      if (!page.nextPageToken) break;
      pageToken = page.nextPageToken;
    }
    return out;
  }

  async listTasks(listId: string): Promise<{ tasks: GTask[]; truncated: boolean }> {
    const tasks: GTask[] = [];
    let pageToken: string | undefined;
    for (;;) {
      const page = await this.req<{ items?: GTask[]; nextPageToken?: string }>('GET', `/lists/${encodeURIComponent(listId)}/tasks`, {
        query: { showCompleted: 'true', showHidden: 'true', showDeleted: 'false', maxResults: PAGE_SIZE, pageToken },
      });
      tasks.push(...(page.items ?? []).filter((t) => !!t.id));
      if (!page.nextPageToken) return { tasks, truncated: false };
      if (tasks.length >= MAX_TASKS_PER_LIST) return { tasks: tasks.slice(0, MAX_TASKS_PER_LIST), truncated: true };
      pageToken = page.nextPageToken;
    }
  }

  async insertTask(listId: string, body: NewGTask): Promise<GTask> {
    return this.req<GTask>('POST', `/lists/${encodeURIComponent(listId)}/tasks`, { body });
  }

  async completeTask(listId: string, taskId: string): Promise<GTask> {
    return this.req<GTask>('PATCH', `/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`, { body: { status: 'completed' } });
  }
}
