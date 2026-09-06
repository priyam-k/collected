import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createClient, type Client } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from './schema.js';

export type Db = LibSQLDatabase<typeof schema>;

export interface DbHandle {
  db: Db;
  client: Client;
  file: string;
}

export async function openDb(dataDir: string, fileName = 'collected.db'): Promise<DbHandle> {
  mkdirSync(dataDir, { recursive: true });
  const file = path.resolve(dataDir, fileName);
  const client = createClient({ url: `file:${file}` });
  await client.execute('PRAGMA journal_mode = WAL');
  await client.execute('PRAGMA busy_timeout = 5000');
  await client.execute('PRAGMA foreign_keys = ON');
  const db = drizzle(client, { schema });
  return { db, client, file };
}

/** In-memory database for tests. */
export async function openMemoryDb(): Promise<DbHandle> {
  const client = createClient({ url: ':memory:' });
  const db = drizzle(client, { schema });
  return { db, client, file: ':memory:' };
}
