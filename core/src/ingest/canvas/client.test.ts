import pino from 'pino';
import { CookieJar } from 'tough-cookie';
import { describe, expect, it } from 'vitest';
import { NeedsAuthError } from '../types.js';
import { CanvasClient, buildUrl, jarFromCookieHeader, needsAuthMessage, parseLinkHeader, stripCanvasPrefix } from './client.js';

const log = pino({ level: 'silent' });
const withUrl = (res: Response, url = 'https://x/api/v1/things') => {
  Object.defineProperty(res, 'url', { value: url, configurable: true });
  return res;
};
const json = (body: unknown, init: ResponseInit = {}) =>
  withUrl(new Response(`while(1);${JSON.stringify(body)}`, { status: 200, ...init, headers: { 'content-type': 'application/json; charset=utf-8', ...(init.headers ?? {}) } }));

describe('canvas client', () => {
  it('parses Link headers and strips the JSON prefix', () => {
    const link = '<https://x/api/v1/courses?page=2&per_page=10>; rel="next",<https://x/api/v1/courses?page=1>; rel="first"';
    expect(parseLinkHeader(link).next).toBe('https://x/api/v1/courses?page=2&per_page=10');
    expect(stripCanvasPrefix('while(1);[1]')).toBe('[1]');
    expect(buildUrl('https://x', '/api/v1/a', { 'include[]': ['term', 'x'], per_page: 5 })).toBe('https://x/api/v1/a?include%5B%5D=term&include%5B%5D=x&per_page=5');
  });

  it('follows pagination', async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('page=2')) return json([3]);
      return json([1, 2], { headers: { link: '<https://x/api/v1/things?page=2>; rel="next"' } });
    };
    const c = new CanvasClient('https://x', new CookieJar(), log, fetchImpl);
    expect(await c.getAll<number>('/api/v1/things')).toEqual([1, 2, 3]);
    expect(calls.length).toBe(2);
  });

  it('turns 401, HTML, and login redirects into NeedsAuthError', async () => {
    const mk = (res: Response) => new CanvasClient('https://x', new CookieJar(), log, async () => res);
    await expect(mk(withUrl(new Response('{"status":"unauthenticated"}', { status: 401, headers: { 'content-type': 'application/json' } }))).get('/a')).rejects.toBeInstanceOf(NeedsAuthError);
    await expect(mk(withUrl(new Response('<html>login</html>', { status: 200, headers: { 'content-type': 'text/html' } }))).get('/a')).rejects.toBeInstanceOf(NeedsAuthError);
    const redirected = withUrl(new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }), 'https://x/login/saml');
    await expect(mk(redirected).get('/a')).rejects.toBeInstanceOf(NeedsAuthError);
  });

  it('builds a jar from a pasted cookie header and round-trips it', async () => {
    const jar = await jarFromCookieHeader('_normandy_session=abc; canvas_session=def; log_session_id=1', 'https://umd.instructure.com');
    const cookies = await jar.getCookies('https://umd.instructure.com/api/v1/x');
    expect(cookies.map((c) => c.key).sort()).toEqual(['_normandy_session', 'canvas_session', 'log_session_id']);
    const serialized = await jar.serialize();
    const back = await CookieJar.deserialize(serialized);
    expect((await back.getCookies('https://umd.instructure.com/')).length).toBe(3);
  });

  it('keeps updated cookies from Set-Cookie', async () => {
    const jar = await jarFromCookieHeader('_normandy_session=old', 'https://x.test');
    const fetchImpl: typeof fetch = async () =>
      withUrl(json([], { headers: { 'set-cookie': '_normandy_session=new; Path=/; Secure; HttpOnly' } }), 'https://x.test/api/v1/a');
    const c = new CanvasClient('https://x.test', jar, log, fetchImpl);
    await c.get('/api/v1/a');
    const cookies = await jar.getCookies('https://x.test/');
    expect(cookies.find((k) => k.key === '_normandy_session')?.value).toBe('new');
  });
});

describe('canvas client with an access token', () => {
  const TOKEN = '7~tokentokentokentokentokentoken';
  const capture = () => {
    const calls: { url: string; auth: string | null; cookie: string | null }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      calls.push({ url: String(input), auth: headers.get('authorization'), cookie: headers.get('cookie') });
      return json({ ok: true }, { headers: { 'set-cookie': 'canvas_session=rotated; Path=/; Secure; HttpOnly' } });
    };
    return { calls, fetchImpl };
  };

  it('fromConfig picks the token over a stored cookie, sends Bearer on every request and keeps no jar', async () => {
    const { calls, fetchImpl } = capture();
    const c = await CanvasClient.fromConfig({ baseUrl: 'https://x', accessToken: TOKEN, cookieHeader: 'canvas_session=old' }, log, fetchImpl);
    expect(c.authMode).toBe('token');
    expect(c.jar).toBeNull();
    await c.get('/api/v1/users/self');
    await c.get('/api/v1/files/1/public_url');
    expect(calls.map((k) => k.auth)).toEqual([`Bearer ${TOKEN}`, `Bearer ${TOKEN}`]);
    // No cookie goes out, and the one Canvas set back was not kept for the second request.
    expect(calls.map((k) => k.cookie)).toEqual([null, null]);
    expect(await c.serializeJar()).toBeNull();
  });

  it('without a token the cookie path is unchanged: a jar, no Authorization header', async () => {
    const { calls, fetchImpl } = capture();
    const c = await CanvasClient.fromConfig({ baseUrl: 'https://x', cookieHeader: 'canvas_session=abc' }, log, fetchImpl);
    expect(c.authMode).toBe('cookie');
    expect(c.jar).not.toBeNull();
    await c.get('/api/v1/users/self');
    expect(calls[0]!.auth).toBeNull();
    expect(calls[0]!.cookie).toBe('canvas_session=abc');
  });

  it('a 401 with a token is "rejected the access token", never a session message', async () => {
    const mk = (res: Response) => new CanvasClient('https://x', null, log, async () => res, { accessToken: TOKEN });
    const denied = mk(withUrl(new Response('{"errors":[{"message":"Invalid access token."}]}', { status: 401, headers: { 'content-type': 'application/json' } })));
    const err = await denied.get('/api/v1/users/self').catch((e: Error) => e);
    expect(err).toBeInstanceOf(NeedsAuthError);
    expect((err as Error).message).toMatch(/Canvas rejected the access token/);
    expect((err as Error).message).not.toMatch(/session/);
    expect(needsAuthMessage(denied)).toBe('Canvas rejected the access token; replace it in Settings → Sources');
    expect(needsAuthMessage(new CanvasClient('https://x', new CookieJar(), log))).toBe('Canvas session expired; reconnect it in Settings → Sources');
    // A resource-level denial still resolves to null with a token, as it does with a cookie.
    expect(await mk(withUrl(new Response('{}', { status: 403, headers: { 'content-type': 'application/json' } }))).getResource('/api/v1/files/9')).toBeNull();
  });
});
