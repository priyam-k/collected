import { cpSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'tsup';

const core = path.resolve(import.meta.dirname, '..', 'core');

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
  // The workspace packages are bundled in; their runtime packages are this package's dependencies and stay external.
  noExternal: ['@collected/shared', '@collected/core', '@collected/server'],
  // The bundle carries what core finds next to itself at runtime (both walk up from import.meta.dirname): the Drizzle
  // migrations (core/src/db/migrate.ts) and the demo fixtures (core/src/ingest/*/fixture-client.ts).
  onSuccess: async () => {
    const dist = path.resolve(import.meta.dirname, 'dist');
    cpSync(path.join(core, 'drizzle'), path.join(dist, 'drizzle'), { recursive: true });
    mkdirSync(path.join(dist, 'fixtures'), { recursive: true });
    for (const source of ['canvas', 'gradescope']) cpSync(path.join(core, 'src', 'ingest', source, 'fixtures'), path.join(dist, 'fixtures'), { recursive: true });
  },
});
