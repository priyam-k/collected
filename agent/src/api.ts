import { createWriteStream, mkdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { EffectiveItem, FileSyncManifest, FileSyncReport } from '@collected/shared';
import type { CourseContentRow } from './facts.js';
import type { AgentConfig } from './config.js';
import { assertSecureUrl, isPrivateHost } from './guard.js';

const JSON_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** What the sync needs from the server; `Api` is the real one, tests pass a fake. */
export interface SyncApi {
  getManifest(): Promise<FileSyncManifest>;
  postReport(report: FileSyncReport): Promise<unknown>;
  download(fileId: string, dest: string): Promise<void>;
  /** Every assignment or announcement of a course, done and informational included. */
  getItems(courseId: string, kind: 'assignment' | 'announcement'): Promise<EffectiveItem[]>;
  getCourseContent(courseId: string): Promise<CourseContentRow[]>;
}

/** Talks to collected. Auth is an Access service token (prod) or the helper key (local); see DECISIONS 038. */
export class Api implements SyncApi {
  constructor(private readonly cfg: AgentConfig) {
    assertSecureUrl(cfg.server, 'the server URL in agent.json');
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { Accept: 'application/json' };
    const a = this.cfg.auth;
    if (a.cfAccessClientId && a.cfAccessClientSecret) {
      h['CF-Access-Client-Id'] = a.cfAccessClientId;
      h['CF-Access-Client-Secret'] = a.cfAccessClientSecret;
    }
    if (a.helperKey) h['x-collected-key'] = a.helperKey;
    if (a.token) h.Authorization = `Bearer ${a.token}`;
    return h;
  }

  private url(p: string): string {
    return `${this.cfg.server.replace(/\/$/, '')}${p}`;
  }

  private async json<T>(p: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(this.url(p), { ...init, headers: { ...this.headers(), ...(init.headers as Record<string, string> | undefined) }, redirect: 'manual', signal: AbortSignal.timeout(JSON_TIMEOUT_MS) });
    if (res.status >= 300 && res.status < 400) {
      throw new ApiError(`${p} redirected to ${res.headers.get('location') ?? '?'}: Cloudflare Access did not accept the credentials (service token missing or wrong)`, res.status);
    }
    const text = await res.text();
    if (!res.ok) {
      let msg = text.slice(0, 300);
      try {
        msg = (JSON.parse(text) as { error?: string }).error ?? msg;
      } catch {
        /* keep text */
      }
      throw new ApiError(`${p}: ${res.status} ${msg}`, res.status);
    }
    return JSON.parse(text) as T;
  }

  /** Any GET on collected's API. */
  get<T>(p: string): Promise<T> {
    return this.json<T>(p);
  }

  /** Any write on collected's API with a JSON body. */
  send<T>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', p: string, body?: unknown): Promise<T> {
    return this.json<T>(p, { method, ...(body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  }

  /** Hand the Canvas session cookie to the server; it stores it and runs a Canvas sync. See `connect.ts`. */
  postCanvasCookie(body: { cookieHeader: string; baseUrl?: string }): Promise<{ ok: boolean; outcome: unknown }> {
    return this.send('POST', '/api/sources/canvas/cookie', body);
  }

  getManifest(): Promise<FileSyncManifest> {
    return this.json<FileSyncManifest>('/api/file-sync/manifest');
  }

  getItems(courseId: string, kind: 'assignment' | 'announcement'): Promise<EffectiveItem[]> {
    const q = new URLSearchParams({ kind, course: courseId, includeDone: '1', includeInformational: '1', includeHidden: '1', limit: '1000' });
    return this.json<EffectiveItem[]>(`/api/items?${q}`);
  }

  getCourseContent(courseId: string): Promise<CourseContentRow[]> {
    return this.json<CourseContentRow[]>(`/api/courses/${encodeURIComponent(courseId)}/content`);
  }

  postReport(report: FileSyncReport): Promise<{ ok: true }> {
    return this.json('/api/file-sync/report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(report) });
  }

  /**
   * Downloads one Canvas file to `dest`. The server answers 302 to a one-shot CDN link; we follow it by hand so
   * the auth headers never reach the CDN and the bytes never pass through the box. The link is the server's
   * word, so it must be https to a public host, may not redirect again, and is read up to `maxFileMb`
   * (SECURITY-REVIEW 1.8).
   */
  async download(fileId: string, dest: string): Promise<void> {
    if (!/^\d+$/.test(fileId)) throw new ApiError(`file id "${fileId.slice(0, 40)}" is not a Canvas file id`, 400);
    const first = await fetch(this.url(`/api/canvas/files/${encodeURIComponent(fileId)}/open?download=1`), { headers: this.headers(), redirect: 'manual', signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    const location = first.headers.get('location');
    if (first.status < 300 || first.status >= 400 || !location) {
      const body = await first.text().catch(() => '');
      throw new ApiError(`file ${fileId}: expected a redirect, got ${first.status} ${body.slice(0, 200)}`, first.status);
    }
    let target: URL;
    try {
      target = new URL(location, this.url('/'));
    } catch {
      throw new ApiError(`file ${fileId}: unreadable download location`, first.status);
    }
    if (/(^|\.)cloudflareaccess\.com$/.test(target.hostname)) throw new ApiError(`file ${fileId}: Cloudflare Access login redirect; credentials not accepted`, first.status);
    if (target.protocol !== 'https:') throw new ApiError(`file ${fileId}: download location is not https (${target.protocol})`, first.status);
    if (isPrivateHost(target.hostname)) throw new ApiError(`file ${fileId}: download location points at a private host (${target.hostname})`, first.status);

    const limit = (this.cfg.maxFileMb ?? 100) * 1024 * 1024;
    const res = await fetch(target, { redirect: 'manual', signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (res.status >= 300 && res.status < 400) throw new ApiError(`file ${fileId}: CDN redirected again (${res.status}); not following`, res.status);
    if (!res.ok || !res.body) throw new ApiError(`file ${fileId}: CDN answered ${res.status}`, res.status);
    const declared = Number(res.headers.get('content-length'));
    if (declared > limit) throw new ApiError(`file ${fileId}: ${(declared / 1024 / 1024).toFixed(0)} MB is over this machine's ${this.cfg.maxFileMb ?? 100} MB cap`, 413);

    mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.part`;
    let received = 0;
    const budget = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        received += chunk.length;
        if (received > limit) cb(new ApiError(`file ${fileId}: more than ${(limit / 1024 / 1024).toFixed(0)} MB; stopped`, 413));
        else cb(null, chunk);
      },
    });
    try {
      await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), budget, createWriteStream(tmp));
    } catch (e) {
      rmSync(tmp, { force: true });
      throw e;
    }
    renameSync(tmp, dest);
  }
}
