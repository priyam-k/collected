import { randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import type { AuthVariables } from '../auth/cloudflare-access.js';
import { authUrl, exchangeCode, GoogleCalendarApi } from '../ingest/gcal/api.js';
import { gcalIngester } from '../ingest/gcal/ingest.js';
import { runIngester } from '../ingest/runner.js';
import { NotConfiguredError } from '../ingest/types.js';
import type { AppContext } from '../context.js';
import { mergeSourceMeta, setSourceConfig, setSourceStatus } from '../lib/sources.js';
import { sources } from '../db/schema.js';
import { eq } from 'drizzle-orm';

/** state → who started the flow and when it expires. Bound to the identity so a callback URL cannot be handed to another browser. */
const pendingStates = new Map<string, { user: string | null; exp: number }>();
const STATE_TTL_MS = 10 * 60_000;

function settingsUrl(ctx: AppContext, q: string): string {
  return `${ctx.env.PUBLIC_URL.replace(/\/$/, '')}/settings/sources?${q}`;
}

/** Reason codes the settings page knows; nothing from Google or an exception reaches the URL. */
type Reason = 'denied' | 'expired' | 'exchange' | 'config' | 'unknown';
const failed = (ctx: AppContext, reason: Reason) => settingsUrl(ctx, `google=error&reason=${reason}`);

/** OAuth connect flow. Both routes are hit by the browser, so Cloudflare Access covers them in prod. */
export function googleRoutes(ctx: AppContext) {
  const r = new Hono<{ Variables: AuthVariables }>();

  r.get('/start', (c) => {
    try {
      const now = Date.now();
      for (const [k, v] of pendingStates) if (v.exp < now) pendingStates.delete(k);
      const state = randomBytes(16).toString('hex');
      pendingStates.set(state, { user: c.get('user') ?? null, exp: now + STATE_TTL_MS });
      return c.redirect(authUrl(ctx.env, state));
    } catch (err) {
      if (err instanceof NotConfiguredError) return c.redirect(settingsUrl(ctx, `google=unconfigured`));
      throw err;
    }
  });

  r.get('/callback', async (c) => {
    const { code, state, error } = c.req.query();
    if (error) return c.redirect(failed(ctx, error === 'access_denied' ? 'denied' : 'unknown'));
    const pending = state ? pendingStates.get(state) : undefined;
    pendingStates.delete(state ?? '');
    if (!code || !pending || pending.exp < Date.now() || pending.user !== (c.get('user') ?? null)) return c.redirect(failed(ctx, 'expired'));
    try {
      const { refreshToken } = await exchangeCode(ctx.env, code);
      if (!refreshToken) return c.redirect(failed(ctx, 'exchange'));
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
      return c.redirect(failed(ctx, err instanceof NotConfiguredError ? 'config' : 'exchange'));
    }
  });

  return r;
}
