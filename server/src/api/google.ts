import { randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import type { AuthVariables } from '../auth/cloudflare-access.js';
import { createPkce } from '@collected/core/auth/pkce';
import { authUrl, exchangeCode, GoogleCalendarApi, incrementalAuthUrl } from '@collected/core/ingest/gcal/api';
import { TASKS_SCOPE } from '@collected/core/ingest/gtasks/api';
import { gtasksIngester } from '@collected/core/ingest/gtasks/ingest';
import { gcalIngester } from '@collected/core/ingest/gcal/ingest';
import { runIngester } from '@collected/core/ingest/runner';
import { NotConfiguredError } from '@collected/core/ingest/types';
import type { AppContext } from '../context.js';
import { getSourceRow, mergeSourceMeta, setSourceConfig, setSourceStatus } from '@collected/core/lib/sources';
import { sources } from '@collected/core/db/schema';
import { eq } from 'drizzle-orm';

/** Which source a connect flow is for. Calendar and Tasks share the client and the callback, not the consent. */
export type GoogleConnectTarget = 'gcal' | 'gtasks';
type Target = GoogleConnectTarget;

/**
 * state → who started the flow, for which source, when it expires, and the PKCE verifier whose challenge went on the
 * auth URL. Bound to the identity so a callback URL cannot be handed to another browser; the verifier never leaves
 * this process, so a code that leaks is useless without it.
 */
const pendingStates = new Map<string, { user: string | null; exp: number; target: Target; verifier: string }>();
const STATE_TTL_MS = 10 * 60_000;

/** Reason codes the settings page knows; nothing from Google or an exception reaches the URL. */
export type GoogleConnectReason = 'denied' | 'expired' | 'exchange' | 'config' | 'unknown';

/** What a callback ended in, for a caller that cannot see the browser (the CLI's `connect google`). */
export type GoogleConnectResult = { target: Target; ok: true } | { target: Target; ok: false; reason: GoogleConnectReason };

export interface GoogleRouteOptions {
  /** Called once per callback, after the source row is final and before the browser is redirected. */
  onResult?: ((r: GoogleConnectResult) => void) | undefined;
}

function settingsUrl(ctx: AppContext, q: string): string {
  return `${ctx.env.PUBLIC_URL.replace(/\/$/, '')}/settings/sources?${q}`;
}

type Reason = GoogleConnectReason;
const failedUrl = (ctx: AppContext, reason: Reason, target: Target = 'gcal') => settingsUrl(ctx, `google=error&reason=${reason}${target === 'gtasks' ? '&source=gtasks' : ''}`);

/** OAuth connect flow. Both routes are hit by the browser, so Cloudflare Access covers them in prod. */
export function googleRoutes(ctx: AppContext, opts: GoogleRouteOptions = {}) {
  const r = new Hono<{ Variables: AuthVariables }>();
  const report = (res: GoogleConnectResult) => opts.onResult?.(res);
  const failed = (reason: Reason, target: Target = 'gcal') => {
    report({ target, ok: false, reason });
    return failedUrl(ctx, reason, target);
  };

  r.get('/start', (c) => {
    try {
      const now = Date.now();
      for (const [k, v] of pendingStates) if (v.exp < now) pendingStates.delete(k);
      const state = randomBytes(16).toString('hex');
      const target: Target = c.req.query('source') === 'gtasks' ? 'gtasks' : 'gcal';
      const pkce = createPkce();
      pendingStates.set(state, { user: c.get('user') ?? null, exp: now + STATE_TTL_MS, target, verifier: pkce.verifier });
      // Tasks is a separate, incremental consent: only the tasks scope, on top of whatever was granted before.
      return c.redirect(target === 'gtasks' ? incrementalAuthUrl(ctx.env, state, [TASKS_SCOPE], pkce.challenge) : authUrl(ctx.env, state, pkce.challenge));
    } catch (err) {
      if (err instanceof NotConfiguredError) return c.redirect(settingsUrl(ctx, `google=unconfigured`));
      throw err;
    }
  });

  r.get('/callback', async (c) => {
    const { code, state, error } = c.req.query();
    const pending = state ? pendingStates.get(state) : undefined;
    pendingStates.delete(state ?? '');
    if (error) return c.redirect(failed(error === 'access_denied' ? 'denied' : 'unknown', pending?.target));
    if (!code || !pending || pending.exp < Date.now() || pending.user !== (c.get('user') ?? null)) return c.redirect(failed('expired', pending?.target));
    if (pending.target === 'gtasks') return c.redirect(await connectTasks(ctx, code, pending.verifier, report));
    try {
      const { refreshToken } = await exchangeCode(ctx.env, code, pending.verifier);
      if (!refreshToken) return c.redirect(failed('exchange'));
      await setSourceConfig(ctx, 'gcal', { refreshToken });
      const api = GoogleCalendarApi.fromRefreshToken(ctx.env, refreshToken);
      const calendars = await api.listCalendars();
      const primary = calendars.find((k) => k.primary)?.id;
      // A reconnect (expired refresh token) keeps the user's calendar selection; only a first connect starts from primary.
      const previous = ((await getSourceRow(ctx, 'gcal')).meta as { selectedCalendars?: string[]; defaultCalendarId?: string | null }) ?? {};
      const stillThere = (previous.selectedCalendars ?? []).filter((id) => calendars.some((k) => k.id === id));
      const selectedCalendars = stillThere.length ? stillThere : primary ? [primary] : [];
      const defaultCalendarId = previous.defaultCalendarId && calendars.some((k) => k.id === previous.defaultCalendarId) ? previous.defaultCalendarId : (primary ?? null);
      await mergeSourceMeta(ctx, 'gcal', { calendars, selectedCalendars, defaultCalendarId, syncTokens: {} });
      await ctx.db.update(sources).set({ enabled: true }).where(eq(sources.id, 'gcal'));
      await setSourceStatus(ctx, 'gcal', 'connected', { lastError: null });
      ctx.log.info({ calendars: calendars.length }, 'google calendar connected');
      void runIngester(ctx, gcalIngester, { force: true });
      report({ target: 'gcal', ok: true });
      return c.redirect(settingsUrl(ctx, 'google=connected'));
    } catch (err) {
      ctx.log.error({ err }, 'google oauth callback failed');
      return c.redirect(failed(err instanceof NotConfiguredError ? 'config' : 'exchange'));
    }
  });

  return r;
}

/**
 * Stores the Tasks refresh token under `gtasks` (gcal's stays as it was) and runs the first sync before redirecting,
 * so a Tasks API that is not enabled in the Cloud project shows up as the card's error rather than a silent success.
 */
async function connectTasks(ctx: AppContext, code: string, verifier: string, report: (r: GoogleConnectResult) => void): Promise<string> {
  const failed = (reason: Reason) => {
    report({ target: 'gtasks', ok: false, reason });
    return failedUrl(ctx, reason, 'gtasks');
  };
  try {
    const { refreshToken, scopes } = await exchangeCode(ctx.env, code, verifier);
    if (!refreshToken) return failed('exchange');
    // Granular consent lets the user untick the scope; a token without it would only ever 403.
    if (scopes.length && !scopes.includes(TASKS_SCOPE)) return failed('denied');
    await setSourceConfig(ctx, 'gtasks', { refreshToken });
    await ctx.db.update(sources).set({ enabled: true }).where(eq(sources.id, 'gtasks'));
    await setSourceStatus(ctx, 'gtasks', 'disconnected', { lastError: null });
    const outcome = await runIngester(ctx, gtasksIngester, { force: true });
    ctx.log.info({ ok: outcome.ok }, 'google tasks connected');
    if (!outcome.ok) return failed('unknown');
    report({ target: 'gtasks', ok: true });
    return settingsUrl(ctx, 'google=connected&source=gtasks');
  } catch (err) {
    ctx.log.error({ err }, 'google tasks oauth callback failed');
    return failed(err instanceof NotConfiguredError ? 'config' : 'exchange');
  }
}
