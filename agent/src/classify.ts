import { FILE_SYNC_SKIP, type FileSyncConfig, type FileSyncFile } from '@collected/shared';
import type { ModelConfig } from './config.js';

export interface ModelAnswer {
  target: string;
  confidence: number | null;
  probabilities: Record<string, number> | null;
}

export const DEFAULT_MODEL_BASE_URL = 'https://api.typesafe.ai';
export const DEFAULT_MODEL = 'jev-latest';

/**
 * A System 1 decision model over HTTP: TypeSafe's hosted Jev by default (`POST /v1/systemone`, bearer key), or
 * anything speaking the same shape, such as a local `laya-serve` (DECISIONS 039). One call per file, a few hundred
 * input tokens each, so a semester of course files costs well under a cent.
 */

/** What the model reads about a file. Nulls are dropped: the API wants content, not placeholders. */
export const subjectFor = (f: FileSyncFile): Record<string, string> => {
  const s: Record<string, string> = { title: f.title, filename: f.filename };
  if (f.folderPath) s.folder = f.folderPath;
  if (f.moduleName) s.module = f.moduleName;
  if (f.contentType) s.type = f.contentType;
  if (f.linkedFrom) s.linked_from = f.linkedFrom.kind === 'syllabus' ? 'the syllabus page' : `${f.linkedFrom.kind}: ${f.linkedFrom.title}`;
  return s;
};

export const criteriaFor = (cfg: FileSyncConfig): Record<string, string> => ({
  ...Object.fromEntries(cfg.targets.map((t) => [t.name, t.description || t.name])),
  [FILE_SYNC_SKIP]: cfg.skipHint || 'not worth keeping',
});

const apiKeyOf = (m: ModelConfig): string | undefined => m.apiKey || process.env.TYPESAFE_API_KEY || undefined;

/** Why the model can't be called right now, or null when it can. */
export function modelUnavailable(m: ModelConfig): string | null {
  if (!m.enabled) return 'the model is turned off in agent.json';
  const base = m.baseUrl ?? DEFAULT_MODEL_BASE_URL;
  if (/typesafe\.ai/.test(base) && !apiKeyOf(m)) return 'no TypeSafe API key (collected-agent auth model <key>)';
  return null;
}

interface SystemOneAnswer {
  choice?: string;
  probabilities?: Record<string, number>;
  confidence?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One decision: which target (or skip) this course file belongs to, with the model's confidence in that pick. */
export async function classify(m: ModelConfig, cfg: FileSyncConfig, file: FileSyncFile, fetchImpl: typeof fetch = fetch): Promise<ModelAnswer> {
  const base = (m.baseUrl ?? DEFAULT_MODEL_BASE_URL).replace(/\/$/, '');
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' };
  const key = apiKeyOf(m);
  if (key) headers.authorization = `Bearer ${key}`;
  const body = JSON.stringify({
    model: m.model ?? DEFAULT_MODEL,
    state: subjectFor(file),
    questions: {
      target: {
        type: 'choice',
        instructions: 'This is a file posted to a university course page. Which local folder should it be saved to, or should it be skipped?',
        criteria: criteriaFor(cfg),
      },
    },
  });

  let res = await fetchImpl(`${base}/v1/systemone`, { method: 'POST', headers, body });
  if (res.status === 429 || res.status === 529) {
    const wait = Math.min(10_000, Number(res.headers.get('retry-after') ?? 2) * 1000 || 2000);
    await sleep(wait);
    res = await fetchImpl(`${base}/v1/systemone`, { method: 'POST', headers, body });
  }
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 200);
    throw new Error(`model API ${res.status}${res.status === 401 || res.status === 403 ? ' (check the API key)' : ''}: ${text}`);
  }
  const data = (await res.json()) as { answers?: Record<string, SystemOneAnswer> };
  const a = data.answers?.target;
  if (!a?.choice) throw new Error('model returned no choice');
  const probabilities = a.probabilities ?? null;
  const confidence = a.confidence ?? (probabilities ? (probabilities[a.choice] ?? null) : null);
  return { target: a.choice, confidence, probabilities };
}
