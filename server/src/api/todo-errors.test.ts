import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { describe, expect, it } from 'vitest';
import { NeedsAuthError, NotConfiguredError } from '@collected/core/ingest/types';
import { getSourceRow } from '@collected/core/lib/sources';
import { testContext } from '../test-util.js';
import { gtasksRoutes } from './gtasks.js';
import { todoistRoutes } from './todoist.js';

/*
 * A to-do app that is disconnected, rejects its token, or answers with an error must reach the widget as a message
 * the person can act on, not as the api-wide "internal error" (which is what a disconnected Todoist used to produce
 * on a close). Anything that is not the app's own failure still falls through to the outer handler.
 */

const failingWith = (err: unknown) => async () => {
  throw err;
};

/** Both routers under the same outer handler createApi uses, so a rethrow is observable. */
async function setup(err: unknown) {
  const ctx = await testContext();
  const app = new Hono();
  app.route('/api/todoist', todoistRoutes(ctx, failingWith(err), { run: (async () => ({ ok: true })) as never }));
  app.route('/api/gtasks', gtasksRoutes(ctx, failingWith(err)));
  app.onError((e, c) => (e instanceof HTTPException ? e.getResponse() : c.json({ error: 'internal error' }, 500)));
  const close = (path: string) => app.request(path, { method: 'POST' });
  return { ctx, close };
}

describe('to-do app errors', () => {
  it('says the app is not connected (409) when it is not configured', async () => {
    const { close } = await setup(new NotConfiguredError('Todoist API token not set'));
    const res = await close('/api/todoist/tasks/123/close');
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'Todoist is not connected; connect it in Settings → Sources' });
    const g = await close('/api/gtasks/tasks/list%3Atask/close');
    expect(g.status).toBe(409);
    expect(await g.json()).toEqual({ error: 'Google Tasks is not connected; connect it in Settings → Sources' });
  });

  it('asks for a reconnect (502) and marks the source needs_auth when the credentials are rejected', async () => {
    const { ctx, close } = await setup(new NeedsAuthError('Todoist rejected the token (401)'));
    const res = await close('/api/todoist/tasks/123/close');
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'Todoist rejected its credentials; reconnect it in Settings → Sources' });
    expect(await getSourceRow(ctx, 'todoist')).toMatchObject({ status: 'needs_auth', lastError: 'Todoist rejected the token (401)' });
    expect((await close('/api/gtasks/tasks/quick')).status).toBe(415); // the body check runs before the app is asked
    await close('/api/gtasks/tasks/list%3Atask/close');
    expect((await getSourceRow(ctx, 'gtasks')).status).toBe('needs_auth');
  });

  it("passes the app's own answer through: 404 stays 404, anything else is 502", async () => {
    const { close } = await setup(new Error('Todoist 404 POST /tasks/123/close: {"error":"Task not found"}'));
    const res = await close('/api/todoist/tasks/123/close');
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toMatch(/^Todoist 404/);
    const rate = await setup(new Error('Todoist rate limited POST /tasks/123/close after 3 retries'));
    expect((await rate.close('/api/todoist/tasks/123/close')).status).toBe(502);
    const g = await setup(new Error('Google Tasks POST https://tasks.googleapis.com/… → 503: backend'));
    expect((await g.close('/api/gtasks/tasks/list%3Atask/close')).status).toBe(502);
  });

  it('leaves everything else to the outer handler', async () => {
    const { close } = await setup(new TypeError('cannot read properties of undefined'));
    const res = await close('/api/todoist/tasks/123/close');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'internal error' });
    expect((await close('/api/gtasks/tasks/list%3Atask/close')).status).toBe(500);
  });
});
