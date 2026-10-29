import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

export const KEY_FILE = '.secret_key';
const HEX_KEY = /^[0-9a-fA-F]{64}$/;

/**
 * The encryption key kept in `<dataDir>/.secret_key` when the caller has no SECRET_KEY of its own (the server with the
 * variable empty, the CLI in local mode). Losing the key means every stored credential must be re-entered, so it lives
 * beside the database it encrypts (and inside the Docker volume). Created 0600 on first use.
 */
export function loadOrCreateKeyFile(dataDir: string): string {
  const file = path.join(dataDir, KEY_FILE);
  try {
    const existing = readFileSync(file, 'utf8').trim();
    if (HEX_KEY.test(existing)) return existing;
  } catch {
    // create below
  }
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const key = randomBytes(32).toString('hex');
  writeFileSync(file, `${key}\n`, { mode: 0o600 });
  return key;
}
