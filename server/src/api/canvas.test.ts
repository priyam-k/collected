import { Hono } from 'hono';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { CanvasClient, jarFromCookieHeader } from '../ingest/canvas/client.js';
import { setSourceConfig } from '../lib/sources.js';
import { testContext } from '../test-util.js';
import { canvasRoutes } from './canvas.js';

const BASE = 'https://canvas.test';

function fakeFetch(handler: (url: string) => Response): typeof fetch {
  return (async (input: string | URL | Request) => handler(input instanceof Request ? input.url : String(input))) as typeof fetch;
}

async function app(ctx: Awaited<ReturnType<typeof testContext>>, fetchImpl: typeof fetch) {
  await setSourceConfig(ctx, 'canvas', { baseUrl: BASE, cookieHeader: 'canvas_session=abc' });
  const jar = await jarFromCookieHeader('canvas_session=abc', BASE);
  return new Hono().route('/api/canvas', canvasRoutes(ctx, async () => new CanvasClient(BASE, jar, pino({ level: 'silent' }), fetchImpl)));
}

describe('GET /api/canvas/files/:id/open', () => {
  it('redirects to the one-shot public url, adding download=1 only when asked', async () => {
    const ctx = await testContext();
    const seen: string[] = [];
    const a = await app(
      ctx,
      fakeFetch((url) => {
        seen.push(url);
        return new Response('while(1);{"public_url":"https://inst-fs.test/files/uuid/notes.pdf?token=t1"}', { headers: { 'content-type': 'application/json' } });
      }),
    );
    const res = await a.request('/api/canvas/files/123/open');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://inst-fs.test/files/uuid/notes.pdf?token=t1');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(seen[0]).toBe(`${BASE}/api/v1/files/123/public_url`);

    const dl = await a.request('/api/canvas/files/123/open?download=1');
    expect(dl.headers.get('location')).toBe('https://inst-fs.test/files/uuid/notes.pdf?token=t1&download=1');
  });

  it('flags the source when the session is dead, and rejects junk ids', async () => {
    const ctx = await testContext();
    const a = await app(ctx, fakeFetch(() => new Response('<html>login</html>', { status: 401, headers: { 'content-type': 'text/html' } })));
    const res = await a.request('/api/canvas/files/123/open');
    expect(res.status).toBe(502);
    const src = await ctx.db.query.sources.findFirst({ where: (t, { eq }) => eq(t.id, 'canvas') });
    expect(src?.status).toBe('needs_auth');
    expect((await a.request('/api/canvas/files/abc/open')).status).toBe(400);
  });

  it('404s when Canvas is not connected', async () => {
    const ctx = await testContext();
    const a = new Hono().route('/api/canvas', canvasRoutes(ctx));
    expect((await a.request('/api/canvas/files/1/open')).status).toBe(404);
  });
});
