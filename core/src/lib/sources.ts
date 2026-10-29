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

export async function setSourceConfig(ctx: AppContext, id: SourceId, config: unknown | null): Promise<void> {
  await ctx.db
    .update(sources)
    .set({ configEnc: config == null ? null : ctx.crypto.encryptJson(config) })
    .where(eq(sources.id, id));
}

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
