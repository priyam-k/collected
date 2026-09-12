import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { sources } from '../db/schema.js';
import type { Ingester } from '../ingest/types.js';
import { testContext } from '../test-util.js';
import { sourcesRoutes } from './sources.js';
import { eq } from 'drizzle-orm';

const fake = (id: Ingester['id']): Ingester => ({ id, intervalMinutes: 5, run: async () => ({ counts: {} }) });

describe('POST /api/sources/sync', () => {
  it('starts every enabled source, skips disabled ones, and answers before the runs finish', async () => {
    const ctx = await testContext();
    await ctx.db.update(sources).set({ enabled: false }).where(eq(sources.id, 'gradescope'));

    const ran: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const app = new Hono().route(
      '/api/sources',
      sourcesRoutes(ctx, {
        ingesters: [fake('canvas'), fake('gradescope'), fake('todoist')],
        run: async (_ctx, ing) => {
          ran.push(ing.id);
          await gate;
          return { ok: true, result: { counts: {} }, ms: 1 };
        },
      }),
    );

    const res = await app.request('/api/sources/sync', { method: 'POST' });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ started: ['canvas', 'todoist'], skipped: [{ id: 'gradescope', reason: 'disabled' }] });
    expect(ran).toEqual(['canvas', 'todoist']);
    release();
  });

  it('exposes the running flag on GET /sources', async () => {
    const ctx = await testContext();
    const app = new Hono().route('/api/sources', sourcesRoutes(ctx, { ingesters: [], run: async () => ({ ok: true, result: { counts: {} }, ms: 1 }) }));
    const list = (await (await app.request('/api/sources')).json()) as { id: string; running: boolean }[];
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((s) => s.running === false)).toBe(true);
  });
});
