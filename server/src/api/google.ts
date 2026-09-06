import { randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import { authUrl, exchangeCode, GoogleCalendarApi } from '../ingest/gcal/api.js';
import { gcalIngester } from '../ingest/gcal/ingest.js';
import { runIngester } from '../ingest/runner.js';
import { NotConfiguredError } from '../ingest/types.js';
import type { AppContext } from '../context.js';
import { mergeSourceMeta, setSourceConfig, setSourceStatus } from '../lib/sources.js';
import { sources } from '../db/schema.js';
import { eq } from 'drizzle-orm';

const pendingStates = new Map<string, number>(); // state → expiry ms

function settingsUrl(ctx: AppContext, q: string): string {
  return `${ctx.env.PUBLIC_URL.replace(/\/$/, '')}/settings/sources?${q}`;
}

/** OAuth connect flow. Both routes are hit by the browser, so Cloudflare Access covers them in prod. */
export function googleRoutes(ctx: AppContext) {
  const r = new Hono();

  r.get('/start', (c) => {
    try {
      const state = randomBytes(16).toString('hex');
      pendingStates.set(state, Date.now() + 10 * 60_000);
      return c.redirect(authUrl(ctx.env, state));
    } catch (err) {
      if (err instanceof NotConfiguredError) return c.redirect(settingsUrl(ctx, `google=unconfigured`));
      throw err;
    }
  });

  r.get('/callback', async (c) => {
    const { code, state, error } = c.req.query();
    if (error) return c.redirect(settingsUrl(ctx, `google=error&reason=${encodeURIComponent(error)}`));
    const exp = state ? pendingStates.get(state) : undefined;
    pendingStates.delete(state ?? '');
    if (!code || !exp || exp < Date.now()) return c.redirect(settingsUrl(ctx, 'google=error&reason=state'));
    try {
      const { refreshToken } = await exchangeCode(ctx.env, code);
      if (!refreshToken) return c.redirect(settingsUrl(ctx, 'google=error&reason=no_refresh_token'));
      await setSourceConfig(ctx, 'gcal', { refreshToken });
      const api = GoogleCalendarApi.fromRefreshToken(ctx.env, refreshToken);
      const calendars = await api.listCalendars();
      const primary = calendars.find((k) => k.primary)?.id;
      await mergeSourceMeta(ctx, 'gcal', { calendars, selectedCalendars: primary ? [primary] : [], defaultCalendarId: primary ?? null, syncTokens: {} });
      await ctx.db.update(sources).set({ enabled: true }).where(eq(sources.id, 'gcal'));
      await setSourceStatus(ctx, 'gcal', 'connected', { lastError: null });
      ctx.log.info({ calendars: calendars.length }, 'google calendar connected');
      void runIngester(ctx, gcalIngester, { force: true });
      return c.redirect(settingsUrl(ctx, 'google=connected'));
    } catch (err) {
      ctx.log.error({ err }, 'google oauth callback failed');
      return c.redirect(settingsUrl(ctx, `google=error&reason=${encodeURIComponent((err as Error).message.slice(0, 120))}`));
    }
  });

  return r;
}
