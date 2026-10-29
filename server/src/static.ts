import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';

/** Serves the built SPA from `dist` with an index.html fallback for client routes; false when there is no build there. */
export function mountStatic(app: Hono, dist: string): boolean {
  const indexFile = path.join(dist, 'index.html');
  if (!existsSync(indexFile)) return false;
  // Absolute: the CLI's `ui` serves from wherever the shell happens to be.
  app.use(
    '/*',
    serveStatic({
      root: dist,
      onFound: (p, c) => {
        if (/\/assets\//.test(p)) c.header('Cache-Control', 'public, max-age=31536000, immutable');
      },
    }),
  );
  app.get('*', (c) => {
    if (c.req.path.startsWith('/api/')) return c.notFound();
    return c.html(readFileSync(indexFile, 'utf8'));
  });
  return true;
}
