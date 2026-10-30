import { Hono } from 'hono';
import { sourceConfigSchemas } from '@collected/shared';
import type { AppContext } from '../context.js';
import { CanvasClient, needsAuthMessage, type CanvasConfig } from '@collected/core/ingest/canvas/client';
import { NeedsAuthError } from '@collected/core/ingest/types';
import { getSourceConfig, setSourceStatus } from '@collected/core/lib/sources';

/**
 * The proxied path after URL normalisation: percent-encoded dot segments collapse in `new URL`, so the check has to
 * run on the parsed result, not the raw string. Returns null for anything that is not `/api/v1/...` on the host.
 */
export function canvasApiPath(raw: string, baseUrl: string): string | null {
  if (!raw.startsWith('/api/v1/') || /%2e|%2f|%5c|\\|#/i.test(raw) || /\s/.test(raw)) return null;
  let u: URL;
  try {
    u = new URL(raw, baseUrl);
  } catch {
    return null;
  }
  if (u.origin !== new URL(baseUrl).origin || !u.pathname.startsWith('/api/v1/') || u.hash) return null;
  if (u.pathname.includes('//') || u.pathname.split('/').some((seg) => seg === '.' || seg === '..')) return null;
  // Canvas honours a token in the query string; the proxy exists to use the stored session and nothing else.
  for (const k of [...u.searchParams.keys()]) if (/^(access_token|as_user_id)$/i.test(k)) return null;
  return u.pathname + u.search;
}

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
      const { public_url } = await client.get<{ public_url?: string }>(`/api/v1/files/${id}/public_url`, {}, AbortSignal.timeout(30_000));
      if (!public_url) return c.json({ error: 'Canvas returned no URL for this file' }, 502);
      const url = new URL(public_url);
      if (url.protocol !== 'https:') return c.json({ error: 'Canvas returned a non-https file URL' }, 502);
      if (c.req.query('download') === '1') url.searchParams.set('download', '1');
      c.header('Cache-Control', 'no-store');
      return c.redirect(url.toString(), 302);
    } catch (err) {
      if (err instanceof NeedsAuthError) {
        await setSourceStatus(ctx, 'canvas', 'needs_auth', { lastError: err.message });
        return c.json({ error: needsAuthMessage(client) }, 502);
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
    const config = await getSourceConfig<CanvasConfig>(ctx, 'canvas');
    if (!config) return c.json({ error: 'Canvas is not connected' }, 404);
    const parsed = sourceConfigSchemas.canvas.parse(config);
    const path = canvasApiPath(c.req.query('path') ?? '', parsed.baseUrl);
    if (!path) return c.json({ error: 'path must be a Canvas API path starting with /api/v1/' }, 400);
    const client = await clientFor(parsed);
    c.header('Cache-Control', 'no-store');
    const signal = AbortSignal.timeout(90_000);
    try {
      const first = await client.getRaw(path, c.req.query('all') === '1' ? { per_page: 100 } : {}, signal, { deniedIsNull: true });
      if (first.data === null) return c.json({ error: 'Canvas has no such resource, or it is not available to you' }, 404);
      if (c.req.query('all') !== '1' || !Array.isArray(first.data)) return c.json(first.data as object);
      const out = [...(first.data as unknown[])];
      let next = first.link.next;
      for (let page = 1; next && page < 10; page++) {
        const more = await client.getRaw(next, {}, signal, { deniedIsNull: true });
        if (!Array.isArray(more.data)) break;
        out.push(...(more.data as unknown[]));
        next = more.link.next;
      }
      return c.json(out);
    } catch (err) {
      if (err instanceof NeedsAuthError) {
        await setSourceStatus(ctx, 'canvas', 'needs_auth', { lastError: err.message });
        return c.json({ error: needsAuthMessage(client) }, 502);
      }
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 502);
    }
  });

  return r;
}
