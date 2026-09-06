import type { AppContext } from './context.js';

export interface Scheduler {
  stop(): void;
}

/** Filled in at M2 with croner jobs per enabled source. */
export function startScheduler(ctx: AppContext): Scheduler {
  ctx.log.info('scheduler started (no ingesters registered yet)');
  return { stop() {} };
}
