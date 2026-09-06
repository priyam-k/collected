import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { accessAuth, type AuthVariables } from '../auth/cloudflare-access.js';
import type { AppContext } from '../context.js';
import { healthRoutes } from './health.js';

export function createApi(ctx: AppContext) {
  const api = new Hono<{ Variables: AuthVariables }>();

  api.use('*', accessAuth(ctx.env));

  api.route('/health', healthRoutes(ctx));

  api.notFound((c) => c.json({ error: 'not found' }, 404));
  api.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    ctx.log.error({ err, path: c.req.path }, 'unhandled api error');
    return c.json({ error: 'internal error' }, 500);
  });

  return api;
}
