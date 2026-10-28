import type { Db } from './db/client.js';
import type { Env } from './env.js';
import type { Crypto } from './lib/crypto.js';
import type { Logger } from './lib/log.js';

/** Everything a route or ingester needs. Built once in index.ts / cli.ts. */
export interface AppContext {
  env: Env;
  db: Db;
  log: Logger;
  crypto: Crypto;
  version: string;
  /** Git short sha and build time of the running code (lib/version.ts); commit is "dev" when neither is known. */
  build: BuildInfo;
}

export interface BuildInfo {
  commit: string;
  builtAt: string | null;
}
