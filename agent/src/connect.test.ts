import { createCipheriv } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
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
    const res = await connectCanvas(cfg(), { browser: 'chrome', log, api, keychainPassword: reader, home });
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
    await connectCanvas(cfg(), { browser: 'chrome', domain: 'canvas.school.edu', log, api, keychainPassword: reader, home });
    expect(posts[0]!.baseUrl).toBe('https://canvas.school.edu');
  });

  it('falls back to cfg.canvasHost when no --domain is given', async () => {
    writeChrome(home, [{ host: 'umd.instructure.com', name: 'canvas_session', value: 'T' }]);
    const { api, posts } = fakeApi();
    await connectCanvas(cfg({ canvasHost: 'umd.instructure.com' }), { browser: 'chrome', log, api, keychainPassword: reader, home });
    expect(posts[0]!.baseUrl).toBe('https://umd.instructure.com');
  });

  it('dry-run reports the find and posts nothing', async () => {
    writeChrome(home, [{ host: HOST, name: 'canvas_session', value: 'TOKEN' }]);
    const { api, posts } = fakeApi();
    const res = await connectCanvas(cfg(), { browser: 'chrome', dryRun: true, log, api, keychainPassword: reader, home });
    expect(res.posted).toBe(false);
    expect(posts).toHaveLength(0);
    expect(logs.some((l) => /dry run/.test(l))).toBe(true);
  });

  it('throws when no session cookie is present, naming the host', async () => {
    writeChrome(home, [{ host: HOST, name: '_ga', value: 'x' }]);
    const { api } = fakeApi();
    await expect(connectCanvas(cfg(), { browser: 'chrome', log, api, keychainPassword: reader, home })).rejects.toThrow(/no Canvas session cookie.*umd\.instructure\.com/s);
  });

  it('rejects an unknown browser name', async () => {
    const { api } = fakeApi();
    await expect(connectCanvas(cfg(), { browser: 'safari', log, api, keychainPassword: reader, home })).rejects.toThrow(/unknown browser/);
  });

  it('surfaces a denied Keychain prompt in the error', async () => {
    writeChrome(home, [{ host: HOST, name: 'canvas_session', value: 'T' }]);
    const { api } = fakeApi();
    const deny = () => {
      throw new Error('User interaction is not allowed.');
    };
    await expect(connectCanvas(cfg(), { browser: 'chrome', log, api, keychainPassword: deny, home })).rejects.toThrow(/Keychain/);
  });
});
