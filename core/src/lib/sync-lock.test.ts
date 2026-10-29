import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LOCK_DIR, acquireLock, acquireLockWaiting, isLocked, readHolder } from './sync-lock.js';

describe('sync lock', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'collected-lock-'));
    mkdirSync(path.join(dir, LOCK_DIR));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('takes, reports and releases a lock file holding this pid', () => {
    const lock = acquireLock(dir, 'canvas', 60_000);
    expect(lock).not.toBeNull();
    expect(lock!.file).toBe(path.join(dir, LOCK_DIR, 'canvas'));
    expect(JSON.parse(readFileSync(lock!.file, 'utf8')).pid).toBe(process.pid);
    expect(isLocked(dir, 'canvas', 60_000)).toBe(true);
    expect(acquireLock(dir, 'canvas', 60_000)).toBeNull();
    expect(acquireLock(dir, 'gradescope', 60_000)).not.toBeNull();
    lock!.release();
    expect(existsSync(lock!.file)).toBe(false);
    expect(isLocked(dir, 'canvas', 60_000)).toBe(false);
    lock!.release(); // twice is fine
  });

  it('takes over a lock whose holder is gone, and one past the staleness cut-off', () => {
    const file = path.join(dir, LOCK_DIR, 'canvas');
    const dead = 2 ** 30; // no such pid on any platform
    writeFileSync(file, JSON.stringify({ pid: dead, startedAt: new Date().toISOString() }), { mode: 0o600 });
    expect(readHolder(file, 60_000)).toBeNull();
    expect(isLocked(dir, 'canvas', 60_000)).toBe(false);
    const lock = acquireLock(dir, 'canvas', 60_000);
    expect(lock).not.toBeNull();
    lock!.release();

    // Our own pid is alive, but the file is older than the cut-off: a run that hung and was killed with SIGKILL.
    writeFileSync(file, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), { mode: 0o600 });
    const old = new Date(Date.now() - 10 * 60_000);
    utimesSync(file, old, old);
    expect(isLocked(dir, 'canvas', 60_000)).toBe(false);
    expect(acquireLock(dir, 'canvas', 60_000)).not.toBeNull();
  });

  it('treats a half-written file as held until it goes stale', () => {
    const file = path.join(dir, LOCK_DIR, 'canvas');
    writeFileSync(file, '', { mode: 0o600 });
    expect(isLocked(dir, 'canvas', 60_000)).toBe(true);
    expect(acquireLock(dir, 'canvas', 60_000)).toBeNull();
    const old = new Date(Date.now() - 120_000);
    utimesSync(file, old, old);
    expect(acquireLock(dir, 'canvas', 60_000)).not.toBeNull();
  });

  it('waits for a live holder and gives up at the deadline', async () => {
    const held = acquireLock(dir, 'migrate', 60_000)!;
    const t0 = Date.now();
    expect(await acquireLockWaiting(dir, 'migrate', 60_000, 300)).toBeNull();
    expect(Date.now() - t0).toBeGreaterThanOrEqual(250);
    setTimeout(() => held.release(), 150);
    const got = await acquireLockWaiting(dir, 'migrate', 60_000, 5_000);
    expect(got).not.toBeNull();
    got!.release();
  });
});
