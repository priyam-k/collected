import { eq } from 'drizzle-orm';
import type { SourceId, SourceStatus } from '@collected/shared';
import type { AppContext } from '../context.js';
import { sources, type SourceRow } from '../db/schema.js';

export async function getSourceRow(ctx: AppContext, id: SourceId): Promise<SourceRow> {
  const row = await ctx.db.query.sources.findFirst({ where: eq(sources.id, id) });
  if (!row) throw new Error(`source ${id} missing (seed should have created it)`);
  return row;
}

export class UndecryptableConfigError extends Error {
  constructor(id: SourceId) {
    super(`Stored ${id} credentials were encrypted with a different SECRET_KEY. Re-enter them in Settings → Sources.`);
    this.name = 'UndecryptableConfigError';
  }
}

export async function getSourceConfig<T>(ctx: AppContext, id: SourceId): Promise<T | null> {
  const row = await getSourceRow(ctx, id);
  if (!row.configEnc) return null;
  try {
    return ctx.crypto.decryptJson<T>(row.configEnc);
  } catch (err) {
    ctx.log.error({ err, source: id }, 'could not decrypt source config (SECRET_KEY changed?)');
    throw new UndecryptableConfigError(id);
  }
}

/**
 * Replace a source's secret config. The Canvas base URL is not a secret and the settings form needs it back to
 * prefill its field, so it is mirrored into the public `meta.baseUrl` on every write (the cookie stays encrypted);
 * it survives a clear so a replaced cookie does not mean retyping the school's address.
 */
export async function setSourceConfig(ctx: AppContext, id: SourceId, config: unknown | null): Promise<void> {
  await ctx.db
    .update(sources)
    .set({ configEnc: config == null ? null : ctx.crypto.encryptJson(config) })
    .where(eq(sources.id, id));
  if (id === 'canvas') {
    const c = (config && typeof config === 'object' ? config : {}) as { baseUrl?: unknown; accessToken?: unknown; cookieHeader?: unknown; cookieJar?: unknown };
    // Which kind of credential is stored, never its value: the card says "access token" or "browser session".
    const auth: CanvasAuthKind = typeof c.accessToken === 'string' && c.accessToken.trim() ? 'token' : c.cookieHeader || c.cookieJar ? 'cookie' : null;
    await mergeSourceMeta(ctx, 'canvas', { auth, ...(typeof c.baseUrl === 'string' && c.baseUrl ? { baseUrl: c.baseUrl } : {}) });
  }
}

/** What `meta.auth` on the Canvas source says about the stored credential; null when there is none. */
export type CanvasAuthKind = 'token' | 'cookie' | null;

export async function mergeSourceMeta(ctx: AppContext, id: SourceId, patch: Record<string, unknown>): Promise<void> {
  const row = await getSourceRow(ctx, id);
  await ctx.db
    .update(sources)
    .set({ meta: { ...row.meta, ...patch } })
    .where(eq(sources.id, id));
}

export async function setSourceStatus(
  ctx: AppContext,
  id: SourceId,
  status: SourceStatus,
  extra: { lastError?: string | null; lastRunAt?: string; lastSuccessAt?: string } = {},
): Promise<void> {
  await ctx.db.update(sources).set({ status, ...extra }).where(eq(sources.id, id));
}
