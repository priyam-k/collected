import { serve, type ServerType } from '@hono/node-server';
import { startScheduler, type Scheduler } from '@collected/core/scheduler';
import { closeDb } from '@collected/core/db/client';
import type { UpdateChecker } from '@collected/core/lib/updates';
import { createApp, type AppOptions } from './app.js';
import type { AppContext } from './context.js';

export interface ServeOptions {
  /** Absolute path of a built web app to serve under `/`. */
  webDist?: string | undefined;
  port: number;
  /** Interface to bind; unset binds every interface (the image behind its proxy). The CLI's `ui` passes 127.0.0.1. */
  hostname?: string | undefined;
  onGoogleConnect?: AppOptions['onGoogleConnect'];
}

export interface RunningServer {
  updates: UpdateChecker;
  scheduler: Scheduler | null;
  server: ServerType;
  servingSpa: boolean;
  /** The URL the listener answers on, from the port it actually got. */
  url: string;
  port: number;
  /** Stops the scheduler and the update timer, closes the listener, then the database. Resolves once the socket is closed. */
  stop(): Promise<void>;
}

/**
 * The start-up sequence the image runs and the CLI's `ui` reuses: the app, the scheduler and the update timer under
 * the env's switches, then the listener. Signals are the caller's: `index.ts` exits the process, the CLI goes back
 * to its prompt.
 */
export function startServer(ctx: AppContext, opts: ServeOptions): Promise<RunningServer> {
  const { env } = ctx;
  const { app, updates, servingSpa } = createApp(ctx, { webDist: opts.webDist, onGoogleConnect: opts.onGoogleConnect });
  const scheduler = env.SCHEDULER_DISABLED ? null : startScheduler(ctx);
  // The update check is its own timer, not an ingester: it has no source row and no items, and SCHEDULER_DISABLED (tests, the
  // CLI) should silence it too. UPDATE_CHECK_DISABLED switches off the GitHub request even for an operator who runs the scheduler.
  if (!env.SCHEDULER_DISABLED && !env.UPDATE_CHECK_DISABLED) updates.start();
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, port: opts.port, hostname: opts.hostname }, (info) => {
      const host = opts.hostname ?? 'localhost';
      const url = `http://${host}:${info.port}`;
      resolve({
        updates,
        scheduler,
        server,
        servingSpa,
        url,
        port: info.port,
        stop: () =>
          new Promise<void>((done) => {
            scheduler?.stop();
            updates.stop();
            let settled = false;
            const finish = () => {
              if (settled) return;
              settled = true;
              closeDb(ctx.db);
              done();
            };
            server.close(finish);
            // Keep-alive connections from an open browser tab can hold the listener; the data is safe once the scheduler stopped.
            setTimeout(finish, 2000).unref();
          }),
      });
    });
    server.once('error', (err) => {
      scheduler?.stop();
      updates.stop();
      reject(err);
    });
  });
}
