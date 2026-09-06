import { readFileSync } from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import { CookieJar } from 'tough-cookie';
import { GradescopeClient } from './client.js';

const here = path.resolve(import.meta.dirname, 'fixtures');
export const loadGsFixture = (name: string): string => readFileSync(path.join(here, name), 'utf8');

export interface FixtureOptions {
  /** Start logged out: the first page request redirects to /login until a POST /login happens. */
  requireLogin?: boolean;
  /** Reject the login POST (wrong password). */
  rejectLogin?: boolean;
}

/** Gradescope client answering from fixtures. Tracks whether we are "logged in". */
export function fixtureGradescopeClient(opts: FixtureOptions = {}): GradescopeClient & { calls: string[] } {
  let loggedIn = !opts.requireLogin;
  const calls: string[] = [];
  const html = (body: string, url: string, status = 200) => {
    const res = new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
    Object.defineProperty(res, 'url', { value: url, configurable: true });
    return res;
  };
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${new URL(url).pathname}`);
    const p = new URL(url).pathname;
    if (p === '/login' && method === 'POST') {
      if (opts.rejectLogin) return html(loadGsFixture('login.html') + '<div class="alert">Invalid email/password combination.</div>', 'https://www.gradescope.com/login');
      loggedIn = true;
      return html('<html><body>redirected</body></html>', 'https://www.gradescope.com/account');
    }
    if (p === '/login') return html(loadGsFixture('login.html'), 'https://www.gradescope.com/login');
    if (!loggedIn) return html(loadGsFixture('login.html'), 'https://www.gradescope.com/login');
    if (p === '/account') return html(loadGsFixture('account.html'), url);
    if (p === '/courses/1373147') return html(loadGsFixture('student-course.html'), url);
    if (p === '/courses/1387050')
      return html(loadGsFixture('student-course.html').replace(/1373147/g, '1387050').replace(/CMSC 422/g, 'MATH423').replace(/84998/g, '85998').replace(/HW02: Decision Trees/, 'Homework 1'), url);
    if (p === '/courses/1369005/assignments') return html(loadGsFixture('instructor-assignments.html'), url);
    return html('<html><body>not found</body></html>', url, 404);
  };
  const client = new GradescopeClient({ email: 'x@umd.edu', password: 'pw' }, new CookieJar(), pino({ level: 'silent' }), fakeFetch) as GradescopeClient & { calls: string[] };
  client.calls = calls;
  return client;
}
