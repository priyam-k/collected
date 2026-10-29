import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LOCAL_DOTENV_KEYS, readLocalDotenv } from './dotenv.js';

describe('local dotenv', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'collected-dotenv-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const write = (text: string, mode = 0o600) => {
    const f = path.join(dir, '.env');
    writeFileSync(f, text, { mode });
    chmodSync(f, mode);
    return f;
  };

  it('keeps the honoured keys, names the rest as ignored, and parses like Node', () => {
    const r = readLocalDotenv(
      write(`# comment
GOOGLE_CLIENT_ID=abc.apps.googleusercontent.com
export GOOGLE_CLIENT_SECRET="GOCSPX-with spaces"
TODOIST_CLIENT_ID='single'
TZ=America/New_York
LOG_LEVEL=debug
UPSTREAM_REPO=someone/collected
PORT=3000
SECRET_KEY=deadbeef
EMPTY_ONE=
TODOIST_CLIENT_SECRET=
`),
    );
    expect(r.found).toBe(true);
    expect(r.values).toEqual({
      GOOGLE_CLIENT_ID: 'abc.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'GOCSPX-with spaces',
      TODOIST_CLIENT_ID: 'single',
      TZ: 'America/New_York',
      LOG_LEVEL: 'debug',
      UPSTREAM_REPO: 'someone/collected',
    });
    // An empty honoured key is unset, not ''; a stray server key is ignored by name.
    expect(r.values).not.toHaveProperty('TODOIST_CLIENT_SECRET');
    expect(r.ignored).toEqual(['EMPTY_ONE', 'PORT', 'SECRET_KEY']);
    expect(r.exposed).toBe(false);
    expect(r.mode).toBe('0600');
  });

  it('a missing file is empty and nothing to warn about', () => {
    expect(readLocalDotenv(path.join(dir, 'nope'))).toEqual({ values: {}, ignored: [], found: false, exposed: false, mode: null });
  });

  it.skipIf(process.platform === 'win32')('notices a file other users can read but still reads it', () => {
    const r = readLocalDotenv(write('TZ=UTC\n', 0o644));
    expect(r.exposed).toBe(true);
    expect(r.mode).toBe('0644');
    expect(r.values).toEqual({ TZ: 'UTC' });
    expect(readLocalDotenv(write('TZ=UTC\n', 0o640)).exposed).toBe(true);
    expect(readLocalDotenv(write('TZ=UTC\n', 0o600)).exposed).toBe(false);
  });

  it('honours exactly the documented keys', () => {
    expect([...LOCAL_DOTENV_KEYS]).toEqual(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'TODOIST_CLIENT_ID', 'TODOIST_CLIENT_SECRET', 'TZ', 'LOG_LEVEL', 'UPSTREAM_REPO']);
  });
});
