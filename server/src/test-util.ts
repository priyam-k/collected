import { testConfig, testContext as coreTestContext } from '@collected/core/test-util';
import type { AppContext } from './context.js';
import type { Env } from './env.js';

/** Core's in-memory context, with the server-side env the routes and the auth middleware read. */
export function testContext(): Promise<AppContext> {
  const env = {
    ...testConfig(),
    NODE_ENV: 'test',
    PORT: 0,
    secretKeySource: 'env',
    AUTH_DISABLED: true,
    SCHEDULER_DISABLED: true,
    LOG_LEVEL: 'silent',
  } as Env;
  return coreTestContext<Env>(env);
}
