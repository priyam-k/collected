import makeFetchCookie from 'fetch-cookie';
import { Cookie, CookieJar } from 'tough-cookie';
import type { Logger } from '../../lib/log.js';
import { NeedsAuthError, NotConfiguredError } from '../types.js';

export interface CanvasConfig {
  baseUrl: string;
  cookieHeader?: string;
  cookieJar?: unknown; // tough-cookie serialized jar, maintained by us
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
  const host = new URL(baseUrl).hostname;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!name || name.toLowerCase() === 'cookie:') continue;
    const cookie = new Cookie({ key: name, value, domain: host, path: '/', secure: true, httpOnly: true });
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
  throw new NotConfiguredError('Canvas has no session cookie yet');
}

export class CanvasClient {
  private readonly fetchWithCookies: typeof fetch;
  requestCount = 0;

  constructor(
    readonly baseUrl: string,
    readonly jar: CookieJar,
    private readonly log: Logger,
    fetchImpl: typeof fetch = fetch,
  ) {
    this.fetchWithCookies = makeFetchCookie(fetchImpl, jar) as unknown as typeof fetch;
  }

  static async fromConfig(config: CanvasConfig, log: Logger, fetchImpl?: typeof fetch): Promise<CanvasClient> {
    return new CanvasClient(config.baseUrl, await jarFromConfig(config), log, fetchImpl);
  }

  /** One GET. Throws NeedsAuthError on anything that looks like a dead session. */
  async getRaw(path: string, params: Params = {}, signal?: AbortSignal, opts: { deniedIsNull?: boolean } = {}): Promise<{ data: unknown; link: Record<string, string> }> {
    const url = buildUrl(this.baseUrl, path, params);
    this.requestCount++;
    const res = await this.fetchWithCookies(url, {
      signal,
      headers: {
        Accept: 'application/json+canvas-string-ids, application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 collected/0.1',
      },
      redirect: 'follow',
    });
    const ct = res.headers.get('content-type') ?? '';
    const finalUrl = res.url || url;
    if (opts.deniedIsNull && [401, 403, 404].includes(res.status) && !/\/login(\/|\?|$)/.test(finalUrl)) return { data: null, link: {} };
    if (res.status === 401 || res.status === 403 || /\/login(\/|\?|$)/.test(finalUrl)) {
      throw new NeedsAuthError(`Canvas responded ${res.status} at ${safePath(finalUrl)}`);
    }
    if (!ct.includes('json')) {
      throw new NeedsAuthError(`Canvas returned ${ct || 'non-JSON'} for ${path}; the session is probably gone`);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Canvas ${res.status} for ${path}: ${body.slice(0, 200)}`);
    }
    const remainingHeader = res.headers.get('x-rate-limit-remaining');
    if (remainingHeader !== null) {
      const remaining = Number(remainingHeader);
      if (Number.isFinite(remaining) && remaining < 100) {
        this.log.debug({ remaining }, 'canvas rate limit low; pausing');
        await sleep(1500);
      }
    }
    const text = await res.text();
    return { data: JSON.parse(stripCanvasPrefix(text)), link: parseLinkHeader(res.headers.get('link')) };
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
      if (err instanceof NeedsAuthError) throw err;
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
      if (err instanceof NeedsAuthError) throw err;
      this.log.debug({ err: (err as Error).message, path }, 'canvas optional endpoint failed');
      return null;
    }
  }

  async tryGetAll<T>(path: string, params: Params = {}, opts: { maxPages?: number; signal?: AbortSignal } = {}): Promise<T[]> {
    try {
      return await this.getAll<T>(path, params, opts);
    } catch (err) {
      if (err instanceof NeedsAuthError) throw err;
      this.log.debug({ err: (err as Error).message, path }, 'canvas optional list failed');
      return [];
    }
  }

  serializeJar(): Promise<unknown> {
    return this.jar.serialize();
  }
}
