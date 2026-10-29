import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { AppContext } from '../context.js';
import { createSession, createToken, emailAllowed, upsertUser } from '@collected/core/auth/session';
import { testContext } from '../test-util.js';
import { createApi } from './index.js';

/** A context with sign-in on: Google configured, Access not, auth not disabled. */
async function signedCtx(): Promise<AppContext> {
  const ctx = await testContext();
  return { ...ctx, env: { ...ctx.env, AUTH_DISABLED: false, GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret', PUBLIC_URL: 'https://collected.example.com' } };
}

const app = (ctx: AppContext) => new Hono().route('/api', createApi(ctx));
const json = (body: unknown, headers: Record<string, string> = {}) => ({ method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

describe('sign-in, sessions and tokens', () => {
  it('answers /me for everyone and 401s the rest when signed out', async () => {
    const a = app(await signedCtx());
    const me = await a.request('/api/auth/me');
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ identity: null, user: null, authDisabled: false, signIn: { google: true, access: false } });
    expect((await a.request('/api/items')).status).toBe(401);
    expect((await a.request('/api/courses')).status).toBe(401);
  });

  it('a session cookie is a person; logout ends it', async () => {
    const ctx = await signedCtx();
    const a = app(ctx);
    const user = await upsertUser(ctx, { email: 'Me@Example.com', name: 'Me' });
    const s = await createSession(ctx, user.id, 'vitest');
    const cookie = { cookie: `collected_session=${s.id}` };
    const me = await a.request('/api/auth/me', { headers: cookie });
    expect(await me.json()).toMatchObject({ identity: 'me@example.com', user: { email: 'me@example.com', name: 'Me' } });
    expect((await a.request('/api/items', { headers: cookie })).status).toBe(200);
    expect((await a.request('/api/export', { headers: cookie })).status).toBe(200);

    const out = await a.request('/api/auth/logout', json({}, cookie));
    expect(out.status).toBe(200);
    expect(out.headers.get('set-cookie')).toMatch(/collected_session=;|Max-Age=0/);
    expect((await a.request('/api/items', { headers: cookie })).status).toBe(401);
  });

  it('API tokens: created by a person, scoped like the CLI, revocable', async () => {
    const ctx = await signedCtx();
    const a = app(ctx);
    const user = await upsertUser(ctx, { email: 'me@example.com' });
    const s = await createSession(ctx, user.id);
    const cookie = { cookie: `collected_session=${s.id}` };

    const created = await a.request('/api/auth/tokens', json({ name: 'macbook' }, cookie));
    expect(created.status).toBe(201);
    const body = (await created.json()) as { id: string; token: string; prefix: string };
    expect(body.token.startsWith('clt_')).toBe(true);
    expect(body.token.startsWith(body.prefix)).toBe(true);
    const bearer = { authorization: `Bearer ${body.token}` };

    expect((await a.request('/api/auth/me', { headers: bearer })).status).toBe(200);
    expect(await (await a.request('/api/auth/me', { headers: bearer })).json()).toMatchObject({ identity: 'token:macbook', user: null });
    expect((await a.request('/api/items', { headers: bearer })).status).toBe(200);
    expect((await a.request('/api/file-sync/manifest', { headers: bearer })).status).toBe(200);
    expect((await a.request('/api/export', { headers: bearer })).status).toBe(403);
    expect((await a.request('/api/auth/tokens', { headers: bearer })).status).toBe(403);
    expect((await a.request('/api/auth/tokens', json({ name: 'x' }, bearer))).status).toBe(403);
    expect((await a.request('/api/items', { headers: { authorization: 'Bearer clt_nope' } })).status).toBe(401);

    const list = (await (await a.request('/api/auth/tokens', { headers: cookie })).json()) as { id: string; name: string }[];
    expect(list.map((t) => t.name)).toEqual(['macbook']);
    expect(JSON.stringify(list)).not.toContain(body.token);
    expect((await a.request(`/api/auth/tokens/${body.id}`, { method: 'DELETE', headers: cookie })).status).toBe(200);
    expect((await a.request('/api/items', { headers: bearer })).status).toBe(401);
  });

  it('the first sign-in claims the instance; ALLOWED_EMAILS overrides', async () => {
    const ctx = await signedCtx();
    expect(await emailAllowed(ctx, 'first@example.com')).toBe(true);
    await upsertUser(ctx, { email: 'first@example.com' });
    expect(await emailAllowed(ctx, 'FIRST@example.com')).toBe(true);
    expect(await emailAllowed(ctx, 'second@example.com')).toBe(false);
    const listed = { ...ctx, env: { ...ctx.env, ALLOWED_EMAILS: ['second@example.com'] } };
    expect(await emailAllowed(listed, 'second@example.com')).toBe(true);
    expect(await emailAllowed(listed, 'first@example.com')).toBe(false);
  });

  it('the Google callback refuses a bad state and never trusts a cross-site next', async () => {
    const ctx = await signedCtx();
    const a = app(ctx);
    const r = await a.request('/api/auth/google/callback?code=x&state=nope', { redirect: 'manual' });
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('https://collected.example.com/signin?error=expired');
    const start = await a.request('/api/auth/google/start?next=https://evil.example/', { redirect: 'manual' });
    expect(start.status).toBe(302);
    expect(start.headers.get('location')).toContain('accounts.google.com');
  });

  it('AUTH_DISABLED is the dev person and can mint a token for the CLI', async () => {
    const ctx = await testContext();
    const a = app(ctx);
    expect(await (await a.request('/api/auth/me')).json()).toMatchObject({ identity: 'dev', authDisabled: true });
    const created = await a.request('/api/auth/tokens', json({ name: 'local' }));
    expect(created.status).toBe(201);
    const { token } = (await created.json()) as { token: string };
    const signed = { ...ctx, env: { ...ctx.env, AUTH_DISABLED: false, GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' } };
    expect((await app(signed).request('/api/items', { headers: { authorization: `Bearer ${token}` } })).status).toBe(200);
  });
});

void createToken;
