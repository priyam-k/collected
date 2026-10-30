import { createCipheriv } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deriveChromiumKey, hostKeyHash } from './browser-cookies.js';
import { connectCanvas, connectCanvasToken, type CanvasConnectApi } from './connect.js';
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
  const sent: { method: string; path: string; body?: unknown }[] = [];
  const api: CanvasConnectApi = {
    postCanvasCookie: async (body) => {
      posts.push(body);
      return { ok: true, outcome };
    },
    send: async <T>(method: string, path: string, body?: unknown) => {
      sent.push({ method, path, body });
      return (path.endsWith('/sync') ? { outcome } : {}) as T;
    },
  };
  return { api, posts, sent };
}

/** A Canvas that knows one token; records the Authorization header of every call and never sees a cookie. */
function fakeCanvas(goodToken: string) {
  const calls: { url: string; auth: string | null; cookie: string | null }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, auth: headers.get('authorization'), cookie: headers.get('cookie') });
    if (headers.get('authorization') !== `Bearer ${goodToken}`) return new Response('{"errors":[{"message":"Invalid access token."}]}', { status: 401, headers: { 'content-type': 'application/json' } });
    return new Response('while(1);{"id":42,"name":"Test Student","login_id":"ts"}', { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
  };
  return { fetchImpl, calls };
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
    expect(lines[0]).toMatch(/no Canvas session cookie.*chrome\/brave\/edge\/arc\/chromium\/firefox\/zen\/librewolf\/floorp\/waterfox.*connect canvas --token.*Settings → Sources/);
    expect(lines.slice(1)).toEqual([
      '  chrome: 1 profile, no session cookie for umd.instructure.com',
      '  brave: not installed',
      '  edge: not installed',
      '  arc: not installed',
      '  chromium: not installed',
      '  firefox: not installed',
      '  zen: not installed',
      '  librewolf: not installed',
      '  floorp: not installed',
      '  waterfox: not installed',
    ]);
    // Chrome exists on this machine, so the Keychain line was said once, before it was opened.
    expect(logs.filter((l) => /Keychain/.test(l))).toHaveLength(1);
  });

  it('says nothing about the Keychain when the cookie comes from a Firefox-family browser, or when no Chromium store exists', async () => {
    const zen = path.join(home, 'Library', 'Application Support', 'zen', 'Profiles', 'ab12.Default (release)');
    mkdirSync(zen, { recursive: true });
    const db = new DatabaseSync(path.join(zen, 'cookies.sqlite'));
    db.exec('CREATE TABLE moz_cookies(name TEXT, value TEXT, host TEXT, expiry INTEGER)');
    db.prepare('INSERT INTO moz_cookies(name,value,host,expiry) VALUES(?,?,?,?)').run('canvas_session', 'ZENTOKEN', HOST, Math.round(Date.now() / 1000) + 86_400);
    db.close();
    const deny = () => {
      throw new Error('should not be asked');
    };
    const { api, posts } = fakeApi();
    // No Chromium browser is installed: the whole order is walked without a Keychain word.
    const res = await connectCanvas(cfg(), { log, api, keychainPassword: deny, home, platform: 'darwin' });
    expect(res.browser).toBe('zen');
    expect(posts[0]!.cookieHeader).toBe('canvas_session=ZENTOKEN');
    expect(logs.some((l) => /Keychain/.test(l))).toBe(false);
    // Named outright, a Firefox-family browser never triggers the line even with Chrome present.
    writeChrome(home, [{ host: HOST, name: 'canvas_session', value: 'CHROMETOKEN' }]);
    logs = [];
    await connectCanvas(cfg(), { browser: 'zen', log, api, keychainPassword: deny, home, platform: 'darwin' });
    expect(logs.some((l) => /Keychain/.test(l))).toBe(false);
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
    expect((err as Error).message).toMatch(/On Linux, Firefox and its forks always work/);
    expect((err as Error).message).toMatch(/chrome: cookies are locked by the desktop keyring/);
    expect((err as Error).message).toMatch(/firefox: not installed/);
  });
});

describe('connectCanvasToken', () => {
  const TOKEN = '7~abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';

  it('verifies the token against Canvas with a Bearer header, then PUTs the config and syncs; the token is never printed', async () => {
    const canvas = fakeCanvas(TOKEN);
    const { api, posts, sent } = fakeApi();
    const res = await connectCanvasToken(cfg({ canvasHost: 'canvas.school.edu' }), { log, api, fetchImpl: canvas.fetchImpl, readSecret: async () => `${TOKEN}\n` });
    expect(res).toEqual({ host: 'canvas.school.edu', user: 'Test Student', saved: true });
    // One check against Canvas itself: /users/self with the token and no cookie.
    expect(canvas.calls).toEqual([{ url: 'https://canvas.school.edu/api/v1/users/self', auth: `Bearer ${TOKEN}`, cookie: null }]);
    // Then the config, then the first sync; the cookie route is never used.
    expect(sent).toEqual([
      { method: 'PUT', path: '/api/sources/canvas/config', body: { baseUrl: 'https://canvas.school.edu', accessToken: TOKEN } },
      { method: 'POST', path: '/api/sources/canvas/sync', body: undefined },
    ]);
    expect(posts).toHaveLength(0);
    expect(logs.join('\n')).not.toContain(TOKEN);
    expect(logs.some((l) => /token works: canvas\.school\.edu knows it as Test Student/.test(l))).toBe(true);
    expect(logs.some((l) => /Canvas synced: .*assignments/.test(l))).toBe(true);
  });

  it('saves nothing when Canvas rejects the token, when it is not token-shaped, or on a dry run', async () => {
    const canvas = fakeCanvas(TOKEN);
    const { api, sent } = fakeApi();
    const opts = { log, api, fetchImpl: canvas.fetchImpl, domain: 'https://canvas.school.edu/courses/1' };
    await expect(connectCanvasToken(cfg(), { ...opts, readSecret: async () => '7~wrongwrongwrongwrongwrongwrong' })).rejects.toThrow(/canvas\.school\.edu rejected that token \(401\); nothing saved/);
    await expect(connectCanvasToken(cfg(), { ...opts, readSecret: async () => 'canvas_session=notatoken' })).rejects.toThrow(/does not look like a Canvas access token/);
    const dry = await connectCanvasToken(cfg(), { ...opts, dryRun: true, readSecret: async () => TOKEN });
    expect(dry.saved).toBe(false);
    expect(sent).toHaveLength(0);
    // The shape check ran before any network: only the two real attempts reached Canvas.
    expect(canvas.calls.map((c) => c.auth)).toEqual(['Bearer 7~wrongwrongwrongwrongwrongwrong', `Bearer ${TOKEN}`]);
    expect(logs.join('\n')).not.toContain(TOKEN);
  });
});
