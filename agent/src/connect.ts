import { openApi } from './api.js';
import type { AgentConfig } from './config.js';
import { BROWSER_ORDER, isBrowserId, scanBrowser, type BrowserId, type FoundCookie, type KeychainReader } from './browser-cookies.js';

/*
 * `collected connect canvas`: read the Canvas session cookie out of a local browser and hand it to the server,
 * replacing local/canvas_cookie.py. Only the session cookies leave this machine, over the server URL that
 * agent.json already validated. Cookie values are never printed — names and the host only.
 */

/** The only cookies that are sent; UMD's Canvas sets `canvas_session`, older instances the `_normandy` pair. */
export const SESSION_COOKIE_NAMES = ['canvas_session', '_normandy_session', '_legacy_normandy_session'] as const;

export const DEFAULT_CANVAS_HOST = 'umd.instructure.com';

/** Just the piece of the server API that connect needs; the real `Api` satisfies it, tests pass a fake. */
export interface CanvasConnectApi {
  postCanvasCookie(body: { cookieHeader: string; baseUrl?: string }): Promise<{ ok: boolean; outcome: unknown }>;
}

export interface ConnectOptions {
  browser?: string;
  domain?: string;
  dryRun?: boolean;
  log: (s: string) => void;
  /** Injected in tests so the real server/Keychain/browser are never touched. */
  api?: CanvasConnectApi;
  keychainPassword?: KeychainReader;
  home?: string;
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
  const host = (opts.domain ?? cfg.canvasHost ?? DEFAULT_CANVAS_HOST).trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!host) throw new Error('no Canvas host; pass --domain');
  const order: BrowserId[] = opts.browser ? [opts.browser as BrowserId] : BROWSER_ORDER;

  log('reading the Canvas session cookie from your browser. macOS may ask for your Keychain password — click "Allow" (not "Always Allow").');

  const notes: string[] = [];
  let hit: { browser: BrowserId; profile: string; cookies: FoundCookie[] } | null = null;
  for (const browser of order) {
    const scan = scanBrowser(browser, host, SESSION_COOKIE_NAMES, { home: opts.home, keychainPassword: opts.keychainPassword });
    if (!scan.installed) continue;
    if (scan.error) {
      notes.push(`${browser}: ${scan.error}`);
      continue;
    }
    const profile = scan.profiles.find((p) => p.cookies.some((c) => (SESSION_COOKIE_NAMES as readonly string[]).includes(c.name)));
    if (profile) {
      hit = { browser, profile: profile.profile, cookies: profile.cookies };
      break;
    }
  }

  if (!hit) {
    const where = opts.browser ? opts.browser : order.join('/');
    const hint = notes.length ? ` (${notes.join('; ')})` : '';
    throw new Error(
      `no Canvas session cookie (${SESSION_COOKIE_NAMES.join(' / ')}) for ${host} in ${where}; open https://${host} in that browser and sign in first${hint}`,
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
