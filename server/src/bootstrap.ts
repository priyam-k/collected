import type { AppContext } from './context.js';
import { openDb } from './db/client.js';
import { defaultMigrationsFolder, runMigrations } from './db/migrate.js';
import { loadEnv } from './env.js';
import { createCrypto } from './lib/crypto.js';
import { createLogger } from './lib/log.js';
import { resolveBuildInfo } from './lib/version.js';
import { seed } from './seed.js';

/** Shared startup for the server and the CLI: env → logger → db → migrate → seed. */
export async function bootstrap(opts: { quiet?: boolean } = {}): Promise<AppContext> {
  const env = loadEnv();
  const log = createLogger(opts.quiet ? 'warn' : env.LOG_LEVEL, env.NODE_ENV !== 'production');
  const { db } = await openDb(env.DATA_DIR);
  const applied = await runMigrations(db, env.MIGRATIONS_DIR ?? defaultMigrationsFolder());
  if (applied.length) log.info({ applied: [...applied], snapshot: applied.snapshot }, 'migrations applied');
  else log.debug('schema up to date');
  const ctx: AppContext = {
    env,
    db,
    log,
    crypto: createCrypto(env.SECRET_KEY),
    version: env.packageVersion,
    build: resolveBuildInfo({ fromEnv: env.COLLECTED_COMMIT, buildInfoFile: env.buildInfoFile, gitDir: env.gitDir }),
  };
  log.debug({ secretKeySource: env.secretKeySource, dataDir: env.DATA_DIR }, 'encryption key loaded');
  await seed(ctx);
  return ctx;
}
