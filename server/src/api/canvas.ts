import { Hono } from 'hono';
import { sourceConfigSchemas } from '@collected/shared';
import type { AppContext } from '../context.js';
import { CanvasClient, type CanvasConfig } from '../ingest/canvas/client.js';
import { NeedsAuthError } from '../ingest/types.js';
import { getSourceConfig, setSourceStatus } from '../lib/sources.js';

export type CanvasClientFactory = (config: CanvasConfig) => Promise<CanvasClient>;

export function canvasRoutes(ctx: AppContext, clientFor: CanvasClientFactory = (config) => CanvasClient.fromConfig(config, ctx.log)) {
  const r = new Hono();

  /**
   * Opens a Canvas file in the browser instead of downloading it.
   *
   * Every Canvas file URL (`/files/:id/download?download_frd=1`) ends at InstFS with `download=1`, so the browser
   * saves it. The `public_url` API returns an InstFS link without that flag; the CDN behind it answers with
   * `Content-Disposition: inline`, and Chrome renders PDFs natively. The link is one-shot (a second fetch of the
   * same token is 403), so this route only mints it and redirects; the browser is the one that consumes it.
   * `?download=1` re-adds the flag for an explicit download.
   */
  r.get('/files/:id/open', async (c) => {
    const id = c.req.param('id');
    if (!/^\d+$/.test(id)) return c.json({ error: 'bad file id' }, 400);
    const config = await getSourceConfig<CanvasConfig>(ctx, 'canvas');
    if (!config) return c.json({ error: 'Canvas is not connected' }, 404);
    const client = await clientFor(sourceConfigSchemas.canvas.parse(config));
    try {
      const { public_url } = await client.get<{ public_url?: string }>(`/api/v1/files/${id}/public_url`);
      if (!public_url) return c.json({ error: 'Canvas returned no URL for this file' }, 502);
      const url = new URL(public_url);
      if (c.req.query('download') === '1') url.searchParams.set('download', '1');
      c.header('Cache-Control', 'no-store');
      return c.redirect(url.toString(), 302);
    } catch (err) {
      if (err instanceof NeedsAuthError) {
        await setSourceStatus(ctx, 'canvas', 'needs_auth', { lastError: err.message });
        return c.json({ error: 'Canvas session expired; reconnect it in Settings → Sources' }, 502);
      }
      const message = err instanceof Error ? err.message : String(err);
      ctx.log.warn({ err, file: id }, 'canvas file open failed');
      return c.json({ error: message }, /Canvas 404/.test(message) ? 404 : 502);
    }
  });

  /**
   * A read-only window onto Canvas for local tools (the `collected canvas …` commands): pages, full assignment
   * bodies, rubrics, module trees. One GET with the stored session, the JSON passed through.
   *
   * Read-only by construction: CanvasClient only issues GETs, and the path must be a Canvas API path on the
   * configured host. A 401/403/404 for the resource is reported as "not available" and never marks the source as
   * needing auth: students get 401 for a tab an instructor disabled.
   * `?all=1` follows pagination (up to 10 pages of 100).
   */
  r.get('/raw', async (c) => {
    const path = c.req.query('path') ?? '';
    if (!/^\/api\/v1\/[^\s]*$/.test(path) || path.includes('..') || path.includes('//')) return c.json({ error: 'path must be a Canvas API path starting with /api/v1/' }, 400);
    const config = await getSourceConfig<CanvasConfig>(ctx, 'canvas');
    if (!config) return c.json({ error: 'Canvas is not connected' }, 404);
    const client = await clientFor(sourceConfigSchemas.canvas.parse(config));
    c.header('Cache-Control', 'no-store');
    try {
      const first = await client.getRaw(path, c.req.query('all') === '1' ? { per_page: 100 } : {}, undefined, { deniedIsNull: true });
      if (first.data === null) return c.json({ error: 'Canvas has no such resource, or it is not available to you' }, 404);
      if (c.req.query('all') !== '1' || !Array.isArray(first.data)) return c.json(first.data as object);
      const out = [...(first.data as unknown[])];
      let next = first.link.next;
      for (let page = 1; next && page < 10; page++) {
        const more = await client.getRaw(next, {}, undefined, { deniedIsNull: true });
        if (!Array.isArray(more.data)) break;
        out.push(...(more.data as unknown[]));
        next = more.link.next;
      }
      return c.json(out);
    } catch (err) {
      if (err instanceof NeedsAuthError) {
        await setSourceStatus(ctx, 'canvas', 'needs_auth', { lastError: err.message });
        return c.json({ error: 'Canvas session expired; reconnect it in Settings → Sources' }, 502);
      }
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 502);
    }
  });

  return r;
}
