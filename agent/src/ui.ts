import { existsSync } from 'node:fs';
import path from 'node:path';
import { createContext, createLogger } from '@collected/core';
import { startServer, type RunningServer } from '@collected/server/serve';
import { localDataDir, type AgentConfig } from './config.js';
import { localEnv } from './local.js';
import { openBrowser } from './open.js';
import { shippedWebDist } from './paths.js';

/*
 * `collected ui`: the dashboard over the local database, on this machine only. The same app the CLI's other commands
 * call in-process is put on a loopback socket, with the scheduler running so the data stays fresh while the tab is
 * open. No sign-in: the listener is 127.0.0.1, so whoever can open the page can already read the database file.
 */

export const DEFAULT_UI_PORT = 4848;
export const LOOPBACK = '127.0.0.1';

/**
 * The built web app to serve: the copy the npm package carries next to the bundle (`dist/web`), or in a checkout the
 * repo's `web/dist`. Only the checkout can lack it; the package build refuses to produce a bundle without it.
 */
export function resolveWebDist(): string {
  const dist = shippedWebDist();
  if (!existsSync(path.join(dist, 'index.html'))) throw new Error(`no web build at ${dist}: run pnpm --filter web build first`);
  return dist;
}

export { openBrowser };

export interface UiOptions {
  port: number;
  open: boolean;
  logLevel?: string | undefined;
  verbose?: boolean | undefined;
  say?: (s: string) => void;
}

/** Starts the dashboard and resolves once it listens; the returned handle stops everything and closes the database. */
export async function startUi(cfg: AgentConfig, opts: UiOptions): Promise<RunningServer> {
  const webDist = resolveWebDist();
  const dataDir = localDataDir(cfg);
  // The browser's Origin on a write must match PUBLIC_URL (the same-site check), so the address is fixed to the loopback literal.
  const env = localEnv(dataDir, { logLevel: opts.logLevel, verbose: opts.verbose, publicUrl: `http://${LOOPBACK}:${opts.port}`, scheduler: true });
  const log = createLogger(env.LOG_LEVEL, false, { stderr: true });
  const ctx = await createContext(env, { log });
  const running = await startServer(ctx, { webDist, port: opts.port, hostname: LOOPBACK }).catch((err: NodeJS.ErrnoException) => {
    throw err.code === 'EADDRINUSE' ? new Error(`port ${opts.port} is taken (another collected ui?); pass --port <n>`) : err;
  });
  (opts.say ?? console.log)(`collected is at ${running.url}\ndata ${dataDir} · syncing in the background · Ctrl-C to stop`);
  if (opts.open) openBrowser(running.url);
  return running;
}

/** `startUi` plus the signals: Ctrl-C stops the scheduler, closes the socket and the database, then exits. */
export async function runUi(cfg: AgentConfig, opts: UiOptions): Promise<void> {
  const running = await startUi(cfg, opts);
  let stopping = false;
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      if (stopping) return;
      stopping = true;
      void running.stop().then(() => process.exit(0));
    });
  }
  await new Promise(() => {});
}
