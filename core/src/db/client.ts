import { chmodSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createClient, type Client } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from './schema.js';

export type Db = LibSQLDatabase<typeof schema>;

/** The client behind each `openDb` database, so a process that is shutting down can close the file (closeDb). */
const clients = new WeakMap<Db, Client>();

export interface DbHandle {
  db: Db;
  client: Client;
  file: string;
}

/** Owner-only mode on the database and its WAL: every credential ciphertext is in there and the key file sits beside it. */
function restrictMode(file: string): void {
  for (const f of [file, `${file}-wal`]) {
    try {
      chmodSync(f, 0o600);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }
}

export async function openDb(dataDir: string, fileName = 'collected.db'): Promise<DbHandle> {
  mkdirSync(dataDir, { recursive: true });
  const file = path.resolve(dataDir, fileName);
  const client = createClient({ url: `file:${file}` });
  // WAL lets a reader (the CLI answering a question) proceed while a writer (the scheduler in `collected ui`, the
  // daemon's sync) commits; the busy timeout makes a second writer wait instead of failing with SQLITE_BUSY.
  await client.execute('PRAGMA journal_mode = WAL');
  // With WAL, NORMAL fsyncs at checkpoints instead of every commit. A crash can lose the last few commits
  // but never corrupts; everything here is re-fetchable from its source, and small VPS disks are IOPS-bound.
  await client.execute('PRAGMA synchronous = NORMAL');
  await client.execute(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
  await client.execute('PRAGMA foreign_keys = ON');
  restrictMode(file);
  const db = drizzle(client, { schema });
  clients.set(db, client);
  return { db, client, file };
}

/** How long a statement waits for another connection's write lock before SQLITE_BUSY. */
export const BUSY_TIMEOUT_MS = 5000;

/** Closes the file behind a database `openDb` returned; a no-op for in-memory and already-closed ones. */
export function closeDb(db: Db): void {
  const client = clients.get(db);
  if (!client) return;
  clients.delete(db);
  try {
    client.close();
  } catch {
    // already closed
  }
}

/** In-memory database for tests. */
export async function openMemoryDb(): Promise<DbHandle> {
  const client = createClient({ url: ':memory:' });
  const db = drizzle(client, { schema });
  return { db, client, file: ':memory:' };
}
