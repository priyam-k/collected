import { createHash, timingSafeEqual } from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Env } from '../env.js';

export type AuthVariables = { user: string | null };

/**
 * Verifies the JWT Cloudflare Access attaches to every request that passed the login wall.
 * With AUTH_DISABLED (local dev) every request is allowed and `user` is "dev".
 */
let jwksCache: ReturnType<typeof createRemoteJWKSet> | null = null;

/**
 * Resolves the authenticated identity for a request, or null. "dev" when AUTH_DISABLED; "helper" for the shared
 * LOCAL_HELPER_KEY (scripts in local use); an email for a person who passed the Access login; "service:<name>" for an
 * Access service token (the agent), whose JWT carries `common_name` and an empty `sub` (DECISIONS 038).
 */
export async function verifyAccess(env: Env, c: Context): Promise<string | null> {
  if (env.AUTH_DISABLED) return 'dev';
  if (helperKeyMatches(env, c.req.header('x-collected-key'))) return 'helper';
  const team = env.CF_ACCESS_TEAM_DOMAIN!;
  const issuer = `https://${team}`;
  jwksCache ??= createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
  const token = c.req.header('cf-access-jwt-assertion') ?? getCookie(c, 'CF_Authorization');
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, jwksCache, { issuer, audience: env.CF_ACCESS_AUD! });
    if (typeof payload.email === 'string' && payload.email) return payload.email;
    const cn = (payload as { common_name?: unknown }).common_name;
    if (typeof cn === 'string' && cn) return `service:${cn}`;
    return typeof payload.sub === 'string' && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}

export function accessAuth(env: Env): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (c, next) => {
    const user = await verifyAccess(env, c);
    if (!user) return c.json({ error: 'unauthorized' }, 401);
    c.set('user', user);
    await next();
  };
}

/** Shared-secret check for scripts (the Canvas cookie helper). Accepts if the header matches LOCAL_HELPER_KEY. */
export function helperKeyMatches(env: Env, headerValue: string | undefined): boolean {
  if (!env.LOCAL_HELPER_KEY || !headerValue) return false;
  // Compare digests: constant time, and the key's length is not observable either.
  const digest = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(digest(headerValue), digest(env.LOCAL_HELPER_KEY));
}
