import { existsSync } from 'node:fs';
import path from 'node:path';

/*
 * Files the CLI needs at runtime but does not import: the Drizzle migrations, the example seed, the demo fixtures and
 * the built web app. The npm package carries each next to the bundle (`dist/<name>`, put there by tsup.config.ts); a
 * checkout running `tsx src/cli.ts` has none of those copies and reads the repo's own files instead. Nothing walks up
 * from node_modules looking for a repo: the packaged copy is tried first, by an exact path, and the fallback is one
 * fixed place relative to this file.
 */

/** `dirname/<name>` when `marker` exists under it (the package), else `<repo root>/<devPath>` (a checkout). */
export function pickShipped(dirname: string, name: string, marker: string, devPath: string, exists: (p: string) => boolean = existsSync): string {
  const packaged = path.join(dirname, name);
  if (exists(path.join(packaged, marker))) return packaged;
  return path.resolve(dirname, '..', '..', devPath);
}

const here = import.meta.dirname;

/** The Vite build: `dist/web` in the package, `web/dist` in a checkout. */
export const shippedWebDist = (): string => pickShipped(here, 'web', 'index.html', path.join('web', 'dist'));
/** The migrations core applies on open: `dist/drizzle` in the package, `core/drizzle` in a checkout. */
export const shippedMigrations = (): string => pickShipped(here, 'drizzle', path.join('meta', '_journal.json'), path.join('core', 'drizzle'));
/** The seed an empty database starts from (no courses; the jobs feed and the to-do defaults): `dist/seed-config.json` or `artifacts/seed-config.json`. */
export const shippedSeedConfig = (): string => pickShipped(here, 'seed-config.json', '', path.join('artifacts', 'seed-config.json'));
