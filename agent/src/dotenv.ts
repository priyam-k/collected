import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { agentHome } from './config.js';

/*
 * `~/.collected/.env`: the operator's overrides for local mode, read into a plain object and never into process.env
 * (the in-process server reads its config from the object the CLI builds, DECISIONS 053; nothing in this process
 * should start seeing a GOOGLE_CLIENT_SECRET through the environment). Same syntax as a server `.env`
 * (`util.parseEnv`, what `process.loadEnvFile` uses): KEY=value, quotes, `#` comments, `export` prefixes.
 */

export const localDotenvPath = (): string => path.join(agentHome(), '.env');

/** The only keys local mode takes from the file; everything else is ignored, with a note under --verbose. */
export const LOCAL_DOTENV_KEYS = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'TODOIST_CLIENT_ID', 'TODOIST_CLIENT_SECRET', 'TZ', 'LOG_LEVEL', 'UPSTREAM_REPO'] as const;
export type LocalDotenvKey = (typeof LOCAL_DOTENV_KEYS)[number];
export type LocalDotenv = Partial<Record<LocalDotenvKey, string>>;

export interface LocalDotenvRead {
  /** The honoured keys with non-empty values; an empty `KEY=` reads as unset. */
  values: LocalDotenv;
  /** Keys present in the file that local mode does not use, sorted. */
  ignored: string[];
  /** The file exists and was read. */
  found: boolean;
  /** The file is readable by group or others (mode bits; always false on Windows, where they mean nothing). */
  exposed: boolean;
  /** The mode as `0o644`-style text, for the warning. */
  mode: string | null;
}

/** Parses a dotenv file the way Node's loader would, into a result that names what was kept and what was not. */
export function readLocalDotenv(file: string): LocalDotenvRead {
  let text: string;
  let mode: number | null = null;
  try {
    text = readFileSync(file, 'utf8');
    mode = statSync(file).mode & 0o777;
  } catch {
    return { values: {}, ignored: [], found: false, exposed: false, mode: null };
  }
  const parsed = parseEnv(text) as Record<string, string>;
  const values: LocalDotenv = {};
  const ignored: string[] = [];
  for (const [key, raw] of Object.entries(parsed)) {
    if ((LOCAL_DOTENV_KEYS as readonly string[]).includes(key)) {
      const v = raw.trim();
      if (v) values[key as LocalDotenvKey] = v;
    } else ignored.push(key);
  }
  const exposed = process.platform !== 'win32' && mode !== null && (mode & 0o077) !== 0;
  ignored.sort();
  return { values, ignored, found: true, exposed, mode: mode === null ? null : `0${mode.toString(8)}` };
}
