import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { accessAuth, type AuthVariables } from '../auth/cloudflare-access.js';
import type { AppContext } from '../context.js';
import { calendarRoutes } from './calendar.js';
import { coursesRoutes } from './courses.js';
import { googleRoutes } from './google.js';
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
  const guard = accessAuth(ctx.env);
  api.use('*', async (c, next) => {
    if (c.req.path === '/api/sources/canvas/cookie' && c.req.method === 'POST') {
      c.set('user', null);
      return next();
    }
    return guard(c, next);
  });

  api.route('/health', healthRoutes(ctx));
  api.route('/sources', sourcesRoutes(ctx));
  api.route('/courses', coursesRoutes(ctx));
  api.route('/items', itemsRoutes(ctx));
  api.route('/jobs', jobsRoutes(ctx));
  api.route('/layout', layoutRoutes(ctx));
  api.route('/widgets', widgetRoutes(ctx));
  api.route('/settings', settingsRoutes(ctx));
  api.route('/google', googleRoutes(ctx));
  api.route('/calendar', calendarRoutes(ctx));
  api.route('/', exportRoutes(ctx));

  api.notFound((c) => c.json({ error: 'not found' }, 404));
  api.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    ctx.log.error({ err, path: c.req.path }, 'unhandled api error');
    return c.json({ error: 'internal error' }, 500);
  });

  return api;
}
