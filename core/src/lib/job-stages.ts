import { DEFAULT_JOB_STAGES, isReservedStage, jobStagesSchema, labelFromStageId, type JobStage } from '@collected/shared';
import type { AppContext } from '../context.js';
import { getSetting, setSetting } from './settings.js';

/*
 * The tracker's stages are data: the `jobs.stages` setting, an ordered list the board draws a column per entry of
 * (DECISIONS 063). This is the one place that reads or writes it. `new`, `starred` and `hidden` are feed markers
 * outside the list and are never added to it.
 */

export const JOB_STAGES_KEY = 'jobs.stages';

/** The stage list, or the defaults when the setting is missing or does not parse (a bad value is logged, not fatal). */
export async function getJobStages(ctx: AppContext): Promise<JobStage[]> {
  const raw = await getSetting(ctx, JOB_STAGES_KEY);
  if (raw === undefined) return [...DEFAULT_JOB_STAGES];
  const parsed = jobStagesSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  ctx.log.warn({ key: JOB_STAGES_KEY, issues: parsed.error.issues }, 'setting failed validation; using defaults');
  return [...DEFAULT_JOB_STAGES];
}

export async function setJobStages(ctx: AppContext, stages: JobStage[]): Promise<void> {
  await setSetting(ctx, JOB_STAGES_KEY, jobStagesSchema.parse(stages));
}

/**
 * Makes sure `state` is a stage the board can show: a reserved marker or a listed id is left alone; anything else is
 * appended as an open stage labelled from its id, so `jobs set <id> oa` works and the board grows a column.
 * Returns the list as it stands afterwards.
 */
export async function ensureStage(ctx: AppContext, state: string): Promise<JobStage[]> {
  const stages = await getJobStages(ctx);
  if (isReservedStage(state) || stages.some((s) => s.id === state)) return stages;
  const next = [...stages, { id: state, label: labelFromStageId(state), kind: 'open' as const }];
  await setJobStages(ctx, next);
  ctx.log.info({ stage: state }, 'job stage added on first use');
  return next;
}
