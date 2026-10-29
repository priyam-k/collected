import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { AuthVariables } from '../auth/cloudflare-access.js';
import { TODOIST_REVOKE_URL, TODOIST_TOKEN_URL } from '@collected/core/auth/todoist';
import { getSourceConfig, getSourceRow } from '@collected/core/lib/sources';
import { testContext } from '../test-util.js';
import { toPublic } from './sources.js';
import { todoistRoutes, type TodoistRouteDeps } from './todoist.js';

const fakeApi = async () => {
  throw new Error('not used');
};
const noRun = (async () => ({ ok: true, result: { counts: {} }, ms: 1 })) as unknown as NonNullable<TodoistRouteDeps['run']>;

async function setup(opts: { configured?: boolean; user?: string | null; fetchImpl?: typeof fetch; now?: () => number } = {}) {
  const ctx = await testContext();
  if (opts.configured !== false) {
    ctx.env.TODOIST_CLIENT_ID = 'cid';
    ctx.env.TODOIST_CLIENT_SECRET = 'csecret';
  }
  const calls: { url: string; body: string }[] = [];
  const fetchImpl: typeof fetch =
    opts.fetchImpl ??
    (async (input, init) => {
      calls.push({ url: String(input), body: String(init?.body) });
      return new Response(JSON.stringify({ access_token: 'tok-from-oauth', token_type: 'Bearer' }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use('*', async (c, next) => {
    c.set('user', opts.user === undefined ? 'dev' : opts.user);
    await next();
  });
  app.route('/api/todoist', todoistRoutes(ctx, fakeApi, { fetchImpl, run: noRun, now: opts.now }));
  return { ctx, app, calls };
}

const location = (res: Response) => new URL(res.headers.get('location')!);

/** Follows /connect and returns the state Todoist would hand back. */
async function startFlow(app: Hono<{ Variables: AuthVariables }>) {
  const res = await app.request('/api/todoist/connect');
  expect(res.status).toBe(302);
  const to = location(res);
  expect(to.origin + to.pathname).toBe('https://todoist.com/oauth/authorize');
  expect(to.searchParams.get('client_id')).toBe('cid');
  expect(to.searchParams.get('scope')).toBe('data:read_write,data:delete');
  const state = to.searchParams.get('state')!;
  expect(state).toMatch(/^[0-9a-f]{32}$/);
  return state;
}

describe('Todoist OAuth connect', () => {
  it('redirects to the settings page with reason=config when the app is not configured', async () => {
    const { app, ctx } = await setup({ configured: false });
    const res = await app.request('/api/todoist/connect');
    expect(res.status).toBe(302);
    const to = location(res);
    expect(to.pathname).toBe('/settings/sources');
    expect(to.searchParams.get('todoist')).toBe('error');
    expect(to.searchParams.get('reason')).toBe('config');
    expect(toPublic(await getSourceRow(ctx, 'todoist'), ctx.env).oauthAvailable).toBe(false);
  });

  it('exchanges the code, stores the token where the pasted token lives, marks connected, records connectedVia', async () => {
    const { app, ctx, calls } = await setup();
    const state = await startFlow(app);
    const res = await app.request(`/api/todoist/callback?code=abc&state=${state}`);
    expect(res.status).toBe(302);
    expect(location(res).search).toBe('?todoist=connected');

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(TODOIST_TOKEN_URL);
    const body = new URLSearchParams(calls[0]!.body);
    expect(body.get('client_id')).toBe('cid');
    expect(body.get('client_secret')).toBe('csecret');
    expect(body.get('code')).toBe('abc');

    expect(await getSourceConfig(ctx, 'todoist')).toEqual({ token: 'tok-from-oauth' });
    const row = await getSourceRow(ctx, 'todoist');
    expect(row.status).toBe('connected');
    expect(row.enabled).toBe(true);
    expect(row.meta).toMatchObject({ connectedVia: 'oauth' });
    const pub = toPublic(row, ctx.env);
    expect(pub.hasConfig).toBe(true);
    expect(pub.oauthAvailable).toBe(true);

    // A state is single use.
    const again = await app.request(`/api/todoist/callback?code=abc&state=${state}`);
    expect(location(again).searchParams.get('reason')).toBe('expired');
  });

  it('refuses an unknown state, an expired state, and a state started by someone else', async () => {
    let t = 1_000_000;
    const { app, ctx } = await setup({ now: () => t });
    const unknown = await app.request('/api/todoist/callback?code=abc&state=deadbeef');
    expect(location(unknown).searchParams.get('reason')).toBe('expired');

    const state = await startFlow(app);
    t += 10 * 60_000 + 1;
    const late = await app.request(`/api/todoist/callback?code=abc&state=${state}`);
    expect(location(late).searchParams.get('reason')).toBe('expired');
    expect(await getSourceConfig(ctx, 'todoist')).toBeNull();

    const fresh = await startFlow(app);
    const other = new Hono<{ Variables: AuthVariables }>();
    other.use('*', async (c, next) => {
      c.set('user', 'someone-else@example.com');
      await next();
    });
    other.route('/api/todoist', todoistRoutes(ctx, fakeApi, { fetchImpl: async () => new Response('{}'), run: noRun, now: () => t }));
    const hijack = await other.request(`/api/todoist/callback?code=abc&state=${fresh}`);
    expect(location(hijack).searchParams.get('reason')).toBe('expired');
    expect(await getSourceConfig(ctx, 'todoist')).toBeNull();
  });

  it('maps access_denied to reason=denied and a failed exchange to reason=exchange without storing anything', async () => {
    const { app, ctx } = await setup({ fetchImpl: async () => new Response(JSON.stringify({ error: 'bad_authorization_code' }), { status: 400 }) });
    const denied = await app.request('/api/todoist/callback?error=access_denied&state=whatever');
    expect(location(denied).searchParams.get('reason')).toBe('denied');

    const state = await startFlow(app);
    const res = await app.request(`/api/todoist/callback?code=bad&state=${state}`);
    expect(location(res).searchParams.get('reason')).toBe('exchange');
    expect(await getSourceConfig(ctx, 'todoist')).toBeNull();
    expect((await getSourceRow(ctx, 'todoist')).status).not.toBe('connected');
  });

  it('disconnect clears the token, revokes an OAuth token best-effort, and leaves a pasted token unrevoked', async () => {
    const { app, ctx, calls } = await setup();
    const state = await startFlow(app);
    await app.request(`/api/todoist/callback?code=abc&state=${state}`);

    const res = await app.request('/api/todoist/disconnect', { method: 'POST' });
    expect(await res.json()).toEqual({ ok: true, revoked: true });
    expect(calls.map((k) => k.url)).toEqual([TODOIST_TOKEN_URL, TODOIST_REVOKE_URL]);
    expect(new URLSearchParams(calls[1]!.body).get('access_token')).toBe('tok-from-oauth');
    expect(await getSourceConfig(ctx, 'todoist')).toBeNull();
    const row = await getSourceRow(ctx, 'todoist');
    expect(row.status).toBe('disconnected');
    expect((row.meta as { connectedVia?: unknown }).connectedVia).toBeNull();

    // Pasted token: nothing to revoke through our app, so no outbound call.
    const { setSourceConfig, mergeSourceMeta } = await import('@collected/core/lib/sources');
    await setSourceConfig(ctx, 'todoist', { token: 'pasted' });
    await mergeSourceMeta(ctx, 'todoist', { connectedVia: 'token' });
    const res2 = await app.request('/api/todoist/disconnect', { method: 'POST' });
    expect(await res2.json()).toEqual({ ok: true, revoked: false });
    expect(calls).toHaveLength(2);
    expect(await getSourceConfig(ctx, 'todoist')).toBeNull();
  });
});
