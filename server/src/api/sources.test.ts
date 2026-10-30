import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { sources } from '@collected/core/db/schema';
import type { Ingester } from '@collected/core/ingest/types';
import { testContext } from '../test-util.js';
import { sourcesRoutes } from './sources.js';
import { eq } from 'drizzle-orm';

const fake = (id: Ingester['id']): Ingester => ({ id, intervalMinutes: 5, run: async () => ({ counts: {} }) });

describe('POST /api/sources/sync', () => {
  it('starts every enabled source, skips disabled ones, and answers before the runs finish', async () => {
    const ctx = await testContext();
    await ctx.db.update(sources).set({ enabled: false }).where(eq(sources.id, 'gradescope'));

    const ran: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const app = new Hono().route(
      '/api/sources',
      sourcesRoutes(ctx, {
        ingesters: [fake('canvas'), fake('gradescope'), fake('todoist')],
        run: async (_ctx, ing) => {
          ran.push(ing.id);
          await gate;
          return { ok: true, result: { counts: {} }, ms: 1 };
        },
      }),
    );

    const res = await app.request('/api/sources/sync', { method: 'POST' });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ started: ['canvas', 'todoist'], skipped: [{ id: 'gradescope', reason: 'disabled' }] });
    expect(ran).toEqual(['canvas', 'todoist']);
    release();
  });

  it('exposes the running flag on GET /sources', async () => {
    const ctx = await testContext();
    const app = new Hono().route('/api/sources', sourcesRoutes(ctx, { ingesters: [], run: async () => ({ ok: true, result: { counts: {} }, ms: 1 }) }));
    const list = (await (await app.request('/api/sources')).json()) as { id: string; running: boolean }[];
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((s) => s.running === false)).toBe(true);
  });

  it('publishes the Canvas base URL in meta after a config save, and never the cookie', async () => {
    const ctx = await testContext();
    const app = new Hono().route('/api/sources', sourcesRoutes(ctx, { ingesters: [], run: async () => ({ ok: true, result: { counts: {} }, ms: 1 }) }));
    const res = await app.request('/api/sources/canvas/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseUrl: 'https://canvas.school.edu', cookieHeader: 'canvas_session=SECRETVALUE' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hasConfig: boolean; meta: Record<string, unknown> };
    expect(body.hasConfig).toBe(true);
    expect(body.meta.baseUrl).toBe('https://canvas.school.edu');
    expect(JSON.stringify(body)).not.toContain('SECRETVALUE');
    // A cleared cookie keeps the address: the form prefills it for the replacement.
    await app.request('/api/sources/canvas/config', { method: 'DELETE' });
    const after = (await (await app.request('/api/sources/canvas')).json()) as { hasConfig: boolean; meta: Record<string, unknown> };
    expect(after.hasConfig).toBe(false);
    expect(after.meta.baseUrl).toBe('https://canvas.school.edu');
  });
});

describe('PUT /api/sources/canvas/config: token or cookie, one at a time', () => {
  const TOKEN = '7~configtokenconfigtokenconfigtoken';
  const put = (app: Hono, body: unknown) => app.request('/api/sources/canvas/config', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  it('stores a token (clearing a cookie), a cookie (clearing the token), reports only the kind, and the cookie route clears a token', async () => {
    const ctx = await testContext();
    const app = new Hono().route('/api/sources', sourcesRoutes(ctx, { ingesters: [], run: async () => ({ ok: true, result: { counts: {} }, ms: 1 }) }));
    const { getSourceConfig } = await import('@collected/core/lib/sources');
    const stored = () => getSourceConfig<Record<string, unknown>>(ctx, 'canvas');

    const cookie = await put(app, { baseUrl: 'https://canvas.school.edu', cookieHeader: 'canvas_session=SECRETVALUE' });
    expect(cookie.status).toBe(200);
    expect(((await cookie.json()) as { meta: Record<string, unknown> }).meta.auth).toBe('cookie');

    const token = await put(app, { baseUrl: 'https://canvas.school.edu', accessToken: TOKEN });
    expect(token.status).toBe(200);
    const tokenBody = (await token.json()) as { hasConfig: boolean; meta: Record<string, unknown> };
    expect(tokenBody.meta.auth).toBe('token');
    expect(JSON.stringify(tokenBody)).not.toContain(TOKEN);
    expect(await stored()).toEqual({ baseUrl: 'https://canvas.school.edu', accessToken: TOKEN });

    const back = await put(app, { baseUrl: 'https://canvas.school.edu', cookieHeader: 'canvas_session=NEWCOOKIE' });
    expect(((await back.json()) as { meta: Record<string, unknown> }).meta.auth).toBe('cookie');
    expect(await stored()).toEqual({ baseUrl: 'https://canvas.school.edu', cookieHeader: 'canvas_session=NEWCOOKIE' });

    // Neither credential, or a token too short to be one: refused, nothing changes.
    expect((await put(app, { baseUrl: 'https://canvas.school.edu' })).status).toBe(422);
    expect((await put(app, { baseUrl: 'https://canvas.school.edu', accessToken: 'short' })).status).toBe(422);
    expect(await stored()).toEqual({ baseUrl: 'https://canvas.school.edu', cookieHeader: 'canvas_session=NEWCOOKIE' });

    await put(app, { baseUrl: 'https://canvas.school.edu', accessToken: TOKEN });
    const viaCookieRoute = await app.request('/api/sources/canvas/cookie', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cookieHeader: 'canvas_session=FROMCLI' }) });
    expect(viaCookieRoute.status).toBe(200);
    expect(await stored()).toEqual({ baseUrl: 'https://canvas.school.edu', cookieHeader: 'canvas_session=FROMCLI', cookieJar: undefined });

    await app.request('/api/sources/canvas/config', { method: 'DELETE' });
    const after = (await (await app.request('/api/sources/canvas')).json()) as { hasConfig: boolean; meta: Record<string, unknown> };
    expect(after.hasConfig).toBe(false);
    expect(after.meta.auth).toBeNull();
    expect(after.meta.baseUrl).toBe('https://canvas.school.edu');
  });
});
