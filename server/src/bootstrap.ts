import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { AppContext } from './context.js';
import { openDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { loadEnv } from './env.js';
import { createCrypto } from './lib/crypto.js';
import { createLogger } from './lib/log.js';
import { resolveBuildInfo } from './lib/version.js';
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
  const applied = await runMigrations(db);
  if (applied.length) log.info({ applied: [...applied], snapshot: applied.snapshot }, 'migrations applied');
  else log.debug('schema up to date');
  const ctx: AppContext = { env, db, log, crypto: createCrypto(env.SECRET_KEY), version: readVersion(env.rootDir), build: resolveBuildInfo(env.rootDir, env.COLLECTED_COMMIT) };
  log.debug({ secretKeySource: env.secretKeySource, dataDir: env.DATA_DIR }, 'encryption key loaded');
  await seed(ctx);
  return ctx;
}
