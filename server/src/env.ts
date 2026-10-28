import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase())));

const envSchema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATA_DIR: z.string().default('./data'),
  /** 32 bytes as hex. Leave empty to use (or create) DATA_DIR/.secret_key, which travels with the database it encrypts. */
  SECRET_KEY: z
    .string()
    .optional()
    .transform((v) => v?.trim() || undefined)
    .pipe(z.string().regex(/^[0-9a-fA-F]{64}$/, 'SECRET_KEY must be 32 bytes as hex (openssl rand -hex 32), or empty to auto-manage').optional()),
  AUTH_DISABLED: bool.default(false),
  /** Required alongside AUTH_DISABLED when NODE_ENV=production: the only legitimate case is a box nobody but you can reach. */
  AUTH_DISABLED_ACKNOWLEDGED: bool.default(false),
  CF_ACCESS_TEAM_DOMAIN: z.string().optional(),
  CF_ACCESS_AUD: z.string().optional(),
  /** Who may sign in with Google, comma-separated. Unset: the first person to sign in claims the instance. */
  ALLOWED_EMAILS: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) : undefined)),
  LOCAL_HELPER_KEY: z
    .string()
    .optional()
    .transform((v) => v?.trim() || undefined)
    .pipe(z.string().min(32, 'LOCAL_HELPER_KEY must be at least 32 characters (openssl rand -hex 32)').optional()),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  PUBLIC_URL: z.string().url().default('http://localhost:5173'),
  SCHEDULER_DISABLED: bool.default(false),
  SEED_CONFIG_PATH: z.string().optional(),
  WEB_DIST: z.string().optional(),
  MIGRATIONS_DIR: z.string().optional(),
  TZ: z.string().optional(),
  LOG_LEVEL: z.string().default('info'),
  /** Git short sha baked into the image (Dockerfile ARG GIT_SHA). Empty means: look at server/build-info.json, then git, then "dev". */
  COLLECTED_COMMIT: z
    .string()
    .optional()
    .transform((v) => v?.trim() || undefined),
  /** "owner/name" on GitHub that the update check compares the running commit against. */
  UPSTREAM_REPO: z
    .string()
    .optional()
    .transform((v) => v?.trim() || 'priyam-k/collected')
    .pipe(z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 'UPSTREAM_REPO must be "owner/name"')),
  /** Switches the GitHub update check off entirely: no outbound request, no banner. */
  UPDATE_CHECK_DISABLED: bool.default(false),
});

export type Env = Omit<z.infer<typeof envSchema>, 'SECRET_KEY'> & { rootDir: string; SECRET_KEY: string; secretKeySource: 'env' | 'file' };

/** Loads ../.env (repo root) when present, then validates process.env. */
export function loadEnv(): Env {
  const rootDir = path.resolve(import.meta.dirname, '..', '..');
  for (const candidate of [path.join(rootDir, '.env'), path.join(process.cwd(), '.env')]) {
    try {
      process.loadEnvFile(candidate);
      break;
    } catch {
      // no file there; fine
    }
  }
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ');
    throw new Error(`Invalid environment:\n  ${issues}`);
  }
  const env = parsed.data;
  if (env.AUTH_DISABLED && env.NODE_ENV === 'production' && !env.AUTH_DISABLED_ACKNOWLEDGED) {
    throw new Error('AUTH_DISABLED=true in production makes every credential in the database readable by anyone who reaches the port. Set AUTH_DISABLED_ACKNOWLEDGED=true only if nothing but you can reach it.');
  }
  const hasAccess = !!(env.CF_ACCESS_TEAM_DOMAIN && env.CF_ACCESS_AUD);
  const hasGoogle = !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
  if (!env.AUTH_DISABLED && !hasAccess && !hasGoogle) {
    throw new Error(
      'AUTH_DISABLED=false needs a way to sign in: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (Google sign-in), or CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD (Cloudflare Access in front). For local development set AUTH_DISABLED=true in .env.',
    );
  }
  if ((env.CF_ACCESS_TEAM_DOMAIN ? 1 : 0) + (env.CF_ACCESS_AUD ? 1 : 0) === 1) throw new Error('CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD go together');
  // Relative DATA_DIR / WEB_DIST are anchored at the repo root, not the cwd, so `pnpm dev` and `node dist/index.js` agree.
  const dataDir = path.resolve(rootDir, env.DATA_DIR);
  const { SECRET_KEY: fromEnv, ...rest } = env;
  const key = fromEnv ? { value: fromEnv, source: 'env' as const } : { value: loadOrCreateKeyFile(dataDir), source: 'file' as const };
  return {
    ...rest,
    rootDir,
    DATA_DIR: dataDir,
    WEB_DIST: env.WEB_DIST ? path.resolve(rootDir, env.WEB_DIST) : undefined,
    SECRET_KEY: key.value,
    secretKeySource: key.source,
  };
}

/**
 * Keeps the encryption key in DATA_DIR/.secret_key when SECRET_KEY isn't set. Losing the key means every
 * stored credential must be re-entered, so it lives beside the database (and inside the Docker volume).
 */
function loadOrCreateKeyFile(dataDir: string): string {
  const file = path.join(dataDir, '.secret_key');
  try {
    const existing = readFileSync(file, 'utf8').trim();
    if (/^[0-9a-fA-F]{64}$/.test(existing)) return existing;
  } catch {
    // create below
  }
  mkdirSync(dataDir, { recursive: true });
  const key = randomBytes(32).toString('hex');
  writeFileSync(file, `${key}\n`, { mode: 0o600 });
  return key;
}
