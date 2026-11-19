import type { CoreConfig } from '../config.js';
import { NeedsAuthError, NotConfiguredError } from '../ingest/types.js';
import { readText, withTimeout } from '../lib/http.js';

/**
 * Todoist OAuth 2.0 over plain fetch. The app is registered once by the operator at
 * https://developer.todoist.com/appconsole.html with `<PUBLIC_URL>/api/todoist/callback` as its redirect URL;
 * Todoist takes the redirect from that registration, so neither request below carries one.
 */
export const TODOIST_AUTHORIZE_URL = 'https://todoist.com/oauth/authorize';
/** Code exchange and refresh share one endpoint; `grant_type` tells them apart. */
export const TODOIST_TOKEN_URL = 'https://api.todoist.com/oauth/access_token';
export const TODOIST_REVOKE_URL = 'https://api.todoist.com/api/v1/access_tokens';
/** `data:delete` is required: the push sync deletes the tasks it created when an assignment disappears at the source. */
export const TODOIST_SCOPE = 'data:read_write,data:delete';

const REQUEST_TIMEOUT_MS = 15_000;

export const todoistOAuthConfigured = (env: CoreConfig): boolean => !!(env.TODOIST_CLIENT_ID && env.TODOIST_CLIENT_SECRET);

export const todoistRedirectUri = (env: CoreConfig): string => `${env.PUBLIC_URL.replace(/\/$/, '')}/api/todoist/callback`;

function credentials(env: CoreConfig): { id: string; secret: string } {
  if (!env.TODOIST_CLIENT_ID || !env.TODOIST_CLIENT_SECRET) throw new NotConfiguredError('TODOIST_CLIENT_ID / TODOIST_CLIENT_SECRET are not set (see docs/self-host.md)');
  return { id: env.TODOIST_CLIENT_ID, secret: env.TODOIST_CLIENT_SECRET };
}

export function todoistAuthUrl(env: CoreConfig, state: string): string {
  const { id } = credentials(env);
  const u = new URL(TODOIST_AUTHORIZE_URL);
  u.searchParams.set('client_id', id);
  u.searchParams.set('scope', TODOIST_SCOPE);
  u.searchParams.set('state', state);
  // Required once the app has more than one redirect URL registered; must match the console entry exactly.
  u.searchParams.set('redirect_uri', todoistRedirectUri(env));
  return u.toString();
}

const FORM = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };

/** What a token answer leaves us holding. A legacy Todoist app (refresh tokens off) sends no refresh token and a token that does not expire. */
export interface TodoistGrant {
  token: string;
  refreshToken?: string;
  /** ISO time the access token stops working; only meaningful alongside `refreshToken`. */
  expiresAt?: string;
}

/** Thrown when Todoist says the refresh token itself is dead (`invalid_grant`): the person has to connect again. */
export class TodoistReauthError extends NeedsAuthError {}

async function tokenRequest(env: CoreConfig, params: Record<string, string>, what: string, fetchImpl: typeof fetch, now: () => number): Promise<TodoistGrant> {
  const { id, secret } = credentials(env);
  const res = await fetchImpl(TODOIST_TOKEN_URL, {
    method: 'POST',
    headers: FORM,
    body: new URLSearchParams({ client_id: id, client_secret: secret, ...params }),
    signal: withTimeout(undefined, REQUEST_TIMEOUT_MS),
    redirect: 'manual',
  });
  const text = await readText(res, 64 * 1024);
  let parsed: { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; error?: unknown } = {};
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    // not JSON; handled below
  }
  if (!res.ok || typeof parsed.access_token !== 'string' || !parsed.access_token) {
    // Status and Todoist's error code only: the body could hold a token, so it never reaches a log or a URL.
    const code = typeof parsed.error === 'string' ? parsed.error : undefined;
    if (what === 'refresh' && code === 'invalid_grant') throw new TodoistReauthError('Todoist no longer accepts the refresh token; connect Todoist again in Settings → Sources');
    throw new Error(`Todoist token ${what} failed (${res.status}${code ? `: ${code}` : ''})`);
  }
  const grant: TodoistGrant = { token: parsed.access_token };
  if (typeof parsed.refresh_token === 'string' && parsed.refresh_token) grant.refreshToken = parsed.refresh_token;
  // Legacy apps answer with a ten-year expires_in and no refresh token: nothing to renew with, so no expiry is kept.
  if (grant.refreshToken && typeof parsed.expires_in === 'number' && parsed.expires_in > 0) grant.expiresAt = new Date(now() + parsed.expires_in * 1000).toISOString();
  return grant;
}

/** Swaps the authorization code for a grant. Refresh-enabled apps get an hour-long access token plus a refresh token. */
export function exchangeTodoistCode(env: CoreConfig, code: string, fetchImpl: typeof fetch = fetch, now: () => number = Date.now): Promise<TodoistGrant> {
  return tokenRequest(env, { code, redirect_uri: todoistRedirectUri(env) }, 'exchange', fetchImpl, now);
}

/**
 * Trades a refresh token for a new access token. Todoist rotates the refresh token on every use; a reuse inside a
 * minute answers the same access token without a refresh token (keep the old one), a reuse after that revokes every
 * token the person has for the app. Hence the one-at-a-time rule in core/src/ingest/todoist/token.ts.
 */
export function refreshTodoistToken(env: CoreConfig, refreshToken: string, fetchImpl: typeof fetch = fetch, now: () => number = Date.now): Promise<TodoistGrant> {
  return tokenRequest(env, { grant_type: 'refresh_token', refresh_token: refreshToken }, 'refresh', fetchImpl, now);
}

/** Best effort. A failed revoke still disconnects locally; the token is then an orphan the user can revoke from Todoist. */
export async function revokeTodoistToken(env: CoreConfig, token: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (!todoistOAuthConfigured(env)) return false;
  const { id, secret } = credentials(env);
  try {
    // The v1 revoke is a DELETE with the credentials as query parameters; that is Todoist's shape, not a choice.
    const u = new URL(TODOIST_REVOKE_URL);
    u.search = new URLSearchParams({ client_id: id, client_secret: secret, access_token: token }).toString();
    const res = await fetchImpl(u, { method: 'DELETE', headers: { Accept: 'application/json' }, signal: withTimeout(undefined, REQUEST_TIMEOUT_MS), redirect: 'manual' });
    await readText(res, 16 * 1024).catch(() => '');
    return res.ok;
  } catch {
    return false;
  }
}
