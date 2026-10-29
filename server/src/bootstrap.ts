import { createContext, createLogger } from '@collected/core';
import type { AppContext } from './context.js';
import { loadEnv } from './env.js';

/** Shared startup for the server and the CLI: env → logger → core's createContext (db → migrate → seed). */
export async function bootstrap(opts: { quiet?: boolean } = {}): Promise<AppContext> {
  const env = loadEnv();
  const log = createLogger(opts.quiet ? 'warn' : env.LOG_LEVEL, env.NODE_ENV !== 'production');
  log.debug({ secretKeySource: env.secretKeySource, dataDir: env.DATA_DIR }, 'encryption key loaded');
  return createContext(env, { log });
}
