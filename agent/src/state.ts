import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { agentHome } from './config.js';

/** What this machine has placed. Keyed by `${courseId}/${fileId}`. */
export interface Placement {
  courseId: string;
  fileId: string;
  target: string;
  localPath: string;
  /** sha256 of the bytes when placed: if the file at localPath differs now, the user changed it. */
  sha256: string;
  /** Canvas updated_at the placed bytes correspond to. */
  updatedAt: string | null;
  cachePath: string;
  placedAt: string;
}

export interface AgentState {
  placements: Record<string, Placement>;
  lastRunAt: string | null;
}

export const stateKey = (courseId: string, fileId: string): string => `${courseId}/${fileId}`;
const statePath = (): string => path.join(agentHome(), 'state.json');

export function loadState(): AgentState {
  const file = statePath();
  if (!existsSync(file)) return { placements: {}, lastRunAt: null };
  const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<AgentState>;
  return { placements: raw.placements ?? {}, lastRunAt: raw.lastRunAt ?? null };
}

export function saveState(state: AgentState): void {
  mkdirSync(agentHome(), { recursive: true });
  const file = statePath();
  writeFileSync(`${file}.tmp`, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(`${file}.tmp`, file);
}
