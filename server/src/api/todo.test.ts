import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { TodoStatus } from '@collected/shared';
import { mergeSourceMeta, setSourceStatus } from '@collected/core/lib/sources';
import { setSetting } from '@collected/core/lib/settings';
import { testContext } from '../test-util.js';
import { todoRoutes } from './todo.js';

describe('GET /api/todo/status', () => {
  it('reports both apps, their push switches, the last push, and the resolved default app', async () => {
    const ctx = await testContext();
    const app = new Hono().route('/todo', todoRoutes(ctx));
    const fresh = (await (await app.request('/todo/status')).json()) as TodoStatus;
    expect(fresh).toEqual({
      todoist: { connected: false, enabled: true, pushEnabled: false, lastPushAt: null },
      gtasks: { connected: false, enabled: true, pushEnabled: false, lastPushAt: null },
      defaultApp: null,
    });

    await setSourceStatus(ctx, 'gtasks', 'connected');
    await mergeSourceMeta(ctx, 'gtasks', { lastPushAt: '2026-10-28T12:00:00.000Z' });
    await setSetting(ctx, 'gtasks.push', { enabled: true, listName: 'School', titlePrefix: 'course' });
    await setSetting(ctx, 'todo.defaultApp', 'todoist'); // not connected → falls through to Google Tasks
    const later = (await (await app.request('/todo/status')).json()) as TodoStatus;
    expect(later.gtasks).toEqual({ connected: true, enabled: true, pushEnabled: true, lastPushAt: '2026-10-28T12:00:00.000Z' });
    expect(later.todoist.connected).toBe(false);
    expect(later.defaultApp).toBe('gtasks');
  });
});
