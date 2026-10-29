import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import pino from 'pino';
import type { CoreConfig } from './config.js';
import type { AppContext } from './context.js';
import * as schema from './db/schema.js';
import { runMigrations } from './db/migrate.js';
import { createCrypto } from './lib/crypto.js';
import { seed } from './seed.js';

/** A fresh config for one test: no seed file, nothing configured, the update check on so its tests can exercise it. */
export function testConfig(): CoreConfig {
  return {
    DATA_DIR: ':memory:',
    SECRET_KEY: 'c'.repeat(64),
    PUBLIC_URL: 'http://localhost:5173',
    UPSTREAM_REPO: 'priyam-k/collected',
    UPDATE_CHECK_DISABLED: false,
    SEED_CONFIG_PATH: '/nonexistent/seed.json',
    packageVersion: 'test',
  };
}

/** In-memory app context with migrations applied and sources seeded (no seed file). The server passes its wider Env. */
export async function testContext<C extends CoreConfig = CoreConfig>(config: C = testConfig() as C): Promise<AppContext<C>> {
  const client = createClient({ url: ':memory:' });
  const db = drizzle(client, { schema });
  await runMigrations(db);
  const ctx: AppContext<C> = {
    env: config,
    db,
    log: pino({ level: 'silent' }),
    crypto: createCrypto('c'.repeat(64)),
    version: 'test',
    build: { commit: 'dev', builtAt: null },
  };
  await seed(ctx);
  return ctx;
}
