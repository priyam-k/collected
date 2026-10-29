import { createHash, timingSafeEqual } from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { AppContext } from '../context.js';
import type { Env } from '../env.js';
import { sessionUser, tokenUser } from '@collected/core/auth/session';
import { readSessionCookie } from './cookies.js';

export type AuthVariables = { user: string | null };

let jwksCache: ReturnType<typeof createRemoteJWKSet> | null = null;

/**
 * Resolves the identity behind a request, or null. In order:
 *  - "local" when LOCAL_OWNER: the app runs inside the CLI on the owner's machine and there is no request from anyone
 *    else to tell apart (env.ts: nothing in the environment can set it);
 *  - "dev" when AUTH_DISABLED (local development);
 *  - "helper" for the shared LOCAL_HELPER_KEY (one script, one route; see identityAllows);
 *  - "token:<name>" for a bearer API token the CLI got from `collected login`;
 *  - an email for a person with a session cookie from the Google sign-in;
 *  - an email, or "service:<name>" for an Access service token, from the JWT Cloudflare Access attaches when it is
 *    configured in front (DECISIONS 038). Access is optional: a self-host without it uses the sign-in alone.
 */
export async function verifyAccess(ctx: AppContext, c: Context): Promise<string | null> {
  const env = ctx.env;
  if (env.LOCAL_OWNER) return 'local';
  if (env.AUTH_DISABLED) return 'dev';
  if (helperKeyMatches(env, c.req.header('x-collected-key'))) return 'helper';
  const authz = c.req.header('authorization');
  if (authz?.toLowerCase().startsWith('bearer ')) {
    const t = await tokenUser(ctx, authz.slice(7).trim());
    return t ? `token:${t.token.name}` : null;
  }
  const sid = readSessionCookie(c);
  if (sid) {
    const u = await sessionUser(ctx, sid);
    if (u) return u.email;
  }
  if (env.CF_ACCESS_TEAM_DOMAIN && env.CF_ACCESS_AUD) return verifyAccessJwt(env, c);
  return null;
}

async function verifyAccessJwt(env: Env, c: Context): Promise<string | null> {
  const issuer = `https://${env.CF_ACCESS_TEAM_DOMAIN}`;
  jwksCache ??= createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
  const token = c.req.header('cf-access-jwt-assertion') ?? getCookie(c, 'CF_Authorization');
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, jwksCache, { issuer, audience: env.CF_ACCESS_AUD! });
    if (typeof payload.email === 'string' && payload.email) return payload.email.toLowerCase();
    const cn = (payload as { common_name?: unknown }).common_name;
    if (typeof cn === 'string' && cn) return `service:${cn}`;
    return typeof payload.sub === 'string' && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}

export function accessAuth(ctx: AppContext): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (c, next) => {
    const user = await verifyAccess(ctx, c);
    if (!user) return c.json({ error: 'unauthorized' }, 401);
    c.set('user', user);
    await next();
  };
}

/** Shared-secret check for the Canvas cookie helper. Accepts if the header matches LOCAL_HELPER_KEY. */
export function helperKeyMatches(env: Env, headerValue: string | undefined): boolean {
  if (!env.LOCAL_HELPER_KEY || !headerValue) return false;
  // Compare digests: constant time, and the key's length is not observable either.
  const digest = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(digest(headerValue), digest(env.LOCAL_HELPER_KEY));
}
