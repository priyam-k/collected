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
}
