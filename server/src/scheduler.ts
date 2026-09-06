import { Cron } from 'croner';
import type { AppContext } from './context.js';
import { ingesters } from './ingest/registry.js';
import { runIngester } from './ingest/runner.js';

export interface Scheduler {
  stop(): void;
}

/**
 * One croner job per ingester. Each fires every `intervalMinutes` with a small per-source offset so runs
 * don't all start together. The runner's mutex prevents overlap if a run outlives its interval.
 */
export function startScheduler(ctx: AppContext): Scheduler {
  const jobs: Cron[] = [];
  ingesters.forEach((ing, idx) => {
    const offset = (idx * 7) % Math.max(1, Math.min(ing.intervalMinutes, 59));
    const pattern = ing.intervalMinutes >= 60 ? `${offset} */${Math.round(ing.intervalMinutes / 60)} * * *` : `${offset}-59/${ing.intervalMinutes} * * * *`;
    const job = new Cron(pattern, { protect: true, catch: (e) => ctx.log.error({ err: e, source: ing.id }, 'scheduled run threw') }, async () => {
      await runIngester(ctx, ing);
    });
    jobs.push(job);
    ctx.log.info({ source: ing.id, pattern, next: job.nextRun()?.toISOString() }, 'scheduled');
  });
  // Kick off an initial pass shortly after boot so a fresh deploy isn't empty for an hour.
  const boot = setTimeout(() => {
    for (const ing of ingesters) void runIngester(ctx, ing);
  }, 5_000);
  return {
    stop() {
      clearTimeout(boot);
      for (const j of jobs) j.stop();
    },
  };
}
