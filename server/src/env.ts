import path from 'node:path';
import { z } from 'zod';

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase())));

const envSchema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATA_DIR: z.string().default('./data'),
  SECRET_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'SECRET_KEY must be 32 bytes as hex (openssl rand -hex 32)'),
  AUTH_DISABLED: bool.default(false),
  CF_ACCESS_TEAM_DOMAIN: z.string().optional(),
  CF_ACCESS_AUD: z.string().optional(),
  LOCAL_HELPER_KEY: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  PUBLIC_URL: z.string().url().default('http://localhost:5173'),
  SCHEDULER_DISABLED: bool.default(false),
  SEED_CONFIG_PATH: z.string().optional(),
  WEB_DIST: z.string().optional(),
  MIGRATIONS_DIR: z.string().optional(),
  TZ: z.string().optional(),
  LOG_LEVEL: z.string().default('info'),
});

export type Env = z.infer<typeof envSchema> & { rootDir: string };

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
  if (!env.AUTH_DISABLED && (!env.CF_ACCESS_TEAM_DOMAIN || !env.CF_ACCESS_AUD)) {
    throw new Error('AUTH_DISABLED is false but CF_ACCESS_TEAM_DOMAIN / CF_ACCESS_AUD are not set');
  }
  // Relative DATA_DIR / WEB_DIST are anchored at the repo root, not the cwd, so `pnpm dev` and `node dist/index.js` agree.
  return {
    ...env,
    rootDir,
    DATA_DIR: path.resolve(rootDir, env.DATA_DIR),
    WEB_DIST: env.WEB_DIST ? path.resolve(rootDir, env.WEB_DIST) : undefined,
  };
}
