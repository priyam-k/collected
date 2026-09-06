import { existsSync } from 'node:fs';
import path from 'node:path';
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

export async function runMigrations(db: Db, folder = defaultMigrationsFolder()): Promise<void> {
  await migrate(db, { migrationsFolder: folder });
}
