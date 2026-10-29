import type { AppContext as CoreContext, BuildInfo } from '@collected/core';
import type { Env } from './env.js';

/** Core's context with the server's own Env in `env`: routes read AUTH_DISABLED, PORT and the rest from the same object. */
export type AppContext = CoreContext<Env>;
export type { BuildInfo };
