import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, openMemoryDb, type DbHandle } from './client.js';
import { defaultMigrationsFolder, runMigrations, SNAPSHOTS_KEPT } from './migrate.js';

const fullFolder = defaultMigrationsFolder();
const journal = JSON.parse(readFileSync(path.join(fullFolder, 'meta', '_journal.json'), 'utf8')) as {
  entries: { when: number; tag: string }[];
};

/** A copy of the migrations folder whose journal stops after `count` entries, to stage a "partially migrated" db. */
function truncatedFolder(root: string, count: number): string {
  const dir = path.join(root, `migrations-${count}`);
  mkdirSync(path.join(dir, 'meta'), { recursive: true });
  const entries = journal.entries.slice(0, count);
  for (const e of entries) copyFileSync(path.join(fullFolder, `${e.tag}.sql`), path.join(dir, `${e.tag}.sql`));
  writeFileSync(path.join(dir, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries }));
  return dir;
}

const snapshots = (dataDir: string) => {
  try {
    return readdirSync(path.join(dataDir, 'backups')).filter((f) => /^pre-.*\.db$/.test(f)).sort();
  } catch {
    return [];
  }
};

describe('runMigrations', () => {
  let root: string;
  let dataDir: string;
  const handles: DbHandle[] = [];

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'collected-migrate-'));
    dataDir = path.join(root, 'data');
  });
  afterEach(() => {
    for (const h of handles.splice(0)) h.client.close();
    rmSync(root, { recursive: true, force: true });
  });

  async function open(): Promise<DbHandle> {
    const h = await openDb(dataDir);
    handles.push(h);
    return h;
  }

  it('snapshots a file database only when something is pending', async () => {
    const { db } = await open();

    const first = await runMigrations(db);
    expect(first.length).toBe(journal.entries.length);
    expect(first.snapshot).toMatch(new RegExp(`backups/pre-${journal.entries[0]!.tag}-\\d{8}-\\d{6}\\.db$`));
    expect(snapshots(dataDir)).toHaveLength(1);
    expect(statSync(first.snapshot!).mode & 0o777).toBe(0o600);

    const second = await runMigrations(db);
    expect([...second]).toEqual([]);
    expect(second.snapshot).toBeNull();
    expect(snapshots(dataDir)).toHaveLength(1);
  });

  it('names the snapshot after the first pending tag and takes it before applying', async () => {
    const { db } = await open();
    const partial = await runMigrations(db, truncatedFolder(root, 2));
    expect(partial.length).toBe(2);
    const before = snapshots(dataDir);

    const rest = await runMigrations(db);
    expect([...rest]).toEqual(journal.entries.slice(2).map((e) => e.tag));
    expect(rest.snapshot).toContain(`pre-${journal.entries[2]!.tag}-`);
    expect(snapshots(dataDir)).toHaveLength(before.length + 1);

    // The snapshot holds the schema as it was before: __drizzle_migrations has only the two earlier rows.
    const snap = await openDb(path.dirname(rest.snapshot!), path.basename(rest.snapshot!));
    handles.push(snap);
    const rows = await snap.client.execute('select count(*) as n from __drizzle_migrations');
    expect(Number(rows.rows[0]!.n)).toBe(2);
  });

  it('keeps only the newest snapshots', async () => {
    const { db } = await open();
    const backups = path.join(dataDir, 'backups');
    mkdirSync(backups, { recursive: true });
    const old = Date.now() / 1000 - 86400;
    for (let i = 0; i < SNAPSHOTS_KEPT; i++) {
      const f = path.join(backups, `pre-old${i}-20260101-00000${i}.db`);
      writeFileSync(f, '');
      utimesSync(f, old - i, old - i);
    }
    writeFileSync(path.join(backups, 'collected-2026-01-01.db'), '');

    const res = await runMigrations(db);
    const kept = snapshots(dataDir);
    expect(kept).toHaveLength(SNAPSHOTS_KEPT);
    expect(kept).toContain(path.basename(res.snapshot!));
    expect(kept).not.toContain(`pre-old${SNAPSHOTS_KEPT - 1}-20260101-00000${SNAPSHOTS_KEPT - 1}.db`);
    // Unrelated files in backups/ are left alone.
    expect(readdirSync(backups)).toContain('collected-2026-01-01.db');
  });

  it('does not snapshot an in-memory database', async () => {
    const h = await openMemoryDb();
    handles.push(h);
    const res = await runMigrations(h.db);
    expect(res.length).toBe(journal.entries.length);
    expect(res.snapshot).toBeNull();
  });
});
