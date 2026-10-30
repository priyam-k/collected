import { Cron } from 'croner';
import type { ChangelogEntry, SystemVersion, UpdateStatus } from '@collected/shared';
import type { AppContext } from '../context.js';
import { entriesNewerThan, parseChangelog } from './changelog.js';
import { MB, readText, withTimeout } from './http.js';
import { getSetting, setSetting } from './settings.js';
import { MIN_CLIENT_VERSION } from './version.js';

/** Where the last result lives across restarts. Written only by this module; the settings route refuses `system.*`. */
export const UPDATE_SETTING_KEY = 'system.update';
export const UPDATE_STEPS = ['cd /srv/collected (or wherever you cloned it)', 'git pull --ff-only', 'docker compose pull', 'docker compose up -d'];

const BOOT_DELAY_MS = 30_000;
const CRON = '23 */6 * * *';
const FETCH_TIMEOUT_MS = 10_000;
const FETCH_BUDGET = 2 * MB;

/**
 * Paths whose change means the running app would differ after an update. Docs, workflows, the design notes under
 * artifacts/ and the e2e suite do not count: a self-hoster is not asked to pull for a README fix.
 */
const ALLOW_DIRS = ['core/', 'server/', 'web/', 'shared/', 'agent/'];
const ALLOW_FILES = new Set(['Dockerfile', 'docker-compose.yml', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'CHANGELOG.md']);

export function matchesUpdateAllowList(filename: string): boolean {
  const f = filename.replace(/^\.\//, '');
  if (ALLOW_FILES.has(f)) return true;
  return ALLOW_DIRS.some((d) => f.startsWith(d));
}

export function systemVersion(ctx: AppContext): SystemVersion {
  return { version: ctx.version, commit: ctx.build.commit, builtAt: ctx.build.builtAt, repo: ctx.env.UPSTREAM_REPO, minClient: MIN_CLIENT_VERSION };
}

/** What is persisted: everything in UpdateStatus except `current` and `steps`, which come from the running process. */
interface Persisted {
  upstream: UpdateStatus['upstream'];
  changelog: ChangelogEntry[];
  error: string | null;
  checkedAt: string | null;
}

export interface UpdateChecker {
  /** Last known status (from memory, or from the settings table after a restart). Never performs a request. */
  status(): Promise<UpdateStatus>;
  /** Runs a check now; concurrent callers share one run. Never throws: a failure lands in `error`. */
  check(): Promise<UpdateStatus>;
  /** Boot delay, then every six hours. */
  start(): void;
  stop(): void;
}

export interface UpdateCheckerDeps {
  fetch?: typeof fetch;
  now?: () => Date;
}

interface CompareResponse {
  ahead_by?: number;
  status?: string;
  html_url?: string;
  merge_base_commit?: { sha?: string };
  commits?: { sha?: string }[];
  files?: { filename?: string }[];
}

export function createUpdateChecker(ctx: AppContext, deps: UpdateCheckerDeps = {}): UpdateChecker {
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? (() => new Date());
  const repo = ctx.env.UPSTREAM_REPO;
  let loaded: Persisted | null = null;
  let inFlight: Promise<UpdateStatus> | null = null;
  let bootTimer: NodeJS.Timeout | null = null;
  let job: Cron | null = null;

  const toStatus = (p: Persisted): UpdateStatus => ({
    current: systemVersion(ctx),
    upstream: p.upstream,
    changelog: p.changelog,
    steps: UPDATE_STEPS,
    error: ctx.env.UPDATE_CHECK_DISABLED ? 'update check disabled (UPDATE_CHECK_DISABLED=true)' : p.error,
  });

  async function load(): Promise<Persisted> {
    if (loaded) return loaded;
    const raw = await getSetting<Partial<Persisted>>(ctx, UPDATE_SETTING_KEY).catch(() => undefined);
    loaded = {
      upstream: raw?.upstream && typeof raw.upstream === 'object' ? raw.upstream : null,
      changelog: Array.isArray(raw?.changelog) ? raw.changelog : [],
      error: typeof raw?.error === 'string' ? raw.error : null,
      checkedAt: typeof raw?.checkedAt === 'string' ? raw.checkedAt : null,
    };
    return loaded;
  }

  async function save(p: Persisted): Promise<void> {
    loaded = p;
    await setSetting(ctx, UPDATE_SETTING_KEY, p).catch((err) => ctx.log.warn({ err }, 'update check: could not persist result'));
  }

  async function getText(url: string, accept: string): Promise<{ status: number; text: string }> {
    const res = await doFetch(url, {
      headers: {
        accept,
        'user-agent': `collected/${ctx.version} (+https://github.com/${repo})`,
        ...(ctx.env.UPDATE_CHECK_TOKEN ? { authorization: `Bearer ${ctx.env.UPDATE_CHECK_TOKEN}` } : {}),
      },
      redirect: 'error',
      signal: withTimeout(undefined, FETCH_TIMEOUT_MS),
    });
    return { status: res.status, text: await readText(res, FETCH_BUDGET) };
  }

  async function run(): Promise<UpdateStatus> {
    const prev = await load();
    const commit = ctx.build.commit;
    const checkedAt = now().toISOString();
    if (commit === 'dev') {
      return toStatus(await persisted(prev, { upstream: null, error: 'running a development build with no commit to compare; the check needs an image built from a git commit', checkedAt }));
    }
    let compare: CompareResponse;
    try {
      const r = await getText(`https://api.github.com/repos/${repo}/compare/${encodeURIComponent(commit)}...main`, 'application/vnd.github+json');
      if (r.status === 404) {
        return toStatus(await persisted(prev, { upstream: null, error: `commit ${commit} is not on github.com/${repo}, or the repository is private (set UPDATE_CHECK_TOKEN); this build may have local commits or a different upstream (UPSTREAM_REPO)`, checkedAt }));
      }
      if (r.status !== 200) throw new Error(`GitHub compare answered ${r.status}${r.status === 403 ? ' (rate limited?)' : ''}`);
      compare = JSON.parse(r.text) as CompareResponse;
      if (typeof compare.ahead_by !== 'number') throw new Error('GitHub compare answered without ahead_by');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.log.warn({ err, repo, commit }, 'update check failed');
      // Keep the last good upstream: a flaky network must not clear a banner that was right an hour ago.
      return toStatus(await persisted(prev, { error: `update check failed: ${message}`, checkedAt }));
    }

    const files = (compare.files ?? []).map((f) => f.filename ?? '');
    const headSha = compare.commits?.at(-1)?.sha ?? compare.merge_base_commit?.sha ?? commit;
    const ahead = compare.ahead_by ?? 0;

    // The changelog and upstream version are informative, not load-bearing: a failure there keeps the compare result
    // and reuses what the last successful check stored.
    let version: string | null = prev.upstream?.version ?? null;
    let changelog = prev.changelog;
    try {
      const pkg = await getText(`https://api.github.com/repos/${repo}/contents/package.json?ref=main`, 'application/vnd.github.raw+json');
      if (pkg.status === 200) {
        const v = (JSON.parse(pkg.text) as { version?: unknown }).version;
        version = typeof v === 'string' ? v : null;
      }
      const log = await getText(`https://api.github.com/repos/${repo}/contents/CHANGELOG.md?ref=main`, 'application/vnd.github.raw+json');
      if (log.status === 200) changelog = entriesNewerThan(parseChangelog(log.text), ctx.version);
      else if (log.status === 404) changelog = [];
    } catch (err) {
      ctx.log.warn({ err, repo }, 'update check: changelog fetch failed; keeping the last one');
    }

    return toStatus(
      await persisted(prev, {
        upstream: {
          commit: headSha.slice(0, 7),
          version,
          ahead,
          matters: ahead > 0 && files.some(matchesUpdateAllowList),
          checkedAt,
          url: compare.html_url ?? `https://github.com/${repo}/compare/${commit}...main`,
        },
        changelog,
        error: null,
        checkedAt,
      }),
    );
  }

  async function persisted(prev: Persisted, patch: Partial<Persisted>): Promise<Persisted> {
    const next: Persisted = { ...prev, ...patch };
    await save(next);
    return next;
  }

  const checker: UpdateChecker = {
    async status() {
      return toStatus(await load());
    },
    check() {
      if (ctx.env.UPDATE_CHECK_DISABLED) return this.status();
      if (!inFlight) {
        inFlight = run()
          .catch(async (err) => {
            // run() handles its own failures; this is the belt for a bug in it, so the scheduler never sees a rejection.
            ctx.log.error({ err }, 'update check threw');
            return toStatus(await persisted(await load(), { error: 'update check failed unexpectedly', checkedAt: now().toISOString() }));
          })
          .finally(() => {
            inFlight = null;
          });
      }
      return inFlight;
    },
    start() {
      if (job || bootTimer) return;
      bootTimer = setTimeout(() => {
        bootTimer = null;
        void checker.check();
      }, BOOT_DELAY_MS);
      bootTimer.unref?.();
      job = new Cron(CRON, { protect: true, catch: (e) => ctx.log.error({ err: e }, 'update check job threw') }, async () => {
        await checker.check();
      });
      ctx.log.info({ repo, commit: ctx.build.commit, pattern: CRON, next: job.nextRun()?.toISOString() }, 'update check scheduled');
    },
    stop() {
      if (bootTimer) clearTimeout(bootTimer);
      bootTimer = null;
      job?.stop();
      job = null;
    },
  };
  return checker;
}
