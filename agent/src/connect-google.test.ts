import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MockCalendarApi } from '@collected/core/ingest/gcal/mock-api';
import { defaultConfig, defaultLocalDataDir, loadConfig, saveConfig } from './config.js';
import { CONNECT_ERRORS, connectGoogle } from './connect-google.js';

/*
 * `collected connect google` against a fake browser: the command puts the real app on an ephemeral loopback port,
 * the fake follows the start URL as far as Google's door (never through it), then lands on the callback the way
 * Google would. The token exchange is the one call that cannot run here, so it is mocked at the module Google's
 * client lives in; everything else (state, PKCE, the source row, the listener's shutdown) is the real code.
 */

const calendars = [{ id: 'primary', summary: 'Me', primary: true, backgroundColor: null, accessRole: 'owner' }];
const exchange = vi.fn(async (_env: unknown, code: string, verifier?: string) => ({ refreshToken: code === 'good' && verifier ? 'rt' : null, scopes: [] }));

vi.mock('@collected/core/ingest/gcal/api', async (importOriginal) => {
  const real = await importOriginal<typeof import('@collected/core/ingest/gcal/api')>();
  return {
    ...real,
    exchangeCode: (env: unknown, code: string, verifier?: string) => exchange(env, code, verifier),
    GoogleCalendarApi: { fromRefreshToken: () => new MockCalendarApi(calendars, { pages: { 'primary|full|': { items: [], nextPageToken: null, nextSyncToken: 't1' } } }) },
  };
});

/** What a browser does: GET the start URL (302 to Google), then come back to the callback with the state Google echoes. */
function fakeBrowser(answer: (startRedirect: URL) => string) {
  const seen: { startRedirect?: URL; callback?: Response; done?: Promise<void> } = {};
  const open = (url: string) => {
    seen.done = (async () => {
      const res = await fetch(url, { redirect: 'manual' });
      const to = new URL(res.headers.get('location')!);
      seen.startRedirect = to;
      const origin = new URL(url).origin;
      seen.callback = await fetch(`${origin}/api/google/callback?${answer(to)}`, { redirect: 'manual' });
    })();
  };
  return { open, seen };
}

describe('connect google', () => {
  let home: string;
  const savedHome = process.env.COLLECTED_AGENT_HOME;
  const quiet = () => {};

  beforeAll(() => {
    home = mkdtempSync(path.join(tmpdir(), 'collected-connect-google-'));
    process.env.COLLECTED_AGENT_HOME = home;
    const cfg = defaultConfig('local');
    cfg.local = { dataDir: defaultLocalDataDir() };
    saveConfig(cfg);
    writeFileSync(path.join(home, '.env'), 'GOOGLE_CLIENT_ID=test-client.apps\nGOOGLE_CLIENT_SECRET=GOCSPX-test\n', { mode: 0o600 });
  });
  afterAll(() => {
    if (savedHome === undefined) delete process.env.COLLECTED_AGENT_HOME;
    else process.env.COLLECTED_AGENT_HOME = savedHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('refuses in client mode and says where to go', async () => {
    await expect(connectGoogle(defaultConfig('https://c.example.com'), { target: 'calendar', log: quiet })).rejects.toThrow('open https://c.example.com/settings/sources and click Connect Google Calendar');
  });

  it('connects Calendar: loopback redirect URI with the real port, PKCE on the URL, the verifier on the exchange, then stops', async () => {
    const lines: string[] = [];
    const browser = fakeBrowser((to) => `state=${to.searchParams.get('state')}&code=good`);
    const r = await connectGoogle(loadConfig(), { target: 'calendar', log: (l) => lines.push(l), logLevel: 'silent', open: browser.open, timeoutMs: 20_000, graceMs: 50 });
    expect(r).toEqual({ ok: true, source: 'gcal', detail: 'Google Calendar connected: 1 calendar (Me)' });
    await browser.seen.done;

    const to = browser.seen.startRedirect!;
    expect(to.origin).toBe('https://accounts.google.com');
    expect(to.searchParams.get('client_id')).toBe('test-client.apps');
    expect(to.searchParams.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/api\/google\/callback$/);
    expect(to.searchParams.get('code_challenge_method')).toBe('S256');
    expect(to.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const port = new URL(to.searchParams.get('redirect_uri')!).port;
    expect(port).not.toBe('');
    expect(lines[0]).toContain(`listening on http://127.0.0.1:${port}`);
    expect(lines[1]).toContain(`http://127.0.0.1:${port}/api/google/start`);

    expect(exchange).toHaveBeenCalledTimes(1);
    const [, code, verifier] = exchange.mock.calls[0]!;
    expect(code).toBe('good');
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // The browser was sent on to the Sources page of the same listener, and the listener is gone afterwards.
    expect(browser.seen.callback!.status).toBe(302);
    expect(browser.seen.callback!.headers.get('location')).toBe(`http://127.0.0.1:${port}/settings/sources?google=connected`);
    await expect(fetch(`http://127.0.0.1:${port}/api/health`)).rejects.toThrow();
  }, 30_000);

  it('reports a consent that was denied without waiting for the timeout', async () => {
    const browser = fakeBrowser((to) => `state=${to.searchParams.get('state')}&error=access_denied`);
    const r = await connectGoogle(loadConfig(), { target: 'tasks', log: quiet, logLevel: 'silent', open: browser.open, timeoutMs: 20_000, graceMs: 0 });
    expect(r).toEqual({ ok: false, source: 'gtasks', reason: 'denied', detail: `Google Tasks not connected: ${CONNECT_ERRORS.denied}` });
    await browser.seen.done;
    expect(browser.seen.startRedirect!.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/tasks');
    expect(browser.seen.callback!.headers.get('location')).toMatch(/\/settings\/sources\?google=error&reason=denied&source=gtasks$/);
  }, 30_000);

  it('gives up after the timeout when the browser never comes back', async () => {
    const r = await connectGoogle(loadConfig(), { target: 'calendar', log: quiet, logLevel: 'silent', open: () => {}, timeoutMs: 1500, graceMs: 0 });
    expect(r).toEqual({ ok: false, source: 'gcal', reason: 'timeout', detail: `Google Calendar not connected: ${CONNECT_ERRORS.timeout}` });
  }, 30_000);

  it('says so up front when the build has no Google client and the dotenv names none', async () => {
    const bare = mkdtempSync(path.join(tmpdir(), 'collected-connect-bare-'));
    const saved = process.env.COLLECTED_AGENT_HOME;
    process.env.COLLECTED_AGENT_HOME = bare;
    try {
      const cfg = defaultConfig('local');
      cfg.local = { dataDir: path.join(bare, 'data') };
      await expect(connectGoogle(cfg, { target: 'calendar', log: quiet, logLevel: 'silent' })).rejects.toThrow(`this build ships without a Google client. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to ${path.join(bare, '.env')}`);
    } finally {
      process.env.COLLECTED_AGENT_HOME = saved;
      rmSync(bare, { recursive: true, force: true });
    }
  });
});
