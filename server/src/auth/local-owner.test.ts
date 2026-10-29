import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';
import { createApi, identityAllows } from '../api/index.js';
import { loadEnv } from '../env.js';
import { testContext } from '../test-util.js';
import { verifyAccess } from './cloudflare-access.js';

/*
 * LOCAL_OWNER: the CLI's in-process app sees the machine's owner as `local`. It is a config-object flag, never an
 * environment variable, so a server someone can reach cannot be put in this state by its environment.
 */
describe('the local owner identity', () => {
  it('answers "local" with no credential, and local is a person', async () => {
    const ctx = await testContext();
    ctx.env.AUTH_DISABLED = false;
    ctx.env.LOCAL_OWNER = true;
    const probe = new Hono().get('/x', async (c) => c.text((await verifyAccess(ctx, c)) ?? 'null'));
    expect(await (await probe.request('/x')).text()).toBe('local');
    expect(identityAllows('local', 'POST', '/api/import')).toBe(true);
    expect(identityAllows('local', 'PUT', '/api/settings/x')).toBe(true);
    expect(identityAllows('local', 'DELETE', '/api/demo')).toBe(true);

    const app = new Hono().route('/api', createApi(ctx));
    const me = (await (await app.request('/api/auth/me')).json()) as { identity: string; user: { email: string } };
    expect(me.identity).toBe('local');
    expect(me.user.email).toBe('local@this-machine');
    const tokens = await app.request('/api/auth/tokens', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'here' }) });
    expect(tokens.status).toBe(201);
  });

  it('without the flag, a bare request is still unauthorized', async () => {
    const ctx = await testContext();
    ctx.env.AUTH_DISABLED = false;
    const app = new Hono().route('/api', createApi(ctx));
    expect((await app.request('/api/courses')).status).toBe(401);
  });

  describe('loadEnv', () => {
    const saved = { ...process.env };
    let tmp: string;
    afterEach(() => {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
      rmSync(tmp, { recursive: true, force: true });
    });

    it('never reads LOCAL_OWNER from the environment', () => {
      tmp = mkdtempSync(path.join(tmpdir(), 'collected-env-'));
      Object.assign(process.env, { LOCAL_OWNER: 'true', AUTH_DISABLED: 'true', NODE_ENV: 'test', DATA_DIR: tmp, SECRET_KEY: 'a'.repeat(64) });
      const env = loadEnv();
      expect('LOCAL_OWNER' in env).toBe(false);
      expect(env.LOCAL_OWNER).toBeUndefined();
      expect(env.AUTH_DISABLED).toBe(true);
    });
  });
});
