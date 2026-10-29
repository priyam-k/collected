import { closeSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from 'node:fs';
import path from 'node:path';

/*
 * A per-name lock that works across processes: a file under `<dataDir>/sync.lock/` created with O_EXCL, holding the
 * pid and start time of the holder. The runner's in-memory mutex covers one process; the CLI's local mode has several
 * (`collected ui`, a read that syncs first, the daemon's `sync all`) on one database, and two of them syncing the same
 * source at once would race the soft-delete pass. The lock is advisory and self-healing: a file whose pid is gone or
 * whose mtime is older than the cut-off is treated as stale and taken over, so a killed process never wedges a source.
 */

export const LOCK_DIR = 'sync.lock';

export interface LockInfo {
  pid: number;
  startedAt: string;
}

export interface Lock {
  file: string;
  release(): void;
}

const lockFile = (dataDir: string, name: string): string => path.join(dataDir, LOCK_DIR, name);

/** Whether a lock file is held: it exists, is younger than `staleMs`, and its pid is alive. */
export function isLocked(dataDir: string, name: string, staleMs: number): boolean {
  return readHolder(lockFile(dataDir, name), staleMs) !== null;
}

/** The lock's holder when it is live; null when the file is missing, stale or orphaned. */
export function readHolder(file: string, staleMs: number): LockInfo | null {
  let mtime: number;
  try {
    mtime = statSync(file).mtimeMs;
  } catch {
    return null;
  }
  if (Date.now() - mtime > staleMs) return null;
  let info: LockInfo | null = null;
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<LockInfo>;
    if (typeof raw.pid === 'number') info = { pid: raw.pid, startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : '' };
  } catch {
    // half-written or empty: the holder is mid-create; treat the file as held until it goes stale
    return { pid: 0, startedAt: '' };
  }
  if (!info) return { pid: 0, startedAt: '' };
  if (info.pid !== process.pid && !alive(info.pid)) return null;
  return info;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Takes the lock, or returns null when a live process holds it. A stale or orphaned file is removed and the lock
 * taken; the O_EXCL create decides between two takers that saw the same stale file.
 */
export function acquireLock(dataDir: string, name: string, staleMs: number): Lock | null {
  const file = lockFile(dataDir, name);
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(file, 'wx', 0o600);
      try {
        writeSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() } satisfies LockInfo));
      } finally {
        closeSync(fd);
      }
      return {
        file,
        release() {
          try {
            unlinkSync(file);
          } catch {
            // already removed (a staleness takeover): nothing to release
          }
        },
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      if (readHolder(file, staleMs)) return null;
      try {
        unlinkSync(file);
      } catch {
        // someone else broke it first; the next create attempt decides
      }
    }
  }
  return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** `acquireLock` that waits up to `waitMs` for a live holder to finish, polling; null when it never freed. */
export async function acquireLockWaiting(dataDir: string, name: string, staleMs: number, waitMs: number): Promise<Lock | null> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const lock = acquireLock(dataDir, name, staleMs);
    if (lock || Date.now() >= deadline) return lock;
    await sleep(100);
  }
}
