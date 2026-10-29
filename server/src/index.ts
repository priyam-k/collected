import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { serve } from '@hono/node-server';
import { createApi } from './api/index.js';
import { bootstrap } from './bootstrap.js';
import { createUpdateChecker } from '@collected/core/lib/updates';
import { startScheduler } from '@collected/core/scheduler';
import { mountStatic } from './static.js';

const ctx = await bootstrap();
const { env, log } = ctx;

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
const updates = createUpdateChecker(ctx);
app.route('/api', createApi(ctx, { updates }));
const servingSpa = mountStatic(app, env);

const scheduler = env.SCHEDULER_DISABLED ? null : startScheduler(ctx);
// The update check is its own timer, not an ingester: it has no source row and no items, and SCHEDULER_DISABLED (tests, the
// CLI) should silence it too. UPDATE_CHECK_DISABLED switches off the GitHub request even for an operator who runs the scheduler.
if (!env.SCHEDULER_DISABLED && !env.UPDATE_CHECK_DISABLED) updates.start();

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  log.info(
    { port: info.port, version: ctx.version, commit: ctx.build.commit, authDisabled: env.AUTH_DISABLED, spa: servingSpa, dataDir: env.DATA_DIR },
    `collected listening on http://localhost:${info.port}`,
  );
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    log.info({ sig }, 'shutting down');
    scheduler?.stop();
    updates.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
