import type { SourceId } from '@collected/shared';
import type { AppContext } from '../context.js';

/** Thrown by an ingester when the source rejected our credentials/session. Sets status=needs_auth. */
export class NeedsAuthError extends Error {
  constructor(message = 'source needs re-authentication') {
    super(message);
    this.name = 'NeedsAuthError';
  }
}

/** Thrown when the source is not configured at all. Sets status=disconnected without logging an error. */
export class NotConfiguredError extends Error {
  constructor(message = 'source is not configured') {
    super(message);
    this.name = 'NotConfiguredError';
  }
}

export interface RunResult {
  /** Free-form counters for the log and the sources widget, e.g. { upserted: 12, deleted: 1 }. */
  counts?: Record<string, number>;
  /** Extra non-secret state to merge into sources.meta (e.g. last cursor, calendar list). */
  meta?: Record<string, unknown>;
}

export interface Ingester {
  id: SourceId;
  /** Scheduler interval. */
  intervalMinutes: number;
  /** Hard cap per run. */
  timeoutMs?: number;
  run(ctx: AppContext, signal: AbortSignal): Promise<RunResult>;
}
