import type { Env } from '../env.js';
import { NotConfiguredError } from '../ingest/types.js';
import { readText, withTimeout } from '../lib/http.js';

/**
 * Todoist OAuth 2.0 over plain fetch. The app is registered once by the operator at
 * https://developer.todoist.com/appconsole.html with `<PUBLIC_URL>/api/todoist/callback` as its redirect URL;
 * Todoist takes the redirect from that registration, so neither request below carries one.
 */
export const TODOIST_AUTHORIZE_URL = 'https://todoist.com/oauth/authorize';
export const TODOIST_TOKEN_URL = 'https://todoist.com/oauth/access_token';
export const TODOIST_REVOKE_URL = 'https://api.todoist.com/sync/v9/access_tokens/revoke';
/** `data:delete` is required: the push sync deletes the tasks it created when an assignment disappears at the source. */
export const TODOIST_SCOPE = 'data:read_write,data:delete';

const REQUEST_TIMEOUT_MS = 15_000;

export const todoistOAuthConfigured = (env: Env): boolean => !!(env.TODOIST_CLIENT_ID && env.TODOIST_CLIENT_SECRET);

export const todoistRedirectUri = (env: Env): string => `${env.PUBLIC_URL.replace(/\/$/, '')}/api/todoist/callback`;

function credentials(env: Env): { id: string; secret: string } {
  if (!env.TODOIST_CLIENT_ID || !env.TODOIST_CLIENT_SECRET) throw new NotConfiguredError('TODOIST_CLIENT_ID / TODOIST_CLIENT_SECRET are not set (see docs/self-host.md)');
  return { id: env.TODOIST_CLIENT_ID, secret: env.TODOIST_CLIENT_SECRET };
}

export function todoistAuthUrl(env: Env, state: string): string {
  const { id } = credentials(env);
  const u = new URL(TODOIST_AUTHORIZE_URL);
  u.searchParams.set('client_id', id);
  u.searchParams.set('scope', TODOIST_SCOPE);
  u.searchParams.set('state', state);
  return u.toString();
}

const FORM = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };

/** Swaps the authorization code for a token. Todoist tokens do not expire; there is no refresh token. */
export async function exchangeTodoistCode(env: Env, code: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const { id, secret } = credentials(env);
  const res = await fetchImpl(TODOIST_TOKEN_URL, {
    method: 'POST',
    headers: FORM,
    body: new URLSearchParams({ client_id: id, client_secret: secret, code }),
    signal: withTimeout(undefined, REQUEST_TIMEOUT_MS),
    redirect: 'manual',
  });
  const text = await readText(res, 64 * 1024);
  let parsed: { access_token?: unknown; error?: unknown } = {};
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    // not JSON; handled below
  }
  if (!res.ok || typeof parsed.access_token !== 'string' || !parsed.access_token) {
    // Status and Todoist's error code only: the body could hold a token, so it never reaches a log or a URL.
    throw new Error(`Todoist token exchange failed (${res.status}${typeof parsed.error === 'string' ? `: ${parsed.error}` : ''})`);
  }
  return parsed.access_token;
}

/** Best effort. A failed revoke still disconnects locally; the token is then an orphan the user can revoke from Todoist. */
export async function revokeTodoistToken(env: Env, token: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (!todoistOAuthConfigured(env)) return false;
  const { id, secret } = credentials(env);
  try {
    const res = await fetchImpl(TODOIST_REVOKE_URL, {
      method: 'POST',
      headers: FORM,
      body: new URLSearchParams({ client_id: id, client_secret: secret, access_token: token }),
      signal: withTimeout(undefined, REQUEST_TIMEOUT_MS),
      redirect: 'manual',
    });
    await readText(res, 16 * 1024).catch(() => '');
    return res.ok;
  } catch {
    return false;
  }
}
