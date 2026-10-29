import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/libsql/migrator';
import type { Db } from './client.js';

/**
 * Finds the package's own drizzle/ whether we run from src/db (tsx) or a bundle next to it: walk up from this file
 * until a `drizzle/meta/_journal.json` appears. The server passes an explicit folder (MIGRATIONS_DIR) when it has one.
 */
export function defaultMigrationsFolder(): string {
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

interface Journal {
  entries: { when: number; tag: string }[];
}

function readJournal(folder: string): Journal {
  return JSON.parse(readFileSync(path.join(folder, 'meta', '_journal.json'), 'utf8')) as Journal;
}

/** Path of the `main` database file, or null for `:memory:` and other non-file databases. */
async function databaseFile(db: Db): Promise<string | null> {
  const rows = await db.all<{ name: string; file: string }>(sql`pragma database_list`);
  const main = rows.find((r) => r.name === 'main');
  return main?.file ? main.file : null;
}

/** How many `pre-*.db` snapshots to keep in `<data dir>/backups`. */
export const SNAPSHOTS_KEPT = 3;

function timestamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * Consistent single-file copy of the live database via `VACUUM INTO` (no `-wal`/`-shm` to carry along), written
 * to `<data dir>/backups/pre-<tag>-<YYYYMMDD-HHMMSS>.db`, mode 0600. Older `pre-*.db` files beyond SNAPSHOTS_KEPT
 * are removed. Returns the snapshot path.
 */
export async function snapshotBeforeMigration(db: Db, file: string, tag: string): Promise<string> {
  const dir = path.join(path.dirname(file), 'backups');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const target = path.join(dir, `pre-${tag}-${timestamp()}.db`);
  // VACUUM INTO refuses to overwrite; same tag within the same second is the only way to collide.
  if (existsSync(target)) unlinkSync(target);
  await db.run(sql.raw(`VACUUM INTO '${target.replace(/'/g, "''")}'`));
  chmodSync(target, 0o600);
  pruneSnapshots(dir);
  return target;
}

function pruneSnapshots(dir: string): void {
  const files = readdirSync(dir)
    .filter((f) => /^pre-.*\.db$/.test(f))
    .map((f) => ({ f, mtime: statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const { f } of files.slice(SNAPSHOTS_KEPT)) {
    try {
      unlinkSync(path.join(dir, f));
    } catch {
      /* already gone */
    }
  }
}

/** The tags that were applied, plus the pre-migration snapshot path (null when nothing was pending or the db is in memory). */
export type AppliedMigrations = string[] & { snapshot: string | null };

/**
 * Applies pending migrations and returns the tags it applied (e.g. ["0004_drop_applications"]), so boot can
 * log what changed. Drizzle's migrator is silent otherwise; it records each migration's journal `when` in
 * __drizzle_migrations, which is what we diff.
 *
 * When at least one migration is pending and the database is a file on disk, a snapshot is taken first
 * (see snapshotBeforeMigration); its path is on the returned array's `snapshot` property so the caller can
 * log it next to the tags. Nothing here can undo a migration: restore is "stop the app, copy the snapshot
 * over collected.db, delete -wal/-shm, start the previous image".
 */
export async function runMigrations(db: Db, folder = defaultMigrationsFolder()): Promise<AppliedMigrations> {
  const before = await appliedTimestamps(db);
  const journal = readJournal(folder);
  const pending = journal.entries.filter((e) => !before.has(e.when));

  let snapshot: string | null = null;
  if (pending.length) {
    const file = await databaseFile(db);
    if (file) snapshot = await snapshotBeforeMigration(db, file, pending[0]!.tag);
  }

  await migrate(db, { migrationsFolder: folder });
  const after = await appliedTimestamps(db);
  const applied = journal.entries.filter((e) => after.has(e.when) && !before.has(e.when)).map((e) => e.tag);
  return Object.assign(applied, { snapshot });
}
