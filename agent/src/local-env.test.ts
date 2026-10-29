import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BUILTIN_GOOGLE_CLIENT } from './google-client.js';
import { chooseGoogleClient, localEnv } from './local.js';

/* What local mode runs with: the dotenv over the built-in Google client over nothing, and the notes it leaves. */
describe('localEnv and the dotenv', () => {
  let dir: string;
  let notes: string[];
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'collected-localenv-'));
    notes = [];
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const dotenv = (text: string, mode = 0o600) => {
    const f = path.join(dir, '.env');
    writeFileSync(f, text, { mode });
    chmodSync(f, mode);
    return f;
  };
  const env = (text: string | null, opts: { verbose?: boolean; logLevel?: string } = {}) =>
    localEnv(path.join(dir, 'data'), { dotenvPath: text === null ? path.join(dir, 'absent') : dotenv(text), warn: (l) => notes.push(l), ...opts });

  it('chooses the dotenv pair, then the built-in pair, then nothing', () => {
    const builtin = { id: 'built.apps', secret: 'GOCSPX-built' };
    expect(chooseGoogleClient({ GOOGLE_CLIENT_ID: 'mine', GOOGLE_CLIENT_SECRET: 's' }, builtin)).toEqual({ id: 'mine', secret: 's', from: 'dotenv' });
    // Half an override is reported as such, never silently replaced by the built-in pair.
    expect(chooseGoogleClient({ GOOGLE_CLIENT_ID: 'mine' }, builtin)).toEqual({ id: 'mine', secret: '', from: 'dotenv' });
    expect(chooseGoogleClient({}, builtin)).toEqual({ id: 'built.apps', secret: 'GOCSPX-built', from: 'builtin' });
    expect(chooseGoogleClient({ GOOGLE_CLIENT_SECRET: 'only-a-secret' }, builtin)).toEqual({ id: 'built.apps', secret: 'GOCSPX-built', from: 'builtin' });
    expect(chooseGoogleClient({}, { id: '', secret: '' })).toEqual({ id: undefined, secret: undefined, from: 'none' });
    expect(chooseGoogleClient({}, { id: 'x', secret: '' })).toEqual({ id: undefined, secret: undefined, from: 'none' });
  });

  it('this build ships with an empty built-in pair, so a bare local mode has no Google client', () => {
    expect(BUILTIN_GOOGLE_CLIENT).toEqual({ id: '', secret: '' });
    const e = env(null);
    expect(e.GOOGLE_CLIENT_ID).toBeUndefined();
    expect(e.GOOGLE_CLIENT_SECRET).toBeUndefined();
    expect(e.TODOIST_CLIENT_ID).toBeUndefined();
    expect(e.LOG_LEVEL).toBe('warn');
    expect(e.UPSTREAM_REPO).toBe('priyam-k/collected');
    expect(e.LOCAL_OWNER).toBe(true);
    expect(notes).toEqual([]);
  });

  it('takes the overrides from the dotenv and leaves process.env alone', () => {
    const e = env('GOOGLE_CLIENT_ID=mine\nGOOGLE_CLIENT_SECRET=sec\nTODOIST_CLIENT_ID=t\nTODOIST_CLIENT_SECRET=ts\nTZ=Europe/Paris\nLOG_LEVEL=debug\nUPSTREAM_REPO=me/fork\n');
    expect(e).toMatchObject({ GOOGLE_CLIENT_ID: 'mine', GOOGLE_CLIENT_SECRET: 'sec', TODOIST_CLIENT_ID: 't', TODOIST_CLIENT_SECRET: 'ts', TZ: 'Europe/Paris', LOG_LEVEL: 'debug', UPSTREAM_REPO: 'me/fork' });
    expect(process.env.GOOGLE_CLIENT_ID).toBeUndefined();
    expect(process.env.GOOGLE_CLIENT_SECRET).toBeUndefined();
    expect(notes).toEqual([]);
  });

  it("the command's own log level beats the dotenv's", () => {
    expect(env('LOG_LEVEL=debug\n', { logLevel: 'silent' }).LOG_LEVEL).toBe('silent');
  });

  it('notes a half-set Google override, a bad repo and (under --verbose) ignored keys, naming keys and never values', () => {
    const e = env('GOOGLE_CLIENT_ID=mine\nUPSTREAM_REPO=not a repo\nPORT=9\nSECRET_KEY=abc\n', { verbose: true });
    expect(e.GOOGLE_CLIENT_ID).toBe('mine');
    expect(e.GOOGLE_CLIENT_SECRET).toBeUndefined();
    expect(e.UPSTREAM_REPO).toBe('priyam-k/collected');
    expect(notes).toHaveLength(3);
    expect(notes.find((n) => n.includes('ignoring PORT, SECRET_KEY'))).toBeTruthy();
    expect(notes.find((n) => n.includes('GOOGLE_CLIENT_ID is set but GOOGLE_CLIENT_SECRET is not'))).toBeTruthy();
    expect(notes.find((n) => n.includes('UPSTREAM_REPO must be "owner/name"'))).toBeTruthy();
    expect(notes.join('\n')).not.toContain('mine');
    expect(notes.join('\n')).not.toContain('abc');
    notes.length = 0;
    env('PORT=9\n');
    expect(notes).toEqual([]);
  });

  it.skipIf(process.platform === 'win32')('warns once about a dotenv other users can read, without --verbose', () => {
    const f = dotenv('TZ=UTC\n', 0o644);
    const e = localEnv(path.join(dir, 'data'), { dotenvPath: f, warn: (l) => notes.push(l) });
    expect(e.TZ).toBe('UTC');
    expect(notes).toEqual([`${f} is readable by other users (mode 0644); chmod 600 it`]);
  });
});
