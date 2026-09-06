import { NeedsAuthError } from '../types.js';
import type { NewTaskBody, TLabel, TProject, TSection, TTask, TodoistApi, UpdateTaskBody } from './api.js';

export const TODOIST_BASE = 'https://api.todoist.com/api/v1';

interface Page<T> {
  results: T[];
  next_cursor: string | null;
}

/**
 * Todoist unified API v1 over fetch. List endpoints are cursor-paginated (`cursor` / `next_cursor`,
 * items under `results`). Ids are opaque strings. 401/403 → NeedsAuthError.
 */
export class TodoistHttpApi implements TodoistApi {
  requestCount = 0;
  constructor(
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
    readonly base = TODOIST_BASE,
  ) {}

  private async req<T>(method: string, path: string, opts: { query?: Record<string, string | number | undefined>; body?: unknown } = {}): Promise<T> {
    this.requestCount++;
    const url = new URL(`${this.base}${path}`);
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
    const res = await this.fetchImpl(url, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (res.status === 401 || res.status === 403) throw new NeedsAuthError(`Todoist rejected the token (${res.status})`);
    if (res.status === 429) {
      const retry = Number(res.headers.get('retry-after') ?? 2);
      await new Promise((r) => setTimeout(r, Math.min(30, retry) * 1000));
      return this.req(method, path, opts);
    }
    if (!res.ok) throw new Error(`Todoist ${res.status} ${method} ${path}: ${(await res.text()).slice(0, 200)}`);
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  private async paged<T>(path: string, query: Record<string, string | number | undefined> = {}): Promise<T[]> {
    const out: T[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 50; i++) {
      const page = await this.req<Page<T> | T[]>('GET', path, { query: { ...query, limit: 200, cursor } });
      if (Array.isArray(page)) return page; // defensive: some endpoints may return bare arrays
      out.push(...(page.results ?? []));
      if (!page.next_cursor) break;
      cursor = page.next_cursor;
    }
    return out;
  }

  listProjects() {
    return this.paged<TProject>('/projects');
  }
  createProject(name: string) {
    return this.req<TProject>('POST', '/projects', { body: { name } });
  }
  listSections() {
    return this.paged<TSection>('/sections');
  }
  listLabels() {
    return this.paged<TLabel>('/labels');
  }
  createLabel(name: string) {
    return this.req<TLabel>('POST', '/labels', { body: { name } });
  }
  listTasks(params?: { projectId?: string }) {
    return this.paged<TTask>('/tasks', { project_id: params?.projectId });
  }
  async listCompleted(since: string, until: string) {
    // v1 exposes completed tasks by completion date (3-month window max) with an `items` envelope.
    const out: TTask[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 50; i++) {
      const page = await this.req<{ items?: TTask[]; results?: TTask[]; next_cursor?: string | null }>('GET', '/tasks/completed/by_completion_date', {
        query: { since, until, limit: 200, cursor },
      });
      out.push(...(page.items ?? page.results ?? []));
      if (!page.next_cursor) break;
      cursor = page.next_cursor;
    }
    return out.map((t) => ({ ...t, checked: true }));
  }
  createTask(body: NewTaskBody) {
    return this.req<TTask>('POST', '/tasks', { body });
  }
  quickAdd(text: string) {
    return this.req<TTask>('POST', '/tasks/quick', { body: { text } });
  }
  updateTask(id: string, body: UpdateTaskBody) {
    return this.req<TTask>('POST', `/tasks/${encodeURIComponent(id)}`, { body });
  }
  async closeTask(id: string) {
    await this.req<void>('POST', `/tasks/${encodeURIComponent(id)}/close`);
  }
  async deleteTask(id: string) {
    await this.req<void>('DELETE', `/tasks/${encodeURIComponent(id)}`);
  }
}
