import { copyFileSync, cpSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'tsup';

const root = path.resolve(import.meta.dirname, '..');
const core = path.join(root, 'core');
const webDist = path.join(root, 'web', 'dist');

export default defineConfig({
  entry: { cli: 'src/cli.ts' },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  sourcemap: true,
  clean: true,
  // Local mode (src/local.ts) is a dynamic import, so it becomes its own chunk: the client mode never loads the
  // database, Hono or the ingesters.
  splitting: true,
  banner: { js: '#!/usr/bin/env node' },
  // The built-in Google desktop client (src/google-client.ts) is baked in at build time and never committed:
  // release.yml provides both from repository secrets; a local build gets empty strings and Google connect is off.
  env: {
    COLLECTED_GOOGLE_DESKTOP_CLIENT_ID: process.env.COLLECTED_GOOGLE_DESKTOP_CLIENT_ID ?? '',
    COLLECTED_GOOGLE_DESKTOP_CLIENT_SECRET: process.env.COLLECTED_GOOGLE_DESKTOP_CLIENT_SECRET ?? '',
  },
  // The workspace packages are bundled in; their runtime packages are this package's dependencies and stay external.
  noExternal: ['@collected/shared', '@collected/core', '@collected/server'],
  // Everything local mode reads from disk travels next to the bundle (src/paths.ts resolves each by exact path):
  // the Drizzle migrations, the demo fixtures (core's fixture clients read `fixtures/` next to their own chunk), the
  // example seed, and the built web app for `collected ui`. The web build is a precondition, not something this
  // build can produce: a package without it would have a dashboard command that cannot serve a dashboard.
  onSuccess: async () => {
    if (!existsSync(path.join(webDist, 'index.html'))) {
      throw new Error(`collected-cli: no web build at ${webDist}; run \`pnpm --filter web build\` first (the package ships the dashboard as dist/web)`);
    }
    const dist = path.resolve(import.meta.dirname, 'dist');
    cpSync(path.join(core, 'drizzle'), path.join(dist, 'drizzle'), { recursive: true });
    mkdirSync(path.join(dist, 'fixtures'), { recursive: true });
    for (const source of ['canvas', 'gradescope']) cpSync(path.join(core, 'src', 'ingest', source, 'fixtures'), path.join(dist, 'fixtures'), { recursive: true });
    copyFileSync(path.join(root, 'artifacts', 'seed-config.json'), path.join(dist, 'seed-config.json'));
    cpSync(webDist, path.join(dist, 'web'), { recursive: true });
  },
});
