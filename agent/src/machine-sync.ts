import type { Source } from '@collected/shared';
import type { CollectedApi } from './api.js';
import { resync } from './collected.js';
import { isLocal, type AgentConfig } from './config.js';
import { runSync, type SyncSummary } from './sync.js';

/*
 * Bare `collected sync`: everything this machine is responsible for, which is what the daemon runs on its timer.
 * In local mode that is every enabled source (the same `sync all` path a hand-typed `collected sync all` takes: all
 * started together through POST /api/sources/sync and waited for) and then the course files, when any course has the
 * file sync on. Against a server it is the course files alone: the server keeps its own sources fresh. `sync <source|all>`
 * stays the sources-only form, and the file-sync flags apply to the file half here.
 */

export interface MachineSyncOptions {
  /** The file sync plans and changes nothing; the sources are not synced either (a dry run touches nothing). */
  dryRun?: boolean | undefined;
  /** File sync: one course by id or code. */
  course?: string | undefined;
  /** File sync: skip the model even if courses ask for it. */
  noModel?: boolean | undefined;
  log: (line: string) => void;
  api: CollectedApi;
  /** Tests fix the clock the timing line reads. */
  now?: () => number;
}

export interface MachineSyncResult {
  /** The sources' rows after the run; null when that half did not run (client mode, or a dry run). */
  sources: Source[] | null;
  /** The file sync's summary; null when it did not run (no course has it on in local mode). */
  files: SyncSummary | null;
  /** Sources whose run ended in `error`; the file sync's error count. Either non-zero makes the exit code 1. */
  sourceErrors: number;
  fileErrors: number;
}

/** The summary line the file sync has always printed. */
export function describeFileSync(s: SyncSummary, dryRun: boolean | undefined, ms: number): string {
  const parts = [`${s.placed} new`, `${s.updated} updated`, `${s.moved} moved`, `${s.adopted} adopted`, `${s.removed} removed`, `${s.unchanged} unchanged`, `${s.skipped} skipped`];
  if (s.pending) parts.push(`${s.pending} waiting for the model`);
  if (s.classified) parts.push(`${s.classified} classified`);
  return `${dryRun ? 'dry run: ' : ''}${s.courses} course${s.courses === 1 ? '' : 's'}: ${parts.join(', ')}${s.errors.length ? `, ${s.errors.length} error${s.errors.length === 1 ? '' : 's'}` : ''} in ${(ms / 1000).toFixed(1)} s`;
}

export async function machineSync(cfg: AgentConfig, opts: MachineSyncOptions): Promise<MachineSyncResult> {
  const { api, log } = opts;
  const now = opts.now ?? Date.now;
  const result: MachineSyncResult = { sources: null, files: null, sourceErrors: 0, fileErrors: 0 };
  if (isLocal(cfg)) {
    if (opts.dryRun) log('dry run: the sources are not synced (collected sync all does that); the file sync below is a plan');
    else {
      const out = await resync(api, ['all']);
      result.sources = out.json as Source[];
      result.sourceErrors = result.sources.filter((s) => s.status === 'error').length;
      log(out.text);
    }
    const manifest = await api.getManifest();
    if (!manifest.courses.length) {
      log('files: no course has the file sync on (course drawer → Files → Sync to laptop)');
      return result;
    }
  }
  const t0 = now();
  const s = await runSync(cfg, { dryRun: opts.dryRun, course: opts.course, noModel: opts.noModel, log, api });
  result.files = s;
  result.fileErrors = s.errors.length;
  log(describeFileSync(s, opts.dryRun, now() - t0));
  return result;
}
