import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Env } from '../env.js';

export type AuthVariables = { user: string | null };

/**
 * Verifies the JWT Cloudflare Access attaches to every request that passed the login wall.
 * With AUTH_DISABLED (local dev) every request is allowed and `user` is "dev".
 */
export function accessAuth(env: Env): MiddlewareHandler<{ Variables: AuthVariables }> {
  if (env.AUTH_DISABLED) {
    return async (c, next) => {
      c.set('user', 'dev');
      await next();
    };
  }
  const team = env.CF_ACCESS_TEAM_DOMAIN!;
  const issuer = `https://${team}`;
  const jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
  const audience = env.CF_ACCESS_AUD!;
  return async (c, next) => {
    const token = c.req.header('cf-access-jwt-assertion') ?? getCookie(c, 'CF_Authorization');
    if (!token) return c.json({ error: 'unauthorized' }, 401);
    try {
      const { payload } = await jwtVerify(token, jwks, { issuer, audience });
      c.set('user', typeof payload.email === 'string' ? payload.email : (payload.sub ?? null));
      await next();
    } catch {
      return c.json({ error: 'unauthorized' }, 401);
    }
  };
}

/** Shared-secret check for scripts (the Canvas cookie helper). Accepts if the header matches LOCAL_HELPER_KEY. */
export function helperKeyMatches(env: Env, headerValue: string | undefined): boolean {
  if (!env.LOCAL_HELPER_KEY || !headerValue) return false;
  if (headerValue.length !== env.LOCAL_HELPER_KEY.length) return false;
  let diff = 0;
  for (let i = 0; i < headerValue.length; i++) diff |= headerValue.charCodeAt(i) ^ env.LOCAL_HELPER_KEY.charCodeAt(i);
  return diff === 0;
}
