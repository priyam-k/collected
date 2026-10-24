import { Hono } from 'hono';
import { z } from 'zod';
import { jobsFilterSchema, todoistPushConfigSchema } from '@collected/shared';
import type { AppContext } from '../context.js';
import { allSettings, getSetting, setSetting } from '../lib/settings.js';
import { bad, parseBody } from './util.js';

/** Keys with a schema are validated on write; anything else is stored as given. */
const KNOWN: Record<string, z.ZodTypeAny> = {
  'jobs.filter': jobsFilterSchema,
  'todoist.push': todoistPushConfigSchema,
  'todo.sections': z.array(z.string()),
  timezone: z.string().min(1),
};

export function settingsRoutes(ctx: AppContext) {
  const r = new Hono();

  r.get('/', async (c) => c.json(await allSettings(ctx)));

  r.get('/:key', async (c) => {
    const v = await getSetting(ctx, c.req.param('key'));
    if (v === undefined) bad('setting not found', 404);
    return c.json(v);
  });

  r.put('/:key', async (c) => {
    const key = c.req.param('key');
    if (!/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(key)) bad('bad setting key', 422);
    // fileSync.* is written by the file-sync report handler from a validated shape; a free-form write here would be read back by the agent.
    if (key.startsWith('fileSync.')) bad('this setting is managed by the server', 409);
    const schema = Object.hasOwn(KNOWN, key) ? KNOWN[key]! : z.unknown();
    const value = await parseBody(c, schema);
    await setSetting(ctx, key, value);
    return c.json(value);
  });

  return r;
}
