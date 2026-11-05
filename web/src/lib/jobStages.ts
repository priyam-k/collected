import type { JobStage } from '@collected/shared';

// The stage list's vocabulary lives in shared, next to the server's copy of the same rules.
export { DEFAULT_JOB_STAGES, isClosedStage, isReservedStage, stageIdFrom, stageLabel, type JobStage } from '@collected/shared';

const TONE: Record<string, string> = {
  starred: 'text-caution',
  applied: 'text-ink',
  screen: 'text-brand-ink',
  interviewing: 'text-brand-ink',
  offer: 'text-positive',
};

/** The text tone a stage's count and heading take: the defaults keep theirs, other open stages the accent, closed ones quiet. */
export function stageTone(stages: readonly JobStage[], id: string): string {
  if (stages.find((s) => s.id === id)?.kind === 'closed') return 'text-ter';
  return TONE[id] ?? 'text-brand-ink';
}

/** The file name of a resume path (either slash), for a tag that fits on a card. */
export const baseName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;
