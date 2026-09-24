import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/libsql/migrator';
import type { Db } from './client.js';

/**
 * Finds server/drizzle whether we run from src/db (tsx) or dist (tsup bundle):
 * walk up from this file until a `drizzle/meta/_journal.json` appears.
 */
export function defaultMigrationsFolder(): string {
  if (process.env.MIGRATIONS_DIR) return path.resolve(process.env.MIGRATIONS_DIR);
  let dir = import.meta.dirname;
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, 'drizzle');
    if (existsSync(path.join(candidate, 'meta', '_journal.json'))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Could not locate drizzle migrations folder starting from ${import.meta.dirname}`);
}

/** Timestamps (the journal's `when`) already recorded in __drizzle_migrations; empty on a fresh database. */
async function appliedTimestamps(db: Db): Promise<Set<number>> {
  try {
    const rows = await db.all<{ created_at: number }>(sql`select created_at from __drizzle_migrations`);
    return new Set(rows.map((r) => Number(r.created_at)));
  } catch {
    return new Set();
  }
}

/**
 * Applies pending migrations and returns the tags it applied (e.g. ["0004_drop_applications"]), so boot can
 * log what changed. Drizzle's migrator is silent otherwise; it records each migration's journal `when` in
 * __drizzle_migrations, which is what we diff.
 */
export async function runMigrations(db: Db, folder = defaultMigrationsFolder()): Promise<string[]> {
  const before = await appliedTimestamps(db);
  await migrate(db, { migrationsFolder: folder });
  const after = await appliedTimestamps(db);
  const journal = JSON.parse(readFileSync(path.join(folder, 'meta', '_journal.json'), 'utf8')) as { entries: { when: number; tag: string }[] };
  return journal.entries.filter((e) => after.has(e.when) && !before.has(e.when)).map((e) => e.tag);
}
