import { mkdirSync } from 'node:fs';
import type { Hono } from 'hono';
import type { EffectiveItem, FileSyncManifest, FileSyncReport } from '@collected/shared';
import { createContext, createLogger, type AppContext } from '@collected/core';
import { loadOrCreateKeyFile } from '@collected/core/lib/key-file';
import { clearDemoData, loadDemo, type DemoLoaded, type DemoSource } from '@collected/core/lib/demo';
import { createApp } from '@collected/server/app';
import type { Env } from '@collected/server/env';
import { ApiError, downloadFromCdn, downloadTarget, itemsQuery, readJson, type CollectedApi } from './api.js';
import { localDataDir, type AgentConfig } from './config.js';
import { localDotenvPath, readLocalDotenv, type LocalDotenv } from './dotenv.js';
import type { CourseContentRow } from './facts.js';
import { BUILTIN_GOOGLE_CLIENT } from './google-client.js';
import { shippedMigrations, shippedSeedConfig } from './paths.js';
import { cliVersion } from './version.js';

/*
 * Local mode: the whole backend inside this process. The same Hono app the server listens on is built here over a
 * SQLite file in the data directory and asked questions with `app.request` (no socket, no port, no server). Every
 * command goes through the same routes it would over HTTP, so the two modes cannot drift. Identity is `local`, the
 * machine's owner: the server's auth middleware answers it when the config object carries LOCAL_OWNER, which nothing
 * in process.env can set (server/src/env.ts).
 */

export interface LocalEnvOptions {
  /** The command's own choice (`--verbose`, a test's `silent`); unset, the dotenv's LOG_LEVEL, then `warn`. */
  logLevel?: string | undefined;
  /** The address the browser uses for `collected ui`; the same-site check compares a write's Origin against it. */
  publicUrl?: string | undefined;
  /** `collected ui` runs the scheduler; a one-shot command does not. */
  scheduler?: boolean | undefined;
  /** Mentions the dotenv keys that were ignored. */
  verbose?: boolean | undefined;
  /** Where notes about the dotenv go; stderr by default. */
  warn?: ((line: string) => void) | undefined;
  /** The dotenv file; `<agent home>/.env` by default. Tests point it elsewhere. */
  dotenvPath?: string | undefined;
}

export type GoogleClientChoice = { id: string; secret: string; from: 'dotenv' | 'builtin' } | { id: undefined; secret: undefined; from: 'none' };

/**
 * Which Google client local mode runs with: the dotenv's when it names an id (its secret too, or none at all: a
 * half-set override is a mistake to surface, not something to paper over with the built-in pair), else the built-in
 * desktop client when the build has one, else nothing and Google connect fails softly.
 */
export function chooseGoogleClient(dotenv: LocalDotenv, builtin: { id: string; secret: string } = BUILTIN_GOOGLE_CLIENT): GoogleClientChoice {
  if (dotenv.GOOGLE_CLIENT_ID) return { id: dotenv.GOOGLE_CLIENT_ID, secret: dotenv.GOOGLE_CLIENT_SECRET ?? '', from: 'dotenv' };
  if (builtin.id && builtin.secret) return { id: builtin.id, secret: builtin.secret, from: 'builtin' };
  return { id: undefined, secret: undefined, from: 'none' };
}

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/**
 * The server config for a data directory: core's paths absolute, no sign-in, the owner flag on, and the operator's
 * overrides from `~/.collected/.env` (dotenv.ts) on top of the built-in Google client. The update check stays off:
 * the CLI has no commit to compare and is updated through npm, not `docker compose pull`. Nothing from the dotenv
 * is logged; the notes name keys only.
 */
export function localEnv(dataDir: string, opts: LocalEnvOptions = {}): Env {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const warn = opts.warn ?? ((line: string) => console.error(line));
  const dotenvPath = opts.dotenvPath ?? localDotenvPath();
  const dotenv = readLocalDotenv(dotenvPath);
  if (dotenv.exposed) warn(`${dotenvPath} is readable by other users (mode ${dotenv.mode}); chmod 600 it`);
  if (opts.verbose && dotenv.ignored.length) warn(`${dotenvPath}: ignoring ${dotenv.ignored.join(', ')} (local mode reads only GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, TODOIST_CLIENT_ID, TODOIST_CLIENT_SECRET, TZ, LOG_LEVEL, UPSTREAM_REPO)`);
  const google = chooseGoogleClient(dotenv.values);
  if (google.from === 'dotenv' && !google.secret) warn(`${dotenvPath}: GOOGLE_CLIENT_ID is set but GOOGLE_CLIENT_SECRET is not; Google connect stays off until both are`);
  if (dotenv.values.TODOIST_CLIENT_ID && !dotenv.values.TODOIST_CLIENT_SECRET) warn(`${dotenvPath}: TODOIST_CLIENT_ID is set but TODOIST_CLIENT_SECRET is not; Sign in with Todoist stays off until both are`);
  let upstream = 'priyam-k/collected';
  if (dotenv.values.UPSTREAM_REPO) {
    if (REPO_RE.test(dotenv.values.UPSTREAM_REPO)) upstream = dotenv.values.UPSTREAM_REPO;
    else warn(`${dotenvPath}: UPSTREAM_REPO must be "owner/name"; ignoring it`);
  }
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
    TZ: dotenv.values.TZ || process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone,
    LOG_LEVEL: opts.logLevel ?? dotenv.values.LOG_LEVEL ?? 'warn',
    // Undefined, not '', when there is no client: the server's "configured" checks are truthiness checks.
    GOOGLE_CLIENT_ID: google.id || undefined,
    GOOGLE_CLIENT_SECRET: google.secret || undefined,
    TODOIST_CLIENT_ID: dotenv.values.TODOIST_CLIENT_ID,
    TODOIST_CLIENT_SECRET: dotenv.values.TODOIST_CLIENT_SECRET,
    UPSTREAM_REPO: upstream,
    UPDATE_CHECK_DISABLED: true,
    packageVersion: cliVersion(),
    // Explicit paths, so core never has to look for them: the package's own copies next to the bundle, or the repo's
    // (paths.ts). The seed has no courses, only the jobs feed and the to-do defaults; `collected demo canvas` or a
    // real Canvas connection brings the courses.
    MIGRATIONS_DIR: shippedMigrations(),
    SEED_CONFIG_PATH: shippedSeedConfig(),
  };
}

export class LocalApi implements CollectedApi {
  private constructor(
    private readonly app: Hono,
    readonly ctx: AppContext<Env>,
    private readonly cfg: AgentConfig,
  ) {}

  /** Opens (creating and migrating when needed) the database in the config's data directory and builds the app over it. */
  static async open(cfg: AgentConfig, opts: { logLevel?: string; verbose?: boolean } = {}): Promise<LocalApi> {
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
