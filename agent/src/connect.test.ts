import { createCipheriv } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deriveChromiumKey, hostKeyHash } from './browser-cookies.js';
import { connectCanvas, type CanvasConnectApi } from './connect.js';
import type { AgentConfig } from './config.js';

const PASSWORD = 'test-safe-storage-password';
const KEY = deriveChromiumKey(PASSWORD);
const reader = () => PASSWORD;
const HOST = 'umd.instructure.com';

function encrypt(plain: string, hostKey = HOST): Buffer {
  const iv = Buffer.alloc(16, 0x20);
  const cipher = createCipheriv('aes-128-cbc', KEY, iv);
  const body = Buffer.concat([hostKeyHash(hostKey), Buffer.from(plain)]);
  return Buffer.concat([Buffer.from('v10'), cipher.update(body), cipher.final()]);
}
const webkit = (unixMs: number): bigint => BigInt(Math.round(unixMs)) * 1000n + 11644473600000000n;

function writeChrome(home: string, rows: { host: string; name: string; value: string; expires?: bigint }[]): void {
  const dir = path.join(home, 'Library', 'Application Support', 'Google', 'Chrome', 'Default');
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, 'Cookies'));
  db.exec('CREATE TABLE cookies(host_key TEXT, name TEXT, encrypted_value BLOB, value TEXT, expires_utc INTEGER)');
  const stmt = db.prepare('INSERT INTO cookies(host_key,name,encrypted_value,value,expires_utc) VALUES(?,?,?,?,?)');
  for (const r of rows) stmt.run(r.host, r.name, encrypt(r.value), '', r.expires ?? webkit(Date.now() + 86_400_000 * 365));
  db.close();
}

const cfg = (over: Partial<AgentConfig> = {}): AgentConfig => ({ server: 'https://collected.example.com', auth: { helperKey: 'k' }, device: 'd', cacheDir: '/tmp', courses: {}, model: { enabled: false }, ...over });

function fakeApi(outcome: unknown = { ok: true, result: { counts: { assignments: 7 } } }) {
  const posts: { cookieHeader: string; baseUrl?: string }[] = [];
  const api: CanvasConnectApi = {
    postCanvasCookie: async (body) => {
      posts.push(body);
      return { ok: true, outcome };
    },
  };
  return { api, posts };
}

let home: string;
let logs: string[];
const log = (s: string) => logs.push(s);
beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 'collected-home-'));
  logs = [];
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('connectCanvas', () => {
  it('posts the session cookie header and base URL to the server, printing only names', async () => {
    writeChrome(home, [
      { host: HOST, name: 'canvas_session', value: 'TOKENA' },
      { host: HOST, name: '_normandy_session', value: 'TOKENB' },
      { host: HOST, name: '_ga', value: 'analytics-should-stay' },
    ]);
    const { api, posts } = fakeApi();
    const res = await connectCanvas(cfg(), { browser: 'chrome', log, api, keychainPassword: reader, home, platform: 'darwin' });
    expect(res.posted).toBe(true);
    expect(res.names).toEqual(['canvas_session', '_normandy_session']);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.cookieHeader).toBe('canvas_session=TOKENA; _normandy_session=TOKENB');
    expect(posts[0]!.baseUrl).toBe('https://umd.instructure.com');
    // No cookie value is ever printed.
    expect(logs.join('\n')).not.toContain('TOKENA');
    expect(logs.some((l) => /canvas_session, _normandy_session/.test(l))).toBe(true);
    expect(logs.some((l) => /Canvas synced/.test(l))).toBe(true);
  });

  it('uses --domain over the default host', async () => {
    writeChrome(home, [{ host: 'canvas.school.edu', name: 'canvas_session', value: 'T' }]);
    const { api, posts } = fakeApi();
    await connectCanvas(cfg(), { browser: 'chrome', domain: 'canvas.school.edu', log, api, keychainPassword: reader, home, platform: 'darwin' });
    expect(posts[0]!.baseUrl).toBe('https://canvas.school.edu');
  });

  it('falls back to cfg.canvasHost when no --domain is given', async () => {
    writeChrome(home, [{ host: 'umd.instructure.com', name: 'canvas_session', value: 'T' }]);
    const { api, posts } = fakeApi();
    await connectCanvas(cfg({ canvasHost: 'umd.instructure.com' }), { browser: 'chrome', log, api, keychainPassword: reader, home, platform: 'darwin' });
    expect(posts[0]!.baseUrl).toBe('https://umd.instructure.com');
  });

  it('dry-run reports the find and posts nothing', async () => {
    writeChrome(home, [{ host: HOST, name: 'canvas_session', value: 'TOKEN' }]);
    const { api, posts } = fakeApi();
    const res = await connectCanvas(cfg(), { browser: 'chrome', dryRun: true, log, api, keychainPassword: reader, home, platform: 'darwin' });
    expect(res.posted).toBe(false);
    expect(posts).toHaveLength(0);
    expect(logs.some((l) => /dry run/.test(l))).toBe(true);
  });

  it('throws when no session cookie is present, naming the host', async () => {
    writeChrome(home, [{ host: HOST, name: '_ga', value: 'x' }]);
    const { api } = fakeApi();
    await expect(connectCanvas(cfg(), { browser: 'chrome', log, api, keychainPassword: reader, home, platform: 'darwin' })).rejects.toThrow(/no Canvas session cookie.*umd\.instructure\.com/s);
  });

  it('rejects an unknown browser name', async () => {
    const { api } = fakeApi();
    await expect(connectCanvas(cfg(), { browser: 'safari', log, api, keychainPassword: reader, home, platform: 'darwin' })).rejects.toThrow(/unknown browser/);
  });

  it('surfaces a denied Keychain prompt in the error', async () => {
    writeChrome(home, [{ host: HOST, name: 'canvas_session', value: 'T' }]);
    const { api } = fakeApi();
    const deny = () => {
      throw new Error('User interaction is not allowed.');
    };
    await expect(connectCanvas(cfg(), { browser: 'chrome', log, api, keychainPassword: deny, home, platform: 'darwin' })).rejects.toThrow(/Keychain/);
  });

  it('lists every browser\'s outcome when nothing is found, so a locked store is not reported as a missing cookie', async () => {
    writeChrome(home, [{ host: HOST, name: '_ga', value: 'x' }]);
    const { api } = fakeApi();
    const err = await connectCanvas(cfg(), { log, api, keychainPassword: reader, home, platform: 'darwin' }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    const lines = (err as Error).message.split('\n');
    expect(lines[0]).toMatch(/no Canvas session cookie.*chrome\/brave\/edge\/arc\/chromium\/firefox.*Settings → Sources/);
    expect(lines.slice(1)).toEqual(['  chrome: 1 profile, no session cookie for umd.instructure.com', '  brave: not installed', '  edge: not installed', '  arc: not installed', '  chromium: not installed', '  firefox: not installed']);
  });

  it('on Windows, reads Firefox with no Keychain talk and names app-bound Chrome in the error', async () => {
    const roaming = path.join(home, 'Roaming');
    const local = path.join(home, 'Local');
    const ff = path.join(roaming, 'Mozilla', 'Firefox', 'Profiles', 'abcd.default-release');
    mkdirSync(ff, { recursive: true });
    const db = new DatabaseSync(path.join(ff, 'cookies.sqlite'));
    db.exec('CREATE TABLE moz_cookies(name TEXT, value TEXT, host TEXT, expiry INTEGER)');
    db.prepare('INSERT INTO moz_cookies(name,value,host,expiry) VALUES(?,?,?,?)').run('canvas_session', 'WINTOKEN', HOST, Math.round(Date.now() / 1000) + 86_400);
    db.close();
    // Chrome is present with an app-bound cookie: it is tried first and must explain itself, not stop the search.
    const chrome = path.join(local, 'Google', 'Chrome', 'User Data');
    mkdirSync(path.join(chrome, 'Default'), { recursive: true });
    writeFileSync(path.join(chrome, 'Local State'), JSON.stringify({ os_crypt: { encrypted_key: Buffer.concat([Buffer.from('DPAPI'), Buffer.from('blob')]).toString('base64') } }));
    const cdb = new DatabaseSync(path.join(chrome, 'Default', 'Cookies'));
    cdb.exec('CREATE TABLE cookies(host_key TEXT, name TEXT, encrypted_value BLOB, value TEXT, expires_utc INTEGER)');
    cdb.prepare('INSERT INTO cookies(host_key,name,encrypted_value,value,expires_utc) VALUES(?,?,?,?,?)').run(HOST, 'canvas_session', Buffer.from('v20' + 'x'.repeat(40)), '', 0);
    cdb.close();
    const env = { APPDATA: roaming, LOCALAPPDATA: local };
    const { api, posts } = fakeApi();
    const res = await connectCanvas(cfg(), { log, api, home, platform: 'win32', env, dpapiUnprotect: () => Buffer.alloc(32) });
    expect(res.browser).toBe('firefox');
    expect(posts[0]!.cookieHeader).toBe('canvas_session=WINTOKEN');
    expect(logs.some((l) => /Keychain/.test(l))).toBe(false);
    expect(logs.some((l) => /app-bound/.test(l))).toBe(true);

    // With --browser chrome the app-bound reason is the error, with the Windows hint.
    const err = await connectCanvas(cfg(), { browser: 'chrome', log, api, home, platform: 'win32', env, dpapiUnprotect: () => Buffer.alloc(32) }).catch((e: Error) => e);
    expect((err as Error).message).toMatch(/On Windows, Firefox is the browser this can read/);
    expect((err as Error).message).toMatch(/chrome: Chrome protects its cookies with app-bound encryption on Windows; use Firefox, or paste the cookie from DevTools \(Settings → Sources\)/);
  });

  it('on Linux, says when the keyring locks a Chromium store', async () => {
    const dir = path.join(home, '.config', 'google-chrome', 'Default');
    mkdirSync(dir, { recursive: true });
    const cdb = new DatabaseSync(path.join(dir, 'Cookies'));
    cdb.exec('CREATE TABLE cookies(host_key TEXT, name TEXT, encrypted_value BLOB, value TEXT, expires_utc INTEGER)');
    // 48 random-looking bytes under v11: not a valid PKCS7 block for the basic key.
    cdb.prepare('INSERT INTO cookies(host_key,name,encrypted_value,value,expires_utc) VALUES(?,?,?,?,?)').run(HOST, 'canvas_session', Buffer.concat([Buffer.from('v11'), Buffer.alloc(48, 7)]), '', 0);
    cdb.close();
    const { api } = fakeApi();
    const err = await connectCanvas(cfg(), { log, api, home, platform: 'linux', env: {}, linuxKeyringPassword: () => undefined }).catch((e: Error) => e);
    expect((err as Error).message).toMatch(/On Linux, Firefox always works/);
    expect((err as Error).message).toMatch(/chrome: cookies are locked by the desktop keyring/);
    expect((err as Error).message).toMatch(/firefox: not installed/);
  });
});
