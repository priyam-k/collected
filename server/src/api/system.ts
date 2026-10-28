import { Hono } from 'hono';
import type { AppContext } from '../context.js';
import { systemVersion, type UpdateChecker } from '../lib/updates.js';
import { bad } from './util.js';

/**
 * What is running and whether upstream has moved on. GET is for everyone with a credential (the CLI shows the
 * version too); the on-demand check is a person's action and is denied to tokens in identityAllows.
 */
export function systemRoutes(ctx: AppContext, updates: UpdateChecker) {
  const r = new Hono();

  r.get('/version', (c) => c.json(systemVersion(ctx)));

  r.get('/update', async (c) => c.json(await updates.status()));

  r.post('/update/check', async (c) => {
    if (ctx.env.UPDATE_CHECK_DISABLED) bad('the update check is disabled (UPDATE_CHECK_DISABLED=true)', 409);
    return c.json(await updates.check());
  });

  return r;
}
