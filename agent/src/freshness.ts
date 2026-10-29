import type { IngestedSourceId, Source } from '@collected/shared';
import type { CollectedApi } from './api.js';
import type { RunOutcome } from '@collected/core/ingest/runner';

/*
 * Local mode has no server keeping the data fresh between commands; a read decides for itself whether to sync first.
 * The decision is this file and nothing else: which sources a command depends on, which of those are connected and
 * older than the configured age, and the two flags. The caller runs the syncs it is handed and answers either way.
 */

/** The sources a read command's answer is built from. A command not listed here reads nothing that syncs. */
const DASHBOARD: IngestedSourceId[] = ['canvas', 'canvas_ical', 'gradescope', 'gcal', 'gcal_ical', 'todoist', 'gtasks'];
export const READ_SOURCES: Record<string, IngestedSourceId[]> = {
  agenda: DASHBOARD,
  todo: DASHBOARD,
  assignments: DASHBOARD,
  dates: DASHBOARD,
  grades: DASHBOARD,
  announcements: DASHBOARD,
  course: DASHBOARD,
  jobs: ['jobs'],
};

export type SourceFreshness = Pick<Source, 'id' | 'enabled' | 'status' | 'lastSuccessAt' | 'running'>;

export interface FreshnessFlags {
  /** `--fresh`: sync every relevant connected source first, whatever its age. */
  fresh?: boolean;
  /** `--stale-ok`: never sync; answer from what is there. */
  staleOk?: boolean;
}

/** `--fresh` / `--stale-ok` taken out of an argv; the rest is the command's. */
export function takeFreshnessFlags(argv: string[]): { flags: FreshnessFlags; rest: string[] } {
  const flags: FreshnessFlags = {};
  const rest = argv.filter((a) => {
    if (a === '--fresh') flags.fresh = true;
    else if (a === '--stale-ok') flags.staleOk = true;
    else return true;
    return false;
  });
  return { flags, rest };
}

/**
 * Which sources to sync before answering `cmd`: the command's connected, enabled, idle sources whose last success is
 * missing or older than `maxAgeMinutes` (all of them with `--fresh`, none with `--stale-ok`). A source that is not
 * `connected` has nothing a sync would improve: it needs a credential, or it failed last time and the scheduler is
 * the one to retry it. One already running (here or in another process) is left to finish.
 */
export function sourcesToSync(cmd: string, rows: SourceFreshness[], now: Date, maxAgeMinutes: number, flags: FreshnessFlags = {}): IngestedSourceId[] {
  if (flags.staleOk) return [];
  const relevant = READ_SOURCES[cmd];
  if (!relevant) return [];
  const cutoff = now.getTime() - maxAgeMinutes * 60_000;
  return rows
    .filter((r) => relevant.includes(r.id) && r.enabled && r.status === 'connected' && !r.running)
    .filter((r) => flags.fresh || !r.lastSuccessAt || Date.parse(r.lastSuccessAt) < cutoff)
    .map((r) => r.id);
}

/**
 * Local mode, before a read: one `GET /api/sources` (one SQL read), then the syncs the decision names, run together
 * and waited for. A sync that fails, or one skipped because another process holds it, never blocks the answer: one
 * line on stderr through `warn`, and the command reads what is there. Nothing here throws.
 */
export async function ensureFresh(api: CollectedApi, cmd: string, opts: { now?: Date; maxAgeMinutes: number; flags: FreshnessFlags; warn: (line: string) => void }): Promise<IngestedSourceId[]> {
  if (!READ_SOURCES[cmd] || opts.flags.staleOk) return [];
  let rows: SourceFreshness[];
  try {
    rows = await api.get<Source[]>('/api/sources');
  } catch (e) {
    opts.warn(`could not check source freshness (${(e as Error).message}); answering with what is there`);
    return [];
  }
  const ids = sourcesToSync(cmd, rows, opts.now ?? new Date(), opts.maxAgeMinutes, opts.flags);
  if (!ids.length) return [];
  const results = await Promise.allSettled(ids.map((id) => api.send<{ outcome: RunOutcome }>('POST', `/api/sources/${encodeURIComponent(id)}/sync`)));
  const problems: string[] = [];
  results.forEach((r, i) => {
    const id = ids[i]!;
    if (r.status === 'rejected') problems.push(`${id}: ${(r.reason as Error).message}`);
    else if (!r.value.outcome.ok && 'error' in r.value.outcome) problems.push(`${id}: ${r.value.outcome.error}`);
  });
  if (problems.length) opts.warn(`sync before answering failed for ${problems.join('; ')}. Answering with what is there.`);
  return ids;
}
