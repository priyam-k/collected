import { Hono } from 'hono';
import type { HealthResponse } from '@collected/shared';
import type { AppContext } from '../context.js';

export function healthRoutes(ctx: AppContext) {
  return new Hono().get('/', (c) => {
    const body: HealthResponse = {
      ok: true,
      version: ctx.version,
      now: new Date().toISOString(),
      authDisabled: ctx.env.AUTH_DISABLED,
    };
    return c.json(body);
  });
}
