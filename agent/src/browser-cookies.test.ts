import { createCipheriv } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decryptChromiumValue, deriveChromiumKey, hostKeyHash, scanBrowser } from './browser-cookies.js';

/* Fixtures are built the way the browsers write their stores, so decryption and enumeration are exercised end to end. */

const PASSWORD = 'test-safe-storage-password';
const KEY = deriveChromiumKey(PASSWORD);
const reader = () => PASSWORD;
const HOST = 'umd.instructure.com';

/** Encrypt a value exactly as Chromium does on macOS; with `hostKey` set, prepend the Chrome 130+ 32-byte hash. */
function encryptChromium(plain: string, hostKey?: string): Buffer {
  const iv = Buffer.alloc(16, 0x20);
  const cipher = createCipheriv('aes-128-cbc', KEY, iv);
  const body = hostKey !== undefined ? Buffer.concat([hostKeyHash(hostKey), Buffer.from(plain)]) : Buffer.from(plain);
  return Buffer.concat([Buffer.from('v10'), cipher.update(body), cipher.final()]);
}

/** Chrome `expires_utc`: microseconds since 1601. */
const webkit = (unixMs: number): bigint => BigInt(Math.round(unixMs)) * 1000n + 11644473600000000n;
const FUTURE = webkit(Date.now() + 86_400_000 * 365);
const PAST = webkit(Date.now() - 86_400_000);

interface Row {
  host: string;
  name: string;
  enc?: Buffer;
  value?: string;
  expires?: bigint;
}

function writeChromiumStore(file: string, rows: Row[], layout: 'flat' | 'network' = 'flat'): void {
  const dir = layout === 'network' ? path.join(path.dirname(file), 'Network') : path.dirname(file);
  mkdirSync(dir, { recursive: true });
  const target = path.join(dir, 'Cookies');
  const db = new DatabaseSync(target);
  db.exec('CREATE TABLE cookies(host_key TEXT, name TEXT, encrypted_value BLOB, value TEXT, expires_utc INTEGER)');
  const stmt = db.prepare('INSERT INTO cookies(host_key,name,encrypted_value,value,expires_utc) VALUES(?,?,?,?,?)');
  for (const r of rows) stmt.run(r.host, r.name, r.enc ?? null, r.value ?? '', r.expires ?? FUTURE);
  db.close();
}

function chromeProfileDir(home: string, profile: string): string {
  return path.join(home, 'Library', 'Application Support', 'Google', 'Chrome', profile);
}

let home: string;
beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 'collected-home-'));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('decryptChromiumValue', () => {
  it('decrypts the pre-130 format (no host-key prefix)', () => {
    expect(decryptChromiumValue(encryptChromium('plain-session-value'), KEY)).toBe('plain-session-value');
  });

  it('decrypts the Chrome 130+ format and strips the 32-byte host-key hash', () => {
    expect(decryptChromiumValue(encryptChromium('abc123cookie', HOST), KEY)).toBe('abc123cookie');
  });

  it('returns null on the wrong key rather than throwing', () => {
    const wrong = deriveChromiumKey('nope');
    const out = decryptChromiumValue(encryptChromium('x', HOST), wrong);
    expect(out === null || out !== 'x').toBe(true);
  });
});

describe('scanBrowser chromium', () => {
  it('reads the session cookie from the default profile, decrypting with the injected Keychain password', () => {
    writeChromiumStore(path.join(chromeProfileDir(home, 'Default'), 'Cookies'), [
      { host: HOST, name: 'canvas_session', enc: encryptChromium('SESSIONTOKEN', HOST) },
      { host: HOST, name: '_csrf_token', enc: encryptChromium('ignore-me', HOST) },
    ]);
    const scan = scanBrowser('chrome', HOST, ['canvas_session', '_normandy_session', '_legacy_normandy_session'], { home, keychainPassword: reader });
    expect(scan.installed).toBe(true);
    expect(scan.profiles).toHaveLength(1);
    expect(scan.profiles[0]!.profile).toBe('Default');
    expect(scan.profiles[0]!.cookies).toEqual([{ name: 'canvas_session', value: 'SESSIONTOKEN' }]);
  });

  it('enumerates profiles with Default first, and reads a Network/Cookies layout', () => {
    writeChromiumStore(path.join(chromeProfileDir(home, 'Profile 1'), 'Cookies'), [{ host: HOST, name: 'canvas_session', enc: encryptChromium('P1', HOST) }]);
    writeChromiumStore(path.join(chromeProfileDir(home, 'Default'), 'placeholder'), [{ host: HOST, name: 'canvas_session', enc: encryptChromium('DEF', HOST) }], 'network');
    const scan = scanBrowser('chrome', HOST, ['canvas_session'], { home, keychainPassword: reader });
    expect(scan.profiles.map((p) => p.profile)).toEqual(['Default', 'Profile 1']);
    expect(scan.profiles[0]!.cookies[0]!.value).toBe('DEF');
    expect(scan.profiles[1]!.cookies[0]!.value).toBe('P1');
  });

  it('skips expired cookies and keeps session (expires 0) cookies', () => {
    writeChromiumStore(path.join(chromeProfileDir(home, 'Default'), 'Cookies'), [
      { host: HOST, name: '_normandy_session', enc: encryptChromium('OLD', HOST), expires: PAST },
      { host: HOST, name: 'canvas_session', enc: encryptChromium('NOW', HOST), expires: 0n },
    ]);
    const scan = scanBrowser('chrome', HOST, ['canvas_session', '_normandy_session'], { home, keychainPassword: reader });
    expect(scan.profiles[0]!.cookies).toEqual([{ name: 'canvas_session', value: 'NOW' }]);
  });

  it('matches cookies set on a parent domain', () => {
    writeChromiumStore(path.join(chromeProfileDir(home, 'Default'), 'Cookies'), [{ host: '.instructure.com', name: 'canvas_session', enc: encryptChromium('PARENT', HOST) }]);
    const scan = scanBrowser('chrome', HOST, ['canvas_session'], { home, keychainPassword: reader });
    expect(scan.profiles[0]!.cookies[0]!.value).toBe('PARENT');
  });

  it('reports installed:false when the browser is not present', () => {
    const scan = scanBrowser('brave', HOST, ['canvas_session'], { home, keychainPassword: reader });
    expect(scan).toEqual({ browser: 'brave', installed: false, profiles: [] });
  });

  it('reports an error (not a throw) when the Keychain prompt is denied', () => {
    writeChromiumStore(path.join(chromeProfileDir(home, 'Default'), 'Cookies'), [{ host: HOST, name: 'canvas_session', enc: encryptChromium('X', HOST) }]);
    const deny = () => {
      throw new Error('User interaction is not allowed.');
    };
    const scan = scanBrowser('chrome', HOST, ['canvas_session'], { home, keychainPassword: deny });
    expect(scan.installed).toBe(true);
    expect(scan.profiles).toHaveLength(0);
    expect(scan.error).toMatch(/Keychain/);
  });
});

describe('scanBrowser firefox', () => {
  function writeFirefoxStore(home2: string, profile: string, rows: { host: string; name: string; value: string; expiry?: number }[]): void {
    const dir = path.join(home2, 'Library', 'Application Support', 'Firefox', 'Profiles', profile);
    mkdirSync(dir, { recursive: true });
    const db = new DatabaseSync(path.join(dir, 'cookies.sqlite'));
    db.exec('CREATE TABLE moz_cookies(name TEXT, value TEXT, host TEXT, expiry INTEGER)');
    const stmt = db.prepare('INSERT INTO moz_cookies(name,value,host,expiry) VALUES(?,?,?,?)');
    const future = Math.round(Date.now() / 1000) + 86_400 * 365;
    for (const r of rows) stmt.run(r.name, r.value, r.host, r.expiry ?? future);
    db.close();
  }

  it('reads unencrypted values and prefers the default-release profile', () => {
    writeFirefoxStore(home, 'aaaa.default-release', [
      { host: HOST, name: 'canvas_session', value: 'FFVALUE' },
      { host: HOST, name: 'canvas_session_expired', value: 'OLD', expiry: Math.round(Date.now() / 1000) - 10 },
    ]);
    writeFirefoxStore(home, 'bbbb.other', [{ host: HOST, name: 'canvas_session', value: 'OTHER' }]);
    const scan = scanBrowser('firefox', HOST, ['canvas_session'], { home });
    expect(scan.installed).toBe(true);
    expect(scan.profiles[0]!.profile).toBe('aaaa.default-release');
    expect(scan.profiles[0]!.cookies).toEqual([{ name: 'canvas_session', value: 'FFVALUE' }]);
  });
});
