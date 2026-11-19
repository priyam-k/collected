import { describe, expect, it } from 'vitest';
import { TODOIST_TOKEN_URL } from '../../auth/todoist.js';
import { getSourceConfig, setSourceConfig } from '../../lib/sources.js';
import { testContext } from '../../test-util.js';
import { NeedsAuthError } from '../types.js';
import { TODOIST_BASE } from './client.js';
import { todoistApiForCtx } from './ingest.js';
import { currentTodoistToken } from './token.js';

/*
 * Refresh-enabled Todoist apps hand out hour-long access tokens (what made the source drop to needs_auth a few hours
 * after every connect). The token module renews ahead of expiry, renews once more when Todoist still says 401, keeps
 * the rotated refresh token, and never sends the same refresh token twice.
 */

const T0 = Date.parse('2026-11-18T12:00:00Z');

/** A fake Todoist: the token endpoint rotates, the API accepts only the newest access token. */
function fakeTodoist(opts: { refreshError?: { status: number; body: unknown } } = {}) {
  let n = 0;
  let live = 'access-0';
  const refreshes: string[] = [];
  const apiCalls: { token: string | null; path: string }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (`${url.origin}${url.pathname}` === TODOIST_TOKEN_URL) {
      const p = new URLSearchParams(String(init?.body));
      refreshes.push(p.get('refresh_token')!);
      if (opts.refreshError) return new Response(JSON.stringify(opts.refreshError.body), { status: opts.refreshError.status });
      n++;
      live = `access-${n}`;
      return Response.json({ access_token: live, token_type: 'Bearer', expires_in: 3600, refresh_token: `refresh-${n}` });
    }
    const token = (init?.headers as Record<string, string>)?.Authorization?.replace('Bearer ', '') ?? null;
    apiCalls.push({ token, path: url.pathname.replace('/api/v1', '') });
    if (token !== live) return new Response(JSON.stringify({ error: 'Unauthorized', error_code: 477 }), { status: 401 });
    return Response.json({ results: [], next_cursor: null });
  };
  return { fetchImpl, refreshes, apiCalls, expire: () => (live = 'gone') };
}

async function ctxWith(config: Record<string, unknown>) {
  const ctx = await testContext();
  ctx.env.TODOIST_CLIENT_ID = 'cid';
  ctx.env.TODOIST_CLIENT_SECRET = 'csecret';
  await setSourceConfig(ctx, 'todoist', config);
  return ctx;
}

describe('todoist access token', () => {
  it('uses a pasted token as it is, before and after a rejection', async () => {
    const ctx = await ctxWith({ token: 'pasted' });
    const td = fakeTodoist();
    expect(await currentTodoistToken(ctx, { fetchImpl: td.fetchImpl, now: () => T0 })).toBe('pasted');
    expect(await currentTodoistToken(ctx, { rejected: 'pasted', fetchImpl: td.fetchImpl, now: () => T0 })).toBe('pasted');
    expect(td.refreshes).toEqual([]);
  });

  it('renews ahead of expiry, keeps the rotated refresh token, and leaves a fresh one alone', async () => {
    const ctx = await ctxWith({ token: 'access-0', refreshToken: 'refresh-0', expiresAt: new Date(T0 + 2 * 60_000).toISOString() });
    const td = fakeTodoist();
    expect(await currentTodoistToken(ctx, { fetchImpl: td.fetchImpl, now: () => T0 })).toBe('access-1');
    expect(td.refreshes).toEqual(['refresh-0']);
    expect(await getSourceConfig(ctx, 'todoist')).toEqual({ token: 'access-1', refreshToken: 'refresh-1', expiresAt: new Date(T0 + 3600_000).toISOString() });
    // Fifty minutes left: nothing to do.
    expect(await currentTodoistToken(ctx, { fetchImpl: td.fetchImpl, now: () => T0 + 10 * 60_000 })).toBe('access-1');
    expect(td.refreshes).toHaveLength(1);
  });

  it('renews a grant with no recorded expiry (one stored before expiry was tracked)', async () => {
    const ctx = await ctxWith({ token: 'access-0', refreshToken: 'refresh-0' });
    const td = fakeTodoist();
    expect(await currentTodoistToken(ctx, { fetchImpl: td.fetchImpl, now: () => T0 })).toBe('access-1');
  });

  it('renews once more when Todoist refuses the token mid-run, and the client retries the request', async () => {
    // The factory's clock is the real one, so the expiry is set from it: an hour left, no renewal up front.
    const ctx = await ctxWith({ token: 'access-0', refreshToken: 'refresh-0', expiresAt: new Date(Date.now() + 3600_000).toISOString() });
    const td = fakeTodoist();
    const api = await todoistApiForCtx(ctx, td.fetchImpl);
    td.expire(); // revoked or expired early on Todoist's side
    expect(await api.listProjects()).toEqual([]);
    expect(td.refreshes).toEqual(['refresh-0']);
    expect(td.apiCalls.map((c) => c.token)).toEqual(['access-0', 'access-1']);
    expect(api.base).toBe(TODOIST_BASE);
  });

  it('serialises renewals: racing callers send one refresh and all get the new token', async () => {
    const ctx = await ctxWith({ token: 'access-0', refreshToken: 'refresh-0', expiresAt: new Date(T0).toISOString() });
    const td = fakeTodoist();
    const tokens = await Promise.all([1, 2, 3].map(() => currentTodoistToken(ctx, { fetchImpl: td.fetchImpl, now: () => T0 })));
    expect(tokens).toEqual(['access-1', 'access-1', 'access-1']);
    expect(td.refreshes).toEqual(['refresh-0']);
    // A 401 reported against the old token after someone else renewed is answered from the store, no refresh.
    expect(await currentTodoistToken(ctx, { rejected: 'access-0', fetchImpl: td.fetchImpl, now: () => T0 })).toBe('access-1');
    expect(td.refreshes).toHaveLength(1);
  });

  it('a dead refresh token is a needs-auth, not an internal error', async () => {
    const ctx = await ctxWith({ token: 'access-0', refreshToken: 'refresh-0', expiresAt: new Date(T0).toISOString() });
    const td = fakeTodoist({ refreshError: { status: 400, body: { error: 'invalid_grant' } } });
    await expect(currentTodoistToken(ctx, { fetchImpl: td.fetchImpl, now: () => T0 })).rejects.toBeInstanceOf(NeedsAuthError);
    await expect(currentTodoistToken(ctx, { fetchImpl: td.fetchImpl, now: () => T0 })).rejects.toThrow(/connect Todoist again/);
    expect(await getSourceConfig(ctx, 'todoist')).toMatchObject({ token: 'access-0' }); // untouched: the person reconnects
  });

  it('a Todoist outage during renewal is an ordinary error', async () => {
    const ctx = await ctxWith({ token: 'access-0', refreshToken: 'refresh-0', expiresAt: new Date(T0).toISOString() });
    const td = fakeTodoist({ refreshError: { status: 503, body: 'down' } });
    const err = await currentTodoistToken(ctx, { fetchImpl: td.fetchImpl, now: () => T0 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(NeedsAuthError);
    expect((err as Error).message).toBe('Todoist token refresh failed (503)');
  });
});
