import { existsSync } from 'node:fs';
import { openApi } from './api.js';
import type { AgentConfig } from './config.js';
import { BROWSER_ORDER, chromiumUserDataDir, describeScan, isBrowserId, isFirefoxFamily, scanBrowser, type BrowserId, type DpapiUnprotect, type FoundCookie, type KeychainReader, type LinuxKeyringReader } from './browser-cookies.js';

/*
 * `collected connect canvas`: give the server a Canvas credential. `--token` is the primary way: a personal access
 * token the user mints in Canvas (Account → Settings → Approved Integrations → New Access Token), typed at a prompt
 * or piped on stdin, checked against Canvas, then stored through `PUT /api/sources/canvas/config`. Without `--token`
 * the command reads the Canvas session cookie out of a local browser and posts it, replacing local/canvas_cookie.py.
 * Only the credential leaves this machine, over the server URL that agent.json already validated. Neither a token
 * nor a cookie value is ever printed — names and the host only.
 */

/** The only cookies that are sent; UMD's Canvas sets `canvas_session`, older instances the `_normandy` pair. */
export const SESSION_COOKIE_NAMES = ['canvas_session', '_normandy_session', '_legacy_normandy_session'] as const;

export const DEFAULT_CANVAS_HOST = 'umd.instructure.com';

/** Where a Canvas user mints a token; said in help and in the cookie flow's failure. */
export const TOKEN_HOWTO = 'Canvas → Account → Settings → Approved Integrations → "+ New Access Token"';

/** Just the piece of the server API that connect needs; the real `Api` and `LocalApi` satisfy it, tests pass a fake. */
export interface CanvasConnectApi {
  postCanvasCookie(body: { cookieHeader: string; baseUrl?: string }): Promise<{ ok: boolean; outcome: unknown }>;
  send<T>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', p: string, body?: unknown): Promise<T>;
}

/** `--domain`, then `canvasHost` in agent.json, then the default; a scheme or path on it is dropped. */
function resolveHost(cfg: AgentConfig, domain: string | undefined): string {
  const host = (domain ?? cfg.canvasHost ?? DEFAULT_CANVAS_HOST).trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!host) throw new Error('no Canvas host; pass --domain');
  return host;
}

export interface ConnectOptions {
  browser?: string;
  domain?: string;
  dryRun?: boolean;
  log: (s: string) => void;
  /** Injected in tests so the real server/Keychain/browser/machine are never touched. */
  api?: CanvasConnectApi;
  keychainPassword?: KeychainReader;
  dpapiUnprotect?: DpapiUnprotect;
  linuxKeyringPassword?: LinuxKeyringReader;
  home?: string;
  platform?: NodeJS.Platform;
  env?: Record<string, string | undefined>;
}

export interface ConnectResult {
  browser: BrowserId;
  profile: string;
  names: string[];
  posted: boolean;
}

/** `name=value; name=value` from the session cookies present, in SESSION_COOKIE_NAMES order. */
function cookieHeader(found: FoundCookie[]): string {
  const byName = new Map(found.map((c) => [c.name, c.value]));
  return SESSION_COOKIE_NAMES.filter((n) => byName.has(n))
    .map((n) => `${n}=${byName.get(n)!}`)
    .join('; ');
}

export async function connectCanvas(cfg: AgentConfig, opts: ConnectOptions): Promise<ConnectResult> {
  const { log } = opts;
  if (opts.browser !== undefined && !isBrowserId(opts.browser)) {
    throw new Error(`unknown browser "${opts.browser}"; one of: ${BROWSER_ORDER.join(', ')}`);
  }
  const host = resolveHost(cfg, opts.domain);
  const order: BrowserId[] = opts.browser ? [opts.browser as BrowserId] : BROWSER_ORDER;

  const platform = opts.platform ?? process.platform;
  log('reading the Canvas session cookie from your browser.');
  // The Keychain (macOS) and app-bound (Windows) lines are said once, right before the first Chromium store that
  // exists is opened: that is the moment the OS may prompt. Firefox and its forks are read in the clear, so a run
  // that finds the cookie in one of them first, or a machine with only those, never hears about the Keychain.
  let warnedChromium = false;
  const warnChromium = (browser: BrowserId) => {
    if (warnedChromium || isFirefoxFamily(browser)) return;
    const dir = chromiumUserDataDir(browser, { home: opts.home, platform, env: opts.env });
    if (!dir || !existsSync(dir)) return;
    warnedChromium = true;
    if (platform === 'darwin') log('macOS may ask for your Keychain password — click "Allow" (not "Always Allow").');
    else if (platform === 'win32') log('Firefox works directly; Chrome and Edge keep theirs app-bound, so those usually need an access token (connect canvas --token) or the paste in Settings → Sources.');
  };

  // Every browser's outcome is kept, so the error says what was looked at: not installed, N profiles without the
  // cookie, or why the store could not be read. "Not found" must never hide "could not read".
  const notes: string[] = [];
  let hit: { browser: BrowserId; profile: string; cookies: FoundCookie[] } | null = null;
  for (const browser of order) {
    warnChromium(browser);
    const scan = scanBrowser(browser, host, SESSION_COOKIE_NAMES, {
      home: opts.home,
      platform,
      env: opts.env,
      keychainPassword: opts.keychainPassword,
      dpapiUnprotect: opts.dpapiUnprotect,
      linuxKeyringPassword: opts.linuxKeyringPassword,
    });
    const profile = scan.profiles.find((p) => p.cookies.some((c) => (SESSION_COOKIE_NAMES as readonly string[]).includes(c.name)));
    if (profile) {
      hit = { browser, profile: profile.profile, cookies: profile.cookies };
      break;
    }
    notes.push(describeScan(scan, host));
  }

  if (!hit) {
    const where = opts.browser ? opts.browser : order.join('/');
    const where2 = opts.browser ? 'that browser' : 'one of them';
    const platformHint =
      platform === 'win32'
        ? ' On Windows, Firefox is the browser this can read (Zen, LibreWolf, Floorp and Waterfox too); Chrome and Edge are app-bound.'
        : platform === 'linux'
          ? ' On Linux, Firefox and its forks always work; Chromium browsers only with the basic password store.'
          : '';
    throw new Error(
      `no Canvas session cookie (${SESSION_COOKIE_NAMES.join(' / ')}) for ${host} in ${where}. The simplest fix is an access token: run \`collected connect canvas --token\` and paste one from ${TOKEN_HOWTO}. Otherwise open https://${host} in ${where2} and sign in first, or paste the cookie in Settings → Sources.${platformHint}\n${notes.map((n) => `  ${n}`).join('\n')}`,
    );
  }

  const names = SESSION_COOKIE_NAMES.filter((n) => hit!.cookies.some((c) => c.name === n));
  log(`found ${names.length} session cookie${names.length === 1 ? '' : 's'} for ${host} in ${hit.browser} profile ${hit.profile}: ${names.join(', ')}`);

  if (opts.dryRun) {
    log('dry run: nothing sent.');
    return { browser: hit.browser, profile: hit.profile, names, posted: false };
  }

  const api = opts.api ?? (await openApi(cfg));
  const res = await api.postCanvasCookie({ cookieHeader: cookieHeader(hit.cookies), baseUrl: `https://${host}` });
  const outcome = (res.outcome ?? {}) as { ok?: boolean; result?: { counts?: unknown } };
  if (outcome.ok) log(`cookie accepted; Canvas synced: ${JSON.stringify(outcome.result?.counts ?? {})}`);
  else log(`cookie stored, but the first sync did not succeed: ${JSON.stringify(res.outcome ?? res)}`);
  return { browser: hit.browser, profile: hit.profile, names, posted: true };
}

export interface ConnectTokenOptions {
  domain?: string;
  dryRun?: boolean;
  log: (s: string) => void;
  /** Reads the token at a prompt or from piped stdin; never an argv word. cli.ts passes its `readSecret`. */
  readSecret: () => Promise<string>;
  /** Injected in tests so the real server and the real Canvas are never touched. */
  api?: CanvasConnectApi;
  fetchImpl?: typeof fetch;
}

export interface ConnectTokenResult {
  host: string;
  /** Canvas's own name for the token's user, from `GET /api/v1/users/self`. */
  user: string;
  saved: boolean;
}

/** A token's shape, before any network: Canvas tokens are long opaque strings, and a pasted cookie or URL is not one. */
export function looksLikeCanvasToken(token: string): boolean {
  return token.length >= 20 && token.length <= 200 && !/\s|=|;|\//.test(token);
}

/**
 * `collected connect canvas --token`: prompt for a personal access token, prove it works against the Canvas host
 * (`GET /api/v1/users/self`, the cheapest authenticated call), then store it. The server replaces any stored cookie
 * with the token and the first sync runs right away, as the cookie flow does.
 */
export async function connectCanvasToken(cfg: AgentConfig, opts: ConnectTokenOptions): Promise<ConnectTokenResult> {
  const { log } = opts;
  const host = resolveHost(cfg, opts.domain);
  log(`Canvas access token for ${host} (${TOKEN_HOWTO}).`);
  const token = (await opts.readSecret()).trim();
  if (!looksLikeCanvasToken(token)) throw new Error('that does not look like a Canvas access token (a long string with no spaces, "=" or ";"); copy the token Canvas showed when you created it');

  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = `https://${host}/api/v1/users/self`;
  let res: Response;
  try {
    res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(20_000) });
  } catch (err) {
    throw new Error(`could not reach ${host}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (res.status === 401 || res.status === 403) throw new Error(`${host} rejected that token (${res.status}); nothing saved. Make a new one at ${TOKEN_HOWTO} and copy it whole.`);
  if (!res.ok) throw new Error(`${host} answered ${res.status} for /api/v1/users/self; nothing saved. Is that the right Canvas host? (--domain sets it)`);
  const text = (await res.text()).replace(/^while\(1\);/, '');
  let user = '';
  try {
    const me = JSON.parse(text) as { name?: unknown; short_name?: unknown; login_id?: unknown };
    user = String(me.name ?? me.short_name ?? me.login_id ?? '').trim();
  } catch {
    throw new Error(`${host} did not answer with JSON for /api/v1/users/self; nothing saved. Is that the right Canvas host? (--domain sets it)`);
  }
  log(`token works: ${host} knows it as ${user || 'a user'}.`);

  if (opts.dryRun) {
    log('dry run: nothing sent.');
    return { host, user, saved: false };
  }

  const api = opts.api ?? (await openApi(cfg));
  await api.send('PUT', '/api/sources/canvas/config', { baseUrl: `https://${host}`, accessToken: token });
  log('token saved; any stored browser session was replaced.');
  type SyncOutcome = { ok?: boolean; result?: { counts?: unknown }; error?: unknown };
  const sync = await api.send<{ outcome?: SyncOutcome }>('POST', '/api/sources/canvas/sync').catch((err: Error): { outcome: SyncOutcome } => ({ outcome: { ok: false, error: err.message } }));
  const outcome: SyncOutcome = sync.outcome ?? {};
  if (outcome.ok) log(`Canvas synced: ${JSON.stringify(outcome.result?.counts ?? {})}`);
  else log(`the first sync did not succeed: ${JSON.stringify(outcome.error ?? outcome)}`);
  return { host, user, saved: true };
}
