import path from 'node:path';
import type { SourceId, SourceStatus } from '@collected/shared';
import type { AppContext } from '../context.js';
import { acquireLock, isLocked } from '../lib/sync-lock.js';
import { nowIso } from '../lib/time.js';
import { UndecryptableConfigError, getSourceRow, mergeSourceMeta, setSourceStatus } from '../lib/sources.js';
import { NeedsAuthError, NotConfiguredError, type Ingester, type RunResult } from './types.js';

const running = new Set<SourceId>();

const DEFAULT_TIMEOUT_MS = 120_000;
/** A lock file older than the run's own cap plus a minute belongs to a process that died without releasing it. */
export const lockStaleMs = (timeoutMs: number | undefined): number => (timeoutMs ?? DEFAULT_TIMEOUT_MS) + 60_000;

/** The data directory a file lock can live in: the context's, when it is a real directory (tests run on `:memory:`). */
const lockDir = (dataDir: string): string | null => (path.isAbsolute(dataDir) ? dataDir : null);

/**
 * Whether a run for this source is in flight right now: in this process (the mutex), or, given a data directory, in
 * another process on the same database (the lock file `sync.lock/<source>` the runner holds while it works).
 */
export function isRunning(id: SourceId, opts: { dataDir?: string; timeoutMs?: number } = {}): boolean {
  if (running.has(id)) return true;
  const dir = opts.dataDir ? lockDir(opts.dataDir) : null;
  return !!dir && isLocked(dir, id, lockStaleMs(opts.timeoutMs));
}

/** Post-sync work that depends on more than one source (dedup, the Todoist and Google Tasks pushes). Failures are logged, never propagated. */
async function runAfterHooks(ctx: AppContext, id: SourceId): Promise<void> {
  if (id === 'canvas' || id === 'gradescope') {
    try {
      const { runDedup } = await import('../sync/dedup.js');
      const r = await runDedup(ctx);
      ctx.log.debug({ ...r }, 'dedup done');
    } catch (err) {
      ctx.log.error({ err }, 'dedup failed');
    }
    try {
      const { todoistPushConfigSchema } = await import('@collected/shared');
      const { getSettingParsed } = await import('../lib/settings.js');
      const cfg = await getSettingParsed(ctx, 'todoist.push', todoistPushConfigSchema);
      if (cfg.enabled) {
        const { todoistApiForCtx } = await import('../ingest/todoist/ingest.js');
        const { executePush, planPush } = await import('../sync/todoist-push.js');
        const api = await todoistApiForCtx(ctx);
        const plan = await planPush(ctx, api, cfg);
        if (plan.ops.length) await executePush(ctx, api, plan, cfg);
      }
    } catch (err) {
      if (!(err instanceof NotConfiguredError)) ctx.log.error({ err }, 'todoist push after sync failed');
    }
    try {
      const { gtasksPushConfigSchema } = await import('@collected/shared');
      const { getSettingParsed } = await import('../lib/settings.js');
      const cfg = await getSettingParsed(ctx, 'gtasks.push', gtasksPushConfigSchema);
      if (cfg.enabled) {
        const { gtasksApiForCtx } = await import('../ingest/gtasks/ingest.js');
        const { executeGtasksPush, planGtasksPush } = await import('../sync/gtasks-push.js');
        const api = await gtasksApiForCtx(ctx);
        const plan = await planGtasksPush(ctx, api, cfg);
        if (plan.ops.length) await executeGtasksPush(ctx, api, plan, cfg);
      }
    } catch (err) {
      if (!(err instanceof NotConfiguredError)) ctx.log.error({ err }, 'gtasks push after sync failed');
    }
  }
}

export type RunOutcome =
  | { ok: true; result: RunResult; ms: number }
  | { ok: false; skipped: 'running' | 'disabled' }
  | { ok: false; error: string; status: 'needs_auth' | 'error' | 'disconnected'; ms: number };

/**
 * Runs one ingester with a per-source mutex and timeout, and records the outcome on the sources row.
 * Never throws: every failure becomes a status the UI can show.
 */
export async function runIngester(ctx: AppContext, ing: Ingester, opts: { force?: boolean } = {}): Promise<RunOutcome> {
  const log = ctx.log.child({ source: ing.id });
  if (running.has(ing.id)) {
    log.debug('skipped: previous run still in progress');
    return { ok: false, skipped: 'running' };
  }
  const row = await getSourceRow(ctx, ing.id);
  if (!row.enabled && !opts.force) return { ok: false, skipped: 'disabled' };
  const timeoutMs = ing.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // The file lock is what two processes on one database (the CLI's `ui`, a read that syncs first, the daemon) see of each other.
  const dir = lockDir(ctx.env.DATA_DIR);
  const lock = dir ? acquireLock(dir, ing.id, lockStaleMs(timeoutMs)) : null;
  if (dir && !lock) {
    log.debug('skipped: another process is syncing this source');
    return { ok: false, skipped: 'running' };
  }

  running.add(ing.id);
  const started = Date.now();
  const ac = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  // The signal only cancels fetches that honour it; the race is what guarantees the run is recorded as an error,
  // the after-hooks (dedup, Todoist push) do not act on partial data, and the mutex is released.
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ac.abort(new Error('timeout'));
      reject(new Error(`run exceeded ${Math.round(timeoutMs / 1000)} s`));
    }, timeoutMs);
  });
  await setSourceStatus(ctx, ing.id, row.status as SourceStatus, { lastRunAt: nowIso() });
  try {
    const run = ing.run(ctx, ac.signal);
    run.catch(() => {}); // settled later by the abort; the race already reported it
    const result = await Promise.race([run, timeout]);
    const ms = Date.now() - started;
    await setSourceStatus(ctx, ing.id, 'connected', { lastError: null, lastSuccessAt: nowIso() });
    await mergeSourceMeta(ctx, ing.id, { ...(result.meta ?? {}), lastRun: { at: nowIso(), ms, counts: result.counts ?? {} } });
    log.info({ ms, ...result.counts }, 'sync ok');
    await runAfterHooks(ctx, ing.id);
    return { ok: true, result, ms };
  } catch (err) {
    const ms = Date.now() - started;
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof NotConfiguredError) {
      await setSourceStatus(ctx, ing.id, 'disconnected', { lastError: null });
      log.debug('not configured');
      return { ok: false, error: message, status: 'disconnected', ms };
    }
    if (err instanceof NeedsAuthError || err instanceof UndecryptableConfigError) {
      await setSourceStatus(ctx, ing.id, 'needs_auth', { lastError: message });
      log.warn({ ms, reason: message }, 'needs auth');
      return { ok: false, error: message, status: 'needs_auth', ms };
    }
    await setSourceStatus(ctx, ing.id, 'error', { lastError: message.slice(0, 500) });
    log.error({ err, ms }, 'sync failed');
    return { ok: false, error: message, status: 'error', ms };
  } finally {
    clearTimeout(timer);
    running.delete(ing.id);
    lock?.release();
  }
}
