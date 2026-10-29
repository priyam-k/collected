import { eq } from 'drizzle-orm';
import type { z } from 'zod';
import type { AppContext } from '../context.js';
import { settings } from '../db/schema.js';

export async function getSetting<T = unknown>(ctx: AppContext, key: string): Promise<T | undefined> {
  const row = await ctx.db.query.settings.findFirst({ where: eq(settings.key, key) });
  return row?.value as T | undefined;
}

/** Reads a setting and validates it with a schema (which supplies defaults for missing fields). */
export async function getSettingParsed<S extends z.ZodTypeAny>(ctx: AppContext, key: string, schema: S): Promise<z.infer<S>> {
  const raw = await getSetting(ctx, key);
  const parsed = schema.safeParse(raw ?? {});
  if (parsed.success) return parsed.data;
  ctx.log.warn({ key, issues: parsed.error.issues }, 'setting failed validation; using defaults');
  return schema.parse({});
}

export async function setSetting(ctx: AppContext, key: string, value: unknown): Promise<void> {
  await ctx.db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date().toISOString() } });
}

export async function allSettings(ctx: AppContext): Promise<Record<string, unknown>> {
  const rows = await ctx.db.select().from(settings);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
