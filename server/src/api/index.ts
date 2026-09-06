import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { accessAuth, type AuthVariables } from '../auth/cloudflare-access.js';
import type { AppContext } from '../context.js';
import { coursesRoutes } from './courses.js';
import { exportRoutes } from './export.js';
import { healthRoutes } from './health.js';
import { itemsRoutes } from './items.js';
import { jobsRoutes } from './jobs.js';
import { layoutRoutes, widgetRoutes } from './layout.js';
import { settingsRoutes } from './settings.js';
import { sourcesRoutes } from './sources.js';

export function createApi(ctx: AppContext) {
  const api = new Hono<{ Variables: AuthVariables }>();

  // The Canvas cookie drop-off authenticates itself (helper key or Access); everything else needs Access.
  api.use('*', async (c, next) => {
    if (c.req.path === '/api/sources/canvas/cookie' && c.req.method === 'POST') {
      c.set('user', null);
      const guard = accessAuth(ctx.env);
      // Try Access first; if it fails, fall through with user=null and let the route check the helper key.
      let passed = false;
      await guard(c, async () => {
        passed = true;
        await next();
      });
      if (!passed) {
        c.res = undefined as unknown as Response; // discard the 401 the guard produced
        await next();
      }
      return;
    }
    return accessAuth(ctx.env)(c, next);
  });

  api.route('/health', healthRoutes(ctx));
  api.route('/sources', sourcesRoutes(ctx));
  api.route('/courses', coursesRoutes(ctx));
  api.route('/items', itemsRoutes(ctx));
  api.route('/jobs', jobsRoutes(ctx));
  api.route('/layout', layoutRoutes(ctx));
  api.route('/widgets', widgetRoutes(ctx));
  api.route('/settings', settingsRoutes(ctx));
  api.route('/', exportRoutes(ctx));

  api.notFound((c) => c.json({ error: 'not found' }, 404));
  api.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    ctx.log.error({ err, path: c.req.path }, 'unhandled api error');
    return c.json({ error: 'internal error' }, 500);
  });

  return api;
}
