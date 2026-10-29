import { bootstrap } from './bootstrap.js';
import { startServer } from './serve.js';

const ctx = await bootstrap();
const { env, log } = ctx;

const running = await startServer(ctx, { webDist: env.WEB_DIST, port: env.PORT });
log.info(
  { port: running.port, version: ctx.version, commit: ctx.build.commit, authDisabled: env.AUTH_DISABLED, spa: running.servingSpa, dataDir: env.DATA_DIR },
  `collected listening on http://localhost:${running.port}`,
);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    log.info({ sig }, 'shutting down');
    void running.stop().then(() => process.exit(0));
  });
}
