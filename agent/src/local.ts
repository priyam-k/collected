import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Hono } from 'hono';
import type { EffectiveItem, FileSyncManifest, FileSyncReport } from '@collected/shared';
import { createContext, createLogger, type AppContext } from '@collected/core';
import { loadOrCreateKeyFile } from '@collected/core/lib/key-file';
import { clearDemoData, loadDemo, type DemoLoaded, type DemoSource } from '@collected/core/lib/demo';
import { createApp } from '@collected/server/app';
import type { Env } from '@collected/server/env';
import { ApiError, downloadFromCdn, downloadTarget, itemsQuery, readJson, type CollectedApi } from './api.js';
import { localDataDir, type AgentConfig } from './config.js';
import type { CourseContentRow } from './facts.js';

/*
 * Local mode: the whole backend inside this process. The same Hono app the server listens on is built here over a
 * SQLite file in the data directory and asked questions with `app.request` (no socket, no port, no server). Every
 * command goes through the same routes it would over HTTP, so the two modes cannot drift. Identity is `local`, the
 * machine's owner: the server's auth middleware answers it when the config object carries LOCAL_OWNER, which nothing
 * in process.env can set (server/src/env.ts).
 */

/** The version this CLI reports as the app's; agent/package.json sits one level above both src/ and dist/. */
function cliVersion(): string {
  try {
    return (JSON.parse(readFileSync(path.resolve(import.meta.dirname, '..', 'package.json'), 'utf8')) as { version?: string }).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export interface LocalEnvOptions {
  logLevel?: string | undefined;
  /** The address the browser uses for `collected ui`; the same-site check compares a write's Origin against it. */
  publicUrl?: string | undefined;
  /** `collected ui` runs the scheduler; a one-shot command does not. */
  scheduler?: boolean | undefined;
}

/**
 * The server config for a data directory: core's paths absolute, no sign-in, the owner flag on. The update check stays
 * off: the CLI has no commit to compare and is updated through npm, not `docker compose pull`.
 */
export function localEnv(dataDir: string, opts: LocalEnvOptions = {}): Env {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  return {
    NODE_ENV: 'production',
    PORT: 0,
    DATA_DIR: dataDir,
    SECRET_KEY: loadOrCreateKeyFile(dataDir),
    secretKeySource: 'file',
    AUTH_DISABLED: false,
    AUTH_DISABLED_ACKNOWLEDGED: false,
    LOCAL_OWNER: true,
    PUBLIC_URL: opts.publicUrl ?? 'http://localhost',
    SCHEDULER_DISABLED: !opts.scheduler,
    TZ: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone,
    LOG_LEVEL: opts.logLevel ?? 'warn',
    UPSTREAM_REPO: 'priyam-k/collected',
    UPDATE_CHECK_DISABLED: true,
    packageVersion: cliVersion(),
    // MIGRATIONS_DIR and SEED_CONFIG_PATH stay unset: core finds its own drizzle/ (next to the bundle, or in core/),
    // and the database starts empty; `collected demo canvas` or a real Canvas connection fills it.
  };
}

export class LocalApi implements CollectedApi {
  private constructor(
    private readonly app: Hono,
    readonly ctx: AppContext<Env>,
    private readonly cfg: AgentConfig,
  ) {}

  /** Opens (creating and migrating when needed) the database in the config's data directory and builds the app over it. */
  static async open(cfg: AgentConfig, opts: { logLevel?: string } = {}): Promise<LocalApi> {
    const env = localEnv(localDataDir(cfg), opts);
    const log = createLogger(env.LOG_LEVEL, false, { stderr: true });
    const ctx = await createContext(env, { log });
    const { app } = createApp(ctx);
    return new LocalApi(app, ctx, cfg);
  }

  get dataDir(): string {
    return this.ctx.env.DATA_DIR;
  }

  private async json<T>(p: string, init: RequestInit = {}): Promise<T> {
    const res = await this.app.request(p, { ...init, headers: { Accept: 'application/json', ...(init.headers as Record<string, string> | undefined) } });
    return readJson<T>(p, res);
  }

  get<T>(p: string): Promise<T> {
    return this.json<T>(p);
  }

  send<T>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', p: string, body?: unknown): Promise<T> {
    return this.json<T>(p, { method, ...(body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  }

  postCanvasCookie(body: { cookieHeader: string; baseUrl?: string }): Promise<{ ok: boolean; outcome: unknown }> {
    return this.send('POST', '/api/sources/canvas/cookie', body);
  }

  getManifest(): Promise<FileSyncManifest> {
    return this.json<FileSyncManifest>('/api/file-sync/manifest');
  }

  getItems(courseId: string, kind: 'assignment' | 'announcement'): Promise<EffectiveItem[]> {
    return this.json<EffectiveItem[]>(`/api/items?${itemsQuery(courseId, kind)}`);
  }

  getCourseContent(courseId: string): Promise<CourseContentRow[]> {
    return this.json<CourseContentRow[]>(`/api/courses/${encodeURIComponent(courseId)}/content`);
  }

  postReport(report: FileSyncReport): Promise<{ ok: true }> {
    return this.send('POST', '/api/file-sync/report', report);
  }

  /** The first hop is in-process (the route mints the one-shot CDN link and answers 302); the second is the same real fetch as over HTTP. */
  async download(fileId: string, dest: string): Promise<void> {
    if (!/^\d+$/.test(fileId)) throw new ApiError(`file id "${fileId.slice(0, 40)}" is not a Canvas file id`, 400);
    const first = await this.app.request(`/api/canvas/files/${encodeURIComponent(fileId)}/open?download=1`);
    const target = await downloadTarget(fileId, first, 'http://localhost/');
    await downloadFromCdn(fileId, target, dest, this.cfg.maxFileMb);
  }

  /** `collected demo <source>`: the fixture loaders core ships, through the real sync code. */
  demo(source: DemoSource): Promise<DemoLoaded> {
    return loadDemo(this.ctx, source);
  }

  demoClear(): Promise<{ items: number; content: number }> {
    return clearDemoData(this.ctx);
  }
}
