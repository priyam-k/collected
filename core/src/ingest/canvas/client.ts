import makeFetchCookie from 'fetch-cookie';
import { Cookie, CookieJar } from 'tough-cookie';
import { MB, readText, safeUrlForLog, withTimeout } from '../../lib/http.js';
import type { Logger } from '../../lib/log.js';
import { NeedsAuthError, NotConfiguredError } from '../types.js';

/** One Canvas response: a page of 100 assignments with descriptions is well under 1 MB. */
export const MAX_RESPONSE_BYTES = 8 * MB;
export const REQUEST_TIMEOUT_MS = 45_000;

/** A fetch that died because the run was cancelled must not look like "that endpoint is unavailable". */
export const isAbort = (err: unknown, signal?: AbortSignal): boolean => !!signal?.aborted || (err instanceof Error && err.name === 'AbortError');

export interface CanvasConfig {
  baseUrl: string;
  /** A personal access token (Canvas → Account → Settings → New Access Token). When set, the cookie fields are ignored. */
  accessToken?: string;
  cookieHeader?: string;
  cookieJar?: unknown; // tough-cookie serialized jar, maintained by us
}

export type CanvasAuthMode = 'token' | 'cookie';

/** Which credential a config would use: the token wins when both are present. */
export const canvasAuthMode = (config: Pick<CanvasConfig, 'accessToken'>): CanvasAuthMode => (config.accessToken?.trim() ? 'token' : 'cookie');

/** What the dashboard says when this client's credential stops working; the token wording never says "session". */
export function needsAuthMessage(client: Pick<CanvasClient, 'authMode'>): string {
  return client.authMode === 'token' ? 'Canvas rejected the access token; replace it in Settings → Sources' : 'Canvas session expired; reconnect it in Settings → Sources';
}

export type Params = Record<string, string | number | boolean | Array<string | number> | undefined>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function safePath(u: string): string {
  try {
    return new URL(u).pathname;
  } catch {
    return u;
  }
}

/** Parses a Link header into rel → url. */
export function parseLinkHeader(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(',')) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="([^"]+)"/);
    if (m) out[m[2]!] = m[1]!;
  }
  return out;
}

/** Canvas prefixes JSON with `while(1);` when the request carries a session cookie. */
export function stripCanvasPrefix(text: string): string {
  return text.startsWith('while(1);') ? text.slice(9) : text;
}

export function buildUrl(baseUrl: string, path: string, params: Params = {}): string {
  const url = new URL(path.startsWith('http') ? path : `${baseUrl.replace(/\/$/, '')}${path.startsWith('/') ? '' : '/'}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) for (const x of v) url.searchParams.append(k.endsWith('[]') ? k : `${k}[]`, String(x));
    else url.searchParams.set(k, String(v));
  }
  return url.toString();
}

/** Builds a jar from a pasted "a=b; c=d" cookie header. */
export async function jarFromCookieHeader(header: string, baseUrl: string): Promise<CookieJar> {
  const jar = new CookieJar();
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!name || name.toLowerCase() === 'cookie:') continue;
    // No explicit domain: the jar makes it host-only, so the session never travels to a sibling subdomain.
    const cookie = new Cookie({ key: name, value, path: '/', secure: true, httpOnly: true });
    await jar.setCookie(cookie, baseUrl);
  }
  return jar;
}

export async function jarFromConfig(config: CanvasConfig): Promise<CookieJar> {
  if (config.cookieJar) {
    try {
      return await CookieJar.deserialize(config.cookieJar as never);
    } catch {
      // fall through to the header
    }
  }
  if (config.cookieHeader?.trim()) return jarFromCookieHeader(config.cookieHeader, config.baseUrl);
  throw new NotConfiguredError('Canvas has no access token or session cookie yet');
}

export class CanvasClient {
  private readonly doFetch: typeof fetch;
  /** `token`: `Authorization: Bearer` on every request, no jar. `cookie`: the browser session in a jar that Canvas rotates. */
  readonly authMode: CanvasAuthMode;
  private readonly accessToken?: string;
  requestCount = 0;

  /**
   * With a jar the client is a browser session; with `opts.accessToken` it is an API client and `jar` may be null.
   * Everything the ingester calls is `/api/v1/*`, which accepts either; nothing here needs a cookie once a token is set.
   */
  constructor(
    readonly baseUrl: string,
    readonly jar: CookieJar | null,
    private readonly log: Logger,
    fetchImpl: typeof fetch = fetch,
    opts: { accessToken?: string } = {},
  ) {
    this.authMode = canvasAuthMode(opts);
    this.accessToken = this.authMode === 'token' ? opts.accessToken!.trim() : undefined;
    // A token travels on its own: a plain fetch, so no cookie Canvas sets back is kept or sent, and a second
    // credential never rides along with the first.
    this.doFetch = this.authMode === 'cookie' && jar ? (makeFetchCookie(fetchImpl, jar) as unknown as typeof fetch) : fetchImpl;
  }

  static async fromConfig(config: CanvasConfig, log: Logger, fetchImpl?: typeof fetch): Promise<CanvasClient> {
    if (canvasAuthMode(config) === 'token') return new CanvasClient(config.baseUrl, null, log, fetchImpl, { accessToken: config.accessToken });
    return new CanvasClient(config.baseUrl, await jarFromConfig(config), log, fetchImpl);
  }

  /** One GET. Throws NeedsAuthError on anything that looks like a dead session or a rejected token. */
  async getRaw(path: string, params: Params = {}, signal?: AbortSignal, opts: { deniedIsNull?: boolean } = {}): Promise<{ data: unknown; link: Record<string, string> }> {
    const url = buildUrl(this.baseUrl, path, params);
    // Absolute URLs come from Link headers; a hostile upstream must not steer the session elsewhere.
    if (new URL(url).origin !== new URL(this.baseUrl).origin) throw new Error(`refusing to fetch ${safeUrlForLog(url)}: not on the Canvas host`);
    this.requestCount++;
    const res = await this.doFetch(url, {
      signal: withTimeout(signal, REQUEST_TIMEOUT_MS),
      headers: {
        Accept: 'application/json+canvas-string-ids, application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 collected/0.1',
        ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
      },
      redirect: 'follow',
    });
    const ct = res.headers.get('content-type') ?? '';
    const finalUrl = res.url || url;
    if (opts.deniedIsNull && [401, 403, 404].includes(res.status) && !/\/login(\/|\?|$)/.test(finalUrl)) return { data: null, link: {} };
    if (res.status === 401 || res.status === 403 || /\/login(\/|\?|$)/.test(finalUrl)) {
      if (this.authMode === 'token') throw new NeedsAuthError(`Canvas rejected the access token (${res.status} at ${safePath(finalUrl)})`);
      throw new NeedsAuthError(`Canvas responded ${res.status} at ${safePath(finalUrl)}`);
    }
    if (!ct.includes('json')) {
      if (this.authMode === 'token') throw new NeedsAuthError(`Canvas returned ${ct || 'non-JSON'} for ${path}; the access token was not accepted`);
      throw new NeedsAuthError(`Canvas returned ${ct || 'non-JSON'} for ${path}; the session is probably gone`);
    }
    if (!res.ok) {
      const body = await readText(res, 64 * 1024).catch(() => '');
      throw new Error(`Canvas ${res.status} for ${safeUrlForLog(url)}: ${body.slice(0, 200)}`);
    }
    const remainingHeader = res.headers.get('x-rate-limit-remaining');
    if (remainingHeader !== null) {
      const remaining = Number(remainingHeader);
      if (Number.isFinite(remaining) && remaining < 100) {
        this.log.debug({ remaining }, 'canvas rate limit low; pausing');
        await sleep(1500);
      }
    }
    const text = await readText(res, MAX_RESPONSE_BYTES);
    const link = parseLinkHeader(res.headers.get('link'));
    if (link.next && new URL(link.next, url).origin !== new URL(this.baseUrl).origin) delete link.next;
    return { data: JSON.parse(stripCanvasPrefix(text)), link };
  }

  async get<T>(path: string, params: Params = {}, signal?: AbortSignal): Promise<T> {
    return (await this.getRaw(path, params, signal)).data as T;
  }

  /**
   * One optional resource, such as a file a page links to. A 401/403/404 here is about that resource (locked,
   * hidden, deleted), not the session, so it resolves to null instead of flagging the source as needing auth.
   * Only call it after the run has already made an authenticated request.
   */
  async getResource<T>(path: string, signal?: AbortSignal): Promise<T | null> {
    try {
      return (await this.getRaw(path, {}, signal, { deniedIsNull: true })).data as T | null;
    } catch (err) {
      if (err instanceof NeedsAuthError || isAbort(err, signal)) throw err;
      this.log.debug({ err: (err as Error).message, path }, 'canvas optional resource failed');
      return null;
    }
  }

  /** Follows Link rel=next until exhausted or maxPages. */
  async getAll<T>(path: string, params: Params = {}, opts: { maxPages?: number; signal?: AbortSignal } = {}): Promise<T[]> {
    const out: T[] = [];
    let next: string | undefined = buildUrl(this.baseUrl, path, { per_page: 100, ...params });
    let pages = 0;
    while (next && pages < (opts.maxPages ?? 20)) {
      const { data, link } = await this.getRaw(next, {}, opts.signal);
      if (Array.isArray(data)) out.push(...(data as T[]));
      next = link.next;
      pages++;
    }
    return out;
  }

  /** Same as get, but resolves to null instead of throwing on 404/403-style "feature disabled" errors. */
  async tryGet<T>(path: string, params: Params = {}, signal?: AbortSignal): Promise<T | null> {
    try {
      return await this.get<T>(path, params, signal);
    } catch (err) {
      if (err instanceof NeedsAuthError || isAbort(err, signal)) throw err;
      this.log.debug({ err: (err as Error).message, path }, 'canvas optional endpoint failed');
      return null;
    }
  }

  async tryGetAll<T>(path: string, params: Params = {}, opts: { maxPages?: number; signal?: AbortSignal } = {}): Promise<T[]> {
    try {
      return await this.getAll<T>(path, params, opts);
    } catch (err) {
      if (err instanceof NeedsAuthError || isAbort(err, opts.signal)) throw err;
      this.log.debug({ err: (err as Error).message, path }, 'canvas optional list failed');
      return [];
    }
  }

  /** The rotated session, for the ingester to store back; null for a token client, which has nothing that rotates. */
  async serializeJar(): Promise<unknown | null> {
    return this.jar ? this.jar.serialize() : null;
  }
}
