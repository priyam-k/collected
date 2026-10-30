import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { testContext } from '../test-util.js';
import { createUpdateChecker } from '@collected/core/lib/updates';
import { MIN_CLIENT_VERSION } from '@collected/core/lib/version';
import { createApi, identityAllows } from './index.js';
import { systemRoutes } from './system.js';

describe('/api/system', () => {
  it('GET /version reports the running build and the upstream repo', async () => {
    const ctx = await testContext();
    ctx.build = { commit: 'abc1234', builtAt: '2026-10-28T00:00:00Z' };
    const app = new Hono().route('/api/system', systemRoutes(ctx, createUpdateChecker(ctx, { fetch: (async () => new Response('', { status: 500 })) as typeof fetch })));
    const res = await app.request('/api/system/version');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: 'test', commit: 'abc1234', builtAt: '2026-10-28T00:00:00Z', repo: 'priyam-k/collected', minClient: MIN_CLIENT_VERSION });
  });

  it('every /api answer carries the server version and the oldest client it talks to', async () => {
    const ctx = await testContext();
    const app = new Hono().route('/api', createApi(ctx));
    for (const [p, init, status] of [
      ['/api/system/version', undefined, 200],
      ['/api/health', undefined, 200],
      ['/api/nope', undefined, 404],
      ['/api/courses', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' }, 400],
    ] as const) {
      const res = await app.request(p, init as RequestInit | undefined);
      expect(res.status, p).toBe(status);
      expect(res.headers.get('x-collected-version'), p).toBe('test');
      expect(res.headers.get('x-collected-min-client'), p).toBe(MIN_CLIENT_VERSION);
    }
    // A refused credential still learns the version: the message to show is "upgrade", not "forbidden".
    ctx.env.AUTH_DISABLED = false;
    const denied = await new Hono().route('/api', createApi(ctx)).request('/api/courses');
    expect(denied.status).toBe(401);
    expect(denied.headers.get('x-collected-version')).toBe('test');
  });

  it('GET /update answers from the cache; POST /update/check runs one', async () => {
    const ctx = await testContext();
    ctx.build = { commit: 'abc1234', builtAt: null };
    let calls = 0;
    const checker = createUpdateChecker(ctx, {
      fetch: (async () => {
        calls++;
        return new Response(JSON.stringify({ ahead_by: 1, commits: [{ sha: '9999999' }], files: [{ filename: 'web/src/x.tsx' }] }), { status: 200 });
      }) as typeof fetch,
    });
    const app = new Hono().route('/api/system', systemRoutes(ctx, checker));
    const before = await (await app.request('/api/system/update')).json();
    expect(before).toMatchObject({ upstream: null, error: null, steps: expect.arrayContaining(['git pull --ff-only']) });
    expect(calls).toBe(0);
    const after = await (await app.request('/api/system/update/check', { method: 'POST' })).json();
    expect(after).toMatchObject({ upstream: { ahead: 1, matters: true, commit: '9999999' } });
    expect(calls).toBeGreaterThan(0);
  });

  it('POST /update/check is refused when the check is disabled', async () => {
    const ctx = await testContext();
    (ctx.env as { UPDATE_CHECK_DISABLED: boolean }).UPDATE_CHECK_DISABLED = true;
    const app = new Hono().route('/api/system', systemRoutes(ctx, createUpdateChecker(ctx)));
    expect((await app.request('/api/system/update/check', { method: 'POST' })).status).toBe(409);
    expect(((await (await app.request('/api/system/update')).json()) as { error: string }).error).toMatch(/UPDATE_CHECK_DISABLED/);
  });

  it('tokens may read the version and status but not trigger a check', () => {
    expect(identityAllows('token:abc', 'GET', '/api/system/version')).toBe(true);
    expect(identityAllows('service:cli', 'GET', '/api/system/update')).toBe(true);
    expect(identityAllows('token:abc', 'POST', '/api/system/update/check')).toBe(false);
    expect(identityAllows('helper', 'GET', '/api/system/version')).toBe(false);
    expect(identityAllows('someone@example.com', 'POST', '/api/system/update/check')).toBe(true);
  });
});
