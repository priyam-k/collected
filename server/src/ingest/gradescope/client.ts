import * as cheerio from 'cheerio';
import makeFetchCookie from 'fetch-cookie';
import { CookieJar } from 'tough-cookie';
import type { Logger } from '../../lib/log.js';
import { NeedsAuthError } from '../types.js';

export const GRADESCOPE_BASE = 'https://www.gradescope.com';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

export interface GradescopeConfig {
  email: string;
  password: string;
  cookieJar?: unknown;
}

/**
 * Gradescope session over plain HTTP: the pages we read are server-rendered Rails.
 * Logs in only when a request lands on /login; the jar is persisted by the ingester.
 */
export class GradescopeClient {
  private readonly fetchWithCookies: typeof fetch;
  logins = 0;
  requestCount = 0;

  constructor(
    private readonly creds: { email: string; password: string },
    readonly jar: CookieJar,
    private readonly log: Logger,
    fetchImpl: typeof fetch = fetch,
    readonly baseUrl = GRADESCOPE_BASE,
  ) {
    this.fetchWithCookies = makeFetchCookie(fetchImpl, jar) as unknown as typeof fetch;
  }

  static async fromConfig(config: GradescopeConfig, log: Logger, fetchImpl?: typeof fetch): Promise<GradescopeClient> {
    let jar = new CookieJar();
    if (config.cookieJar) {
      try {
        jar = await CookieJar.deserialize(config.cookieJar as never);
      } catch {
        jar = new CookieJar();
      }
    }
    return new GradescopeClient({ email: config.email, password: config.password }, jar, log, fetchImpl);
  }

  private async raw(path: string, init: RequestInit = {}): Promise<Response> {
    this.requestCount++;
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    return this.fetchWithCookies(url, {
      ...init,
      redirect: 'follow',
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', ...(init.headers ?? {}) },
    });
  }

  private static landedOnLogin(res: Response, html: string): boolean {
    if (/\/login(\?|$)/.test(res.url)) return true;
    // Some responses render the login form without redirecting.
    return /<form[^>]+action="\/login"/.test(html) && /session\[password\]/.test(html);
  }

  /** GET an HTML page, logging in once if the session is gone. */
  async getHtml(path: string, signal?: AbortSignal): Promise<string> {
    let res = await this.raw(path, { signal });
    let html = await res.text();
    if (GradescopeClient.landedOnLogin(res, html) || res.status === 401) {
      await this.login(signal);
      res = await this.raw(path, { signal });
      html = await res.text();
      if (GradescopeClient.landedOnLogin(res, html)) throw new NeedsAuthError('Gradescope still shows the login page after logging in');
    }
    if (!res.ok) throw new Error(`Gradescope ${res.status} for ${path}`);
    return html;
  }

  async login(signal?: AbortSignal): Promise<void> {
    this.logins++;
    const page = await this.raw('/login', { signal });
    const html = await page.text();
    const $ = cheerio.load(html);
    const form = $('form[action="/login"]').first();
    if (!form.length) throw new Error('Gradescope login form not found');
    const body = new URLSearchParams();
    form.find('input').each((_, el) => {
      const name = $(el).attr('name');
      if (!name) return;
      const type = ($(el).attr('type') ?? '').toLowerCase();
      if (type === 'submit' || type === 'button') return;
      body.set(name, $(el).attr('value') ?? '');
    });
    body.set('session[email]', this.creds.email);
    body.set('session[password]', this.creds.password);
    body.set('session[remember_me]', '1');
    const res = await this.raw('/login', {
      method: 'POST',
      body,
      signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: `${this.baseUrl}/login`, Origin: this.baseUrl },
    });
    const after = await res.text();
    if (GradescopeClient.landedOnLogin(res, after) || /Invalid email\/password/i.test(after)) {
      throw new NeedsAuthError('Gradescope rejected the email/password');
    }
    this.log.info('gradescope login ok');
  }

  serializeJar(): Promise<unknown> {
    return this.jar.serialize();
  }
}
