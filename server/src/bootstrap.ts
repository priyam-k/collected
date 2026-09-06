import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { AppContext } from './context.js';
import { openDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { loadEnv } from './env.js';
import { createCrypto } from './lib/crypto.js';
import { createLogger } from './lib/log.js';
import { seed } from './seed.js';

function readVersion(rootDir: string): string {
  try {
    const pkg = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** Shared startup for the server and the CLI: env → logger → db → migrate → seed. */
export async function bootstrap(opts: { quiet?: boolean } = {}): Promise<AppContext> {
  const env = loadEnv();
  const log = createLogger(opts.quiet ? 'warn' : env.LOG_LEVEL, env.NODE_ENV !== 'production');
  const { db } = await openDb(env.DATA_DIR);
  await runMigrations(db);
  const ctx: AppContext = { env, db, log, crypto: createCrypto(env.SECRET_KEY), version: readVersion(env.rootDir) };
  await seed(ctx);
  return ctx;
}
