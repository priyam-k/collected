import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Api } from './api.js';
import type { AgentConfig } from './config.js';

/* The download's two hops against a stubbed fetch: what the server's Location may and may not point at. */

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'collected-api-'));
});
afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(tmp, { recursive: true, force: true });
});

const cfg = (over: Partial<AgentConfig> = {}): AgentConfig => ({ server: 'https://collected.example.com', auth: { helperKey: 'k' }, device: 'd', cacheDir: tmp, courses: {}, model: { enabled: false }, ...over });

type Hop = (url: string, init: RequestInit) => Response | Promise<Response>;
function stubFetch(hops: Hop[]): { calls: { url: string; init: RequestInit }[] } {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal('fetch', async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const hop = hops[calls.length - 1];
    if (!hop) throw new Error(`unexpected fetch #${calls.length}: ${String(url)}`);
    return hop(String(url), init);
  });
  return { calls };
}
const redirectTo = (location: string): Hop => () => new Response(null, { status: 302, headers: { location } });
const body = (text: string, headers: Record<string, string> = {}): Hop => () => new Response(text, { status: 200, headers });

describe('Api', () => {
  it('refuses a plain-http server that is not this machine', () => {
    expect(() => new Api(cfg({ server: 'http://collected.example.com' }))).toThrow(/must be https/);
    expect(() => new Api(cfg({ server: 'http://localhost:3000' }))).not.toThrow();
  });

  it('downloads through the one redirect, without auth on the second hop, with timeouts on both', async () => {
    const { calls } = stubFetch([redirectTo('https://inst-fs.example.net/files/1?token=x'), body('pdf bytes')]);
    const dest = path.join(tmp, 'c', '1-v0', 'a.pdf');
    await new Api(cfg()).download('1', dest);
    expect(readFileSync(dest, 'utf8')).toBe('pdf bytes');
    expect(readdirSync(path.dirname(dest))).toEqual(['a.pdf']);
    expect(calls[0]!.url).toBe('https://collected.example.com/api/canvas/files/1/open?download=1');
    expect((calls[0]!.init.headers as Record<string, string>)['x-collected-key']).toBe('k');
    expect(calls[1]!.init.headers).toBeUndefined();
    expect(calls[1]!.init.redirect).toBe('manual');
    expect(calls.every((c) => c.init.signal instanceof AbortSignal)).toBe(true);
  });

  it('rejects a file id that is not digits before any request', async () => {
    const { calls } = stubFetch([]);
    await expect(new Api(cfg()).download('1/../../admin', path.join(tmp, 'x'))).rejects.toThrow(/not a Canvas file id/);
    expect(calls).toHaveLength(0);
  });

  it('refuses locations that are not https or point at private hosts', async () => {
    for (const loc of ['http://inst-fs.example.net/f', 'https://127.0.0.1/f', 'https://10.1.2.3/f', 'https://169.254.169.254/latest/meta-data', 'https://[fe80::1]/f', 'https://nas.local/f', 'https://localhost/f']) {
      const { calls } = stubFetch([redirectTo(loc)]);
      await expect(new Api(cfg()).download('1', path.join(tmp, 'x')), loc).rejects.toThrow(/not https|private host/);
      expect(calls).toHaveLength(1);
    }
    stubFetch([redirectTo('https://me.cloudflareaccess.com/cdn-cgi/access/login')]);
    await expect(new Api(cfg()).download('1', path.join(tmp, 'x'))).rejects.toThrow(/Cloudflare Access/);
  });

  it('does not follow a second redirect', async () => {
    stubFetch([redirectTo('https://cdn.example.net/a'), redirectTo('https://10.0.0.1/b')]);
    await expect(new Api(cfg()).download('1', path.join(tmp, 'x'))).rejects.toThrow(/redirected again/);
    expect(existsSync(path.join(tmp, 'x.part'))).toBe(false);
  });

  it('stops past the size cap and removes the partial file', async () => {
    const big = 'x'.repeat(3 * 1024 * 1024);
    stubFetch([redirectTo('https://cdn.example.net/a'), body(big)]);
    const dest = path.join(tmp, 'big.bin');
    await expect(new Api(cfg({ maxFileMb: 1 })).download('1', dest)).rejects.toThrow(/more than 1 MB/);
    expect(existsSync(dest)).toBe(false);
    expect(existsSync(`${dest}.part`)).toBe(false);

    stubFetch([redirectTo('https://cdn.example.net/a'), body('', { 'content-length': String(5 * 1024 * 1024) })]);
    await expect(new Api(cfg({ maxFileMb: 1 })).download('1', dest)).rejects.toThrow(/over this machine's 1 MB cap/);
  });
});
