import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { createUpdateChecker, systemVersion, type UpdateChecker } from '@collected/core/lib/updates';
import { createApi } from './api/index.js';
import { CodeStore } from './mcp/oauth.js';
import { mcpRoutes } from './mcp/routes.js';
import type { GoogleConnectResult } from './api/google.js';
import type { AppContext } from './context.js';
import { mountStatic } from './static.js';

export interface AppOptions {
  /** The update checker the system routes answer from; one is made (and never started) when the caller has none. */
  updates?: UpdateChecker;
  /** Absolute path of a built web app to serve under `/`; nothing is mounted when it is unset or has no index.html. */
  webDist?: string | undefined;
  /** Told how each Google connect callback ended; the CLI's `connect google` waits on it. */
  onGoogleConnect?: ((r: GoogleConnectResult) => void) | undefined;
}

/**
 * The whole HTTP app, without a socket: secure headers, `/api`, and the SPA when there is one. `index.ts` listens on
 * it; the CLI's local mode calls `app.request` on it in-process. Neither the scheduler nor the update timer starts
 * here, so building the app has no side effects beyond the context it was given.
 */
export function createApp(ctx: AppContext, opts: AppOptions = {}): { app: Hono; updates: UpdateChecker; servingSpa: boolean } {
  const app = new Hono();
  // Everything is same-origin except Canvas file previews, which `/api/canvas/files/:id/open` redirects to the
  // InstFS CDN; CSP checks the redirect target, hence `https:` for images and frames. No inline scripts: the theme
  // bootstrap is a module. Inline styles stay because React, Radix and sonner set them.
  app.use(
    '*',
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'https:', 'data:'],
        frameSrc: ["'self'", 'https:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        objectSrc: ["'none'"],
        workerSrc: ["'none'"],
      },
      referrerPolicy: 'no-referrer',
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: false,
    }),
  );
  const updates = opts.updates ?? createUpdateChecker(ctx);
  const oauthCodes = new CodeStore();
  app.route('/api', createApi(ctx, { updates, google: { onResult: opts.onGoogleConnect }, oauthCodes }));
  // The remote MCP endpoint and its OAuth front door (DECISIONS 065); the tools call back into this same app.
  app.route('/', mcpRoutes(ctx, { fetchApp: async (req) => app.request(req), version: systemVersion(ctx).version, codes: oauthCodes }));
  // The owner's own machine has no visitor to show a landing page to: `/` is the board (DECISIONS 054).
  if (ctx.env.LOCAL_OWNER) app.get('/', (c) => c.redirect('/dashboard', 302));
  const servingSpa = opts.webDist ? mountStatic(app, opts.webDist) : false;
  return { app, updates, servingSpa };
}
