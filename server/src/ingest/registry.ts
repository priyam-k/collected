import type { SourceId } from '@collected/shared';
import { jobsIngester } from './jobs/ingest.js';
import type { Ingester } from './types.js';

/** Ingesters register here as their milestones land. Order = display order. */
export const ingesters: Ingester[] = [jobsIngester];

export function getIngester(id: string): Ingester | undefined {
  return ingesters.find((i) => i.id === (id as SourceId));
}
