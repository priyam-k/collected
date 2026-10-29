import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createContext } from '../bootstrap.js';
import type { CoreConfig } from '../config.js';
import type { AppContext } from '../context.js';
import { canvasIngester } from '../ingest/canvas/ingest.js';
import { isRunning, runIngester } from '../ingest/runner.js';
import { loadDemo } from '../lib/demo.js';
import { acquireLock } from '../lib/sync-lock.js';
import { BUSY_TIMEOUT_MS, closeDb } from './client.js';
import { items, sources } from './schema.js';

/*
 * Two contexts on one SQLite file, the way `collected ui` and a CLI read share the local database: both open at once
 * (the migration lock keeps the second from re-running what the first applied), one syncs while the other reads, and
 * the file lock makes a run in one visible to the other.
 */
describe('two processes on one database', () => {
  let dir: string;
  let a: AppContext;
  let b: AppContext;
  const config = (dataDir: string): CoreConfig => ({
    DATA_DIR: dataDir,
    SECRET_KEY: 'c'.repeat(64),
    PUBLIC_URL: 'http://127.0.0.1',
    UPSTREAM_REPO: 'priyam-k/collected',
    UPDATE_CHECK_DISABLED: true,
    SEED_CONFIG_PATH: '/nonexistent/seed.json',
    packageVersion: 'test',
  });

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'collected-two-'));
    const log = pino({ level: 'silent' });
    // Opened concurrently: the same race a `ui` and a read would run on an un-migrated file.
    [a, b] = await Promise.all([createContext(config(dir), { log }), createContext(config(dir), { log })]);
  }, 30_000);
  afterAll(() => {
    closeDb(a.db);
    closeDb(b.db);
    rmSync(dir, { recursive: true, force: true });
  });

  it('opens in WAL mode with a busy timeout', async () => {
    const [mode] = await a.db.all<{ journal_mode: string }>(sql`pragma journal_mode`);
    expect(mode!.journal_mode).toBe('wal');
    const [busy] = await b.db.all<{ timeout: number }>(sql`pragma busy_timeout`);
    expect(busy!.timeout).toBe(BUSY_TIMEOUT_MS);
  });

  it('both contexts see one migrated, seeded schema', async () => {
    const [applied] = await a.db.all<{ n: number }>(sql`select count(*) as n from __drizzle_migrations`);
    expect(applied!.n).toBeGreaterThan(0);
    expect((await b.db.select().from(sources)).map((s) => s.id)).toContain('canvas');
  });

  it('a sync in one context is read by the other', async () => {
    const loaded = await loadDemo(a, 'todoist');
    expect(loaded.counts.upserted ?? 0).toBeGreaterThan(0);
    const seen = await b.db.select().from(items).where(sql`${items.source} = 'todoist'`);
    expect(seen.some((i) => i.title === 'Buy oat milk')).toBe(true);
    const row = (await b.db.select().from(sources).where(sql`${sources.id} = 'todoist'`))[0]!;
    expect(row.status).toBe('connected');
  });

  it('a run held by another process is skipped, and shows as running, in this one', async () => {
    const held = acquireLock(dir, 'canvas', 60_000)!;
    expect(held).not.toBeNull();
    expect(isRunning('canvas', { dataDir: dir })).toBe(true);
    expect(await runIngester(b, canvasIngester, { force: true })).toEqual({ ok: false, skipped: 'running' });
    held.release();
    expect(isRunning('canvas', { dataDir: dir })).toBe(false);
    // Unconfigured here, so the run ends `disconnected`; what matters is that it ran and released the lock.
    const outcome = await runIngester(b, canvasIngester, { force: true });
    expect(outcome.ok).toBe(false);
    expect('status' in outcome && outcome.status).toBe('disconnected');
    expect(isRunning('canvas', { dataDir: dir })).toBe(false);
  });
});
