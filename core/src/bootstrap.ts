import type { CoreConfig } from './config.js';
import type { AppContext } from './context.js';
import { openDb } from './db/client.js';
import { defaultMigrationsFolder, runMigrations } from './db/migrate.js';
import { createCrypto } from './lib/crypto.js';
import type { Logger } from './lib/log.js';
import { resolveBuildInfo } from './lib/version.js';
import { seed } from './seed.js';

/**
 * Core's startup: open the database, apply pending migrations, build the context, seed. The caller owns the config
 * (every path already absolute) and the logger; the same object it passes as `config` is what `ctx.env` returns.
 */
export async function createContext<C extends CoreConfig>(config: C, opts: { log: Logger }): Promise<AppContext<C>> {
  const { log } = opts;
  const { db } = await openDb(config.DATA_DIR);
  const applied = await runMigrations(db, config.MIGRATIONS_DIR ?? defaultMigrationsFolder());
  if (applied.length) log.info({ applied: [...applied], snapshot: applied.snapshot }, 'migrations applied');
  else log.debug('schema up to date');
  const ctx: AppContext<C> = {
    env: config,
    db,
    log,
    crypto: createCrypto(config.SECRET_KEY),
    version: config.packageVersion,
    build: resolveBuildInfo({ fromEnv: config.COLLECTED_COMMIT, buildInfoFile: config.buildInfoFile, gitDir: config.gitDir }),
  };
  await seed(ctx);
  return ctx;
}
