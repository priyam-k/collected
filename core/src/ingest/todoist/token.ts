import { sourceConfigSchemas } from '@collected/shared';
import type { z } from 'zod';
import { refreshTodoistToken } from '../../auth/todoist.js';
import type { AppContext } from '../../context.js';
import { getSourceConfig, setSourceConfig } from '../../lib/sources.js';
import { NotConfiguredError } from '../types.js';

/*
 * Which Todoist access token to send right now. A pasted API token is used as it is. An OAuth grant from a
 * refresh-enabled Todoist app lives an hour, so it is renewed when it is about to expire, or when Todoist has just
 * refused it, and the rotated refresh token is written back before anyone else may use it. Renewals run one at a
 * time in this process: two callers racing on the same refresh token would be a replay to Todoist, and a replay
 * after a minute revokes every token the person has for the app. Each caller re-reads the stored config under the
 * lock, so the second one in line finds the first one's new token and sends nothing to Todoist.
 */

export type TodoistStoredConfig = z.infer<typeof sourceConfigSchemas.todoist>;

/** Renew this long before the recorded expiry, so a sync that starts near the end does not run into it. */
const RENEW_AHEAD_MS = 5 * 60_000;

let queue: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => undefined);
  return next;
}

export interface CurrentTokenOptions {
  /** The token Todoist just answered 401 to; renew only if it is still the stored one. */
  rejected?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/**
 * The token to use. Throws NotConfiguredError with no credentials, NeedsAuthError (a TodoistReauthError) when
 * Todoist refuses the refresh token. For a pasted token after a rejection it returns that same token: the caller
 * sees nothing changed and reports the 401 as it stands.
 */
export function currentTodoistToken(ctx: AppContext, opts: CurrentTokenOptions = {}): Promise<string> {
  return oneAtATime(async () => {
    const now = opts.now ?? Date.now;
    const raw = await getSourceConfig<TodoistStoredConfig>(ctx, 'todoist');
    if (!raw?.token) throw new NotConfiguredError('Todoist API token not set');
    const cfg = sourceConfigSchemas.todoist.parse(raw);
    if (!cfg.refreshToken) return cfg.token;
    if (opts.rejected !== undefined && opts.rejected !== cfg.token) return cfg.token; // renewed by whoever was ahead in the queue
    const expiring = !cfg.expiresAt || Date.parse(cfg.expiresAt) - now() < RENEW_AHEAD_MS;
    if (opts.rejected === undefined && !expiring) return cfg.token;
    const grant = await refreshTodoistToken(ctx.env, cfg.refreshToken, opts.fetchImpl ?? fetch, now);
    const next: TodoistStoredConfig = { token: grant.token, refreshToken: grant.refreshToken ?? cfg.refreshToken };
    if (grant.expiresAt) next.expiresAt = grant.expiresAt;
    await setSourceConfig(ctx, 'todoist', next);
    ctx.log.info({ reason: opts.rejected !== undefined ? 'rejected' : 'expiring', rotated: !!grant.refreshToken }, 'todoist access token renewed');
    return next.token;
  });
}
