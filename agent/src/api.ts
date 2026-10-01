import { createWriteStream, mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { FileSyncManifest, FileSyncReport } from '@collected/shared';
import type { AgentConfig } from './config.js';

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
}

/** Talks to collected. Auth is an Access service token (prod) or the helper key (local); see DECISIONS 038. */
export class Api implements SyncApi {
  constructor(private readonly cfg: AgentConfig) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = { Accept: 'application/json' };
    const a = this.cfg.auth;
    if (a.cfAccessClientId && a.cfAccessClientSecret) {
      h['CF-Access-Client-Id'] = a.cfAccessClientId;
      h['CF-Access-Client-Secret'] = a.cfAccessClientSecret;
    }
    if (a.helperKey) h['x-collected-key'] = a.helperKey;
    return h;
  }

  private url(p: string): string {
    return `${this.cfg.server.replace(/\/$/, '')}${p}`;
  }

  private async json<T>(p: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(this.url(p), { ...init, headers: { ...this.headers(), ...(init.headers as Record<string, string> | undefined) }, redirect: 'manual' });
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

  getManifest(): Promise<FileSyncManifest> {
    return this.json<FileSyncManifest>('/api/file-sync/manifest');
  }

  postReport(report: FileSyncReport): Promise<{ ok: true }> {
    return this.json('/api/file-sync/report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(report) });
  }

  /**
   * Downloads one Canvas file to `dest`. The server answers 302 to a one-shot CDN link; we follow it by hand so
   * the auth headers never reach the CDN and the bytes never pass through the box.
   */
  async download(fileId: string, dest: string): Promise<void> {
    const first = await fetch(this.url(`/api/canvas/files/${fileId}/open?download=1`), { headers: this.headers(), redirect: 'manual' });
    const location = first.headers.get('location');
    if (first.status < 300 || first.status >= 400 || !location) {
      const body = await first.text().catch(() => '');
      throw new ApiError(`file ${fileId}: expected a redirect, got ${first.status} ${body.slice(0, 200)}`, first.status);
    }
    if (/cloudflareaccess\.com/.test(location)) throw new ApiError(`file ${fileId}: Cloudflare Access login redirect; credentials not accepted`, first.status);
    const res = await fetch(location, { redirect: 'follow' });
    if (!res.ok || !res.body) throw new ApiError(`file ${fileId}: CDN answered ${res.status}`, res.status);
    mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.part`;
    await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), createWriteStream(tmp));
    renameSync(tmp, dest);
  }
}
