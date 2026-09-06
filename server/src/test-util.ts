import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import pino from 'pino';
import type { AppContext } from './context.js';
import * as schema from './db/schema.js';
import { runMigrations } from './db/migrate.js';
import { createCrypto } from './lib/crypto.js';
import { seed } from './seed.js';

/** In-memory app context with migrations applied and sources seeded (no seed file). */
export async function testContext(): Promise<AppContext> {
  const client = createClient({ url: ':memory:' });
  const db = drizzle(client, { schema });
  await runMigrations(db);
  const ctx: AppContext = {
    env: {
      NODE_ENV: 'test',
      PORT: 0,
      DATA_DIR: ':memory:',
      SECRET_KEY: 'c'.repeat(64),
      AUTH_DISABLED: true,
      PUBLIC_URL: 'http://localhost:5173',
      SCHEDULER_DISABLED: true,
      LOG_LEVEL: 'silent',
      SEED_CONFIG_PATH: '/nonexistent/seed.json',
      rootDir: '/nonexistent',
    } as AppContext['env'],
    db,
    log: pino({ level: 'silent' }),
    crypto: createCrypto('c'.repeat(64)),
    version: 'test',
  };
  await seed(ctx);
  return ctx;
}
