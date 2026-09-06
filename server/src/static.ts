import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import type { Env } from './env.js';

/** Serves the built SPA from web/dist with an index.html fallback for client routes. */
export function mountStatic(app: Hono, env: Env): boolean {
  const dist = env.WEB_DIST ?? path.resolve(env.rootDir, 'web', 'dist');
  const indexFile = path.join(dist, 'index.html');
  if (!existsSync(indexFile)) return false;
  const root = path.relative(process.cwd(), dist) || '.';
  app.use(
    '/*',
    serveStatic({
      root,
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
