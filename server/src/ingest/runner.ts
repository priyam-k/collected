import type { SourceId, SourceStatus } from '@collected/shared';
import type { AppContext } from '../context.js';
import { nowIso } from '../lib/time.js';
import { UndecryptableConfigError, getSourceRow, mergeSourceMeta, setSourceStatus } from '../lib/sources.js';
import { NeedsAuthError, NotConfiguredError, type Ingester, type RunResult } from './types.js';

const running = new Set<SourceId>();

/** Whether a run for this source is in flight right now (in this process). */
export function isRunning(id: SourceId): boolean {
  return running.has(id);
}

/** Post-sync work that depends on more than one source (dedup, push sync). Failures are logged, never propagated. */
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

  running.add(ing.id);
  const started = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error('timeout')), ing.timeoutMs ?? 120_000);
  await setSourceStatus(ctx, ing.id, row.status as SourceStatus, { lastRunAt: nowIso() });
  try {
    const result = await ing.run(ctx, ac.signal);
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
  }
}
