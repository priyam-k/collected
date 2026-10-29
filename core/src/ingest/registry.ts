import type { SourceId } from '@collected/shared';
import { canvasIcalIngester } from './canvas/ical.js';
import { canvasIngester } from './canvas/ingest.js';
import { gcalIcalIngester } from './gcal/ical.js';
import { gcalIngester } from './gcal/ingest.js';
import { gtasksIngester } from './gtasks/ingest.js';
import { gradescopeIngester } from './gradescope/ingest.js';
import { jobsIngester } from './jobs/ingest.js';
import { todoistIngester } from './todoist/ingest.js';
import type { Ingester } from './types.js';

/** Ingesters register here as their milestones land. Order = display order. */
export const ingesters: Ingester[] = [canvasIngester, canvasIcalIngester, gradescopeIngester, gcalIngester, gcalIcalIngester, todoistIngester, gtasksIngester, jobsIngester];

export function getIngester(id: string): Ingester | undefined {
  return ingesters.find((i) => i.id === (id as SourceId));
}
