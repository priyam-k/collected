/**
 * Everything core needs to know about the world it runs in. The server builds one from process.env (server/src/env.ts),
 * a bundled CLI would build one from its own flags; core itself never reads process.env, never knows a repo root, and
 * every path here is absolute, resolved by the caller. Field names mirror the env vars they usually come from so the
 * reads (`ctx.env.PUBLIC_URL`) look the same on both sides of the seam.
 */
export interface CoreConfig {
  /** Absolute. The SQLite file, its WAL and the pre-migration snapshots live here. */
  DATA_DIR: string;
  /** 32 bytes as hex; wraps every stored credential (lib/crypto.ts). */
  SECRET_KEY: string;
  /** IANA zone for the seeded `timezone` setting. */
  TZ?: string | undefined;
  /** Where the browser reaches this instance; OAuth redirect URIs are built from it. */
  PUBLIC_URL: string;
  GOOGLE_CLIENT_ID?: string | undefined;
  GOOGLE_CLIENT_SECRET?: string | undefined;
  TODOIST_CLIENT_ID?: string | undefined;
  TODOIST_CLIENT_SECRET?: string | undefined;
  /** Who may sign in, lowercased. Unset: the first person to sign in claims the instance. */
  ALLOWED_EMAILS?: string[] | undefined;
  /** "owner/name" on GitHub that the update check compares the running commit against. */
  UPSTREAM_REPO: string;
  UPDATE_CHECK_DISABLED: boolean;
  UPDATE_CHECK_TOKEN?: string | undefined;
  /** The commit the image was built from, when the build said so; see lib/version.ts for the fallbacks. */
  COLLECTED_COMMIT?: string | undefined;
  /** Absolute path of the Drizzle migrations folder. Unset: core's own `drizzle/` (db/migrate.ts finds it). */
  MIGRATIONS_DIR?: string | undefined;
  /** Absolute path of the seed-config.json to load into an empty database. Unset or missing on disk: start empty. */
  SEED_CONFIG_PATH?: string | undefined;
  /** What `ctx.version` reports (the root package.json's version for the server). */
  packageVersion: string;
  /** Absolute path of the build-info.json an image build wrote, when there is one. */
  buildInfoFile?: string | undefined;
  /** Absolute path of a git checkout to ask for HEAD when nothing else names the commit (development). */
  gitDir?: string | undefined;
}
