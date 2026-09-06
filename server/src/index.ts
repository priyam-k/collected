import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createApi } from './api/index.js';
import { bootstrap } from './bootstrap.js';
import { startScheduler } from './scheduler.js';
import { mountStatic } from './static.js';

const ctx = await bootstrap();
const { env, log } = ctx;

const app = new Hono();
app.route('/api', createApi(ctx));
const servingSpa = mountStatic(app, env);

const scheduler = env.SCHEDULER_DISABLED ? null : startScheduler(ctx);

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  log.info(
    { port: info.port, authDisabled: env.AUTH_DISABLED, spa: servingSpa, dataDir: env.DATA_DIR },
    `collected listening on http://localhost:${info.port}`,
  );
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    log.info({ sig }, 'shutting down');
    scheduler?.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
