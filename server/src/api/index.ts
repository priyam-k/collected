import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { compress } from 'hono/compress';
import { etag } from 'hono/etag';
import { accessAuth, verifyAccess, type AuthVariables } from '../auth/cloudflare-access.js';
import type { AppContext } from '../context.js';
import { MB } from '../lib/http.js';
import { authRoutes } from './auth.js';
import { calendarRoutes } from './calendar.js';
import { canvasRoutes } from './canvas.js';
import { coursesRoutes } from './courses.js';
import { googleRoutes } from './google.js';
import { exportRoutes } from './export.js';
import { fileSyncRoutes } from './file-sync.js';
import { gradesRoutes } from './grades.js';
import { gtasksRoutes } from './gtasks.js';
import { healthRoutes } from './health.js';
import { itemsRoutes } from './items.js';
import { jobsRoutes } from './jobs.js';
import { layoutRoutes, widgetRoutes } from './layout.js';
import { onboardingRoutes } from './onboarding.js';
import { settingsRoutes } from './settings.js';
import { sourcesRoutes } from './sources.js';
import { todoistRoutes } from './todoist.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * What a non-person identity may do. A person who passed the Access login is the owner and may do anything.
 * The helper key exists for one script and one route. A service token is the laptop CLI: it reads the dashboard,
 * makes the small edits the CLI offers, and runs the file sync; it never touches credentials, settings, layout,
 * or the import/export of the whole database, so a leaked `~/.collected/agent.json` is not a full takeover.
 */
export function identityAllows(user: string, method: string, path: string): boolean {
  const machine = user.startsWith('service:') || user.startsWith('token:');
  if (user === 'dev' || (!machine && user !== 'helper')) return true;
  if (user === 'helper') return path === '/api/sources/canvas/cookie' && method === 'POST';
  const p = path.replace(/\/+$/, '');
  if (p === '/api/import' || p === '/api/export' || p === '/api/demo') return false;
  if (p.startsWith('/api/auth/tokens') || p === '/api/auth/logout-all') return false;
  if (p.startsWith('/api/google') || p.startsWith('/api/layout') || p.startsWith('/api/widgets')) return false;
  if (p === '/api/sources/canvas/cookie') return false;
  if (MUTATING.has(method)) {
    if (p.startsWith('/api/settings')) return false;
    if (/^\/api\/sources\/[^/]+\/(config|enabled|meta)$/.test(p)) return false;
    if (method === 'DELETE') return false;
  }
  return true;
}

/** Same-site check for state-changing requests: a browser that sends an Origin must be ours. */
export function crossSite(headers: { origin?: string; secFetchSite?: string }, publicUrl: string): boolean {
  if (headers.secFetchSite === 'cross-site') return true;
  if (!headers.origin || headers.origin === 'null') return !!headers.origin; // "null" is an opaque (sandboxed/file) origin
  try {
    return new URL(headers.origin).origin !== new URL(publicUrl).origin;
  } catch {
    return true;
  }
}

export function createApi(ctx: AppContext) {
  const api = new Hono<{ Variables: AuthVariables }>();

  // Two paths skip Access: the Canvas cookie drop-off authenticates itself (helper key or Access), and the health
  // probe is what Docker's HEALTHCHECK calls from inside the container with no JWT. Externally both still sit
  // behind the Access login wall on the hostname. Everything else needs Access.
  const guard = accessAuth(ctx);
  api.use('*', async (c, next) => {
    const open =
      (c.req.path === '/api/sources/canvas/cookie' && c.req.method === 'POST') ||
      (c.req.path === '/api/health' && c.req.method === 'GET') ||
      (c.req.method === 'GET' && (c.req.path === '/api/auth/google/start' || c.req.path === '/api/auth/google/callback'));
    if (open) {
      c.set('user', null);
      return next();
    }
    // /me answers for everyone: it is how the web app learns whether to show the sign-in page.
    if (c.req.path === '/api/auth/me' && c.req.method === 'GET') {
      c.set('user', await verifyAccess(ctx, c));
      return next();
    }
    return guard(c, next);
  });

  // Least privilege per identity, then CSRF for anything that changes state. The Access cookie rides along on
  // cross-site form posts if its SameSite attribute allows it; this check does not depend on that setting.
  api.use('*', async (c, next) => {
    const user = c.get('user');
    if (user && !identityAllows(user, c.req.method, c.req.path)) return c.json({ error: 'forbidden for this credential' }, 403);
    if (MUTATING.has(c.req.method) && crossSite({ origin: c.req.header('origin'), secFetchSite: c.req.header('sec-fetch-site') }, ctx.env.PUBLIC_URL)) {
      return c.json({ error: 'cross-site request refused' }, 403);
    }
    await next();
    if (MUTATING.has(c.req.method) && user && user !== 'dev') ctx.log.info({ user, method: c.req.method, path: c.req.path, status: c.res.status }, 'write');
  });

  // Bodies are small JSON; an import or a file-sync report is the only thing that legitimately runs to megabytes.
  api.use('*', async (c, next) => {
    const maxSize = c.req.path === '/api/import' ? 16 * MB : c.req.path === '/api/file-sync/report' ? 4 * MB : 1 * MB;
    return bodyLimit({ maxSize })(c, next);
  });

  // API responses are per-user: never shareable, always revalidated. `no-cache` (not `no-store`) keeps the ETag
  // round trip that saves the box its egress (DECISIONS 036); the export and the Canvas proxy set no-store themselves.
  api.use('*', async (c, next) => {
    await next();
    if (!c.res.headers.has('Cache-Control')) c.res.headers.set('Cache-Control', 'private, no-cache');
  });

  // Egress is the one thing the box is billed for (DECISIONS 036), and the widgets poll every minute. compress gzips JSON
  // ~8×; etag answers a poll whose body hasn't changed with an empty 304. Registered in this order so that on the way
  // out etag hashes the uncompressed body first and compress wraps whatever is left.
  api.use('*', compress());
  api.use('*', etag());

  api.route('/health', healthRoutes(ctx));
  api.route('/auth', authRoutes(ctx));
  api.route('/sources', sourcesRoutes(ctx));
  api.route('/courses', coursesRoutes(ctx));
  api.route('/onboarding', onboardingRoutes(ctx));
  api.route('/items', itemsRoutes(ctx));
  api.route('/jobs', jobsRoutes(ctx));
  api.route('/layout', layoutRoutes(ctx));
  api.route('/widgets', widgetRoutes(ctx));
  api.route('/settings', settingsRoutes(ctx));
  api.route('/google', googleRoutes(ctx));
  api.route('/calendar', calendarRoutes(ctx));
  api.route('/canvas', canvasRoutes(ctx));
  api.route('/grades', gradesRoutes(ctx));
  api.route('/todoist', todoistRoutes(ctx));
  api.route('/gtasks', gtasksRoutes(ctx));
  api.route('/file-sync', fileSyncRoutes(ctx));
  api.route('/', exportRoutes(ctx));

  api.notFound((c) => c.json({ error: 'not found' }, 404));
  api.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    ctx.log.error({ err, path: c.req.path }, 'unhandled api error');
    return c.json({ error: 'internal error' }, 500);
  });

  return api;
}
