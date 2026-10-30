import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The version of this CLI, from agent/package.json, which sits one level above both `src/` (tsx) and `dist/` (the
 * bundle). It is what `collected --version` prints, what local mode reports as the app's version, and what the skew
 * check compares with the server's (skew.ts).
 */
export function cliVersion(): string {
  try {
    return (JSON.parse(readFileSync(path.resolve(import.meta.dirname, '..', 'package.json'), 'utf8')) as { version?: string }).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}
