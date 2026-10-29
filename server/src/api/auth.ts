import { randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import type { ApiToken, Me } from '@collected/shared';
import { type AuthVariables } from '../auth/cloudflare-access.js';
import { exchangeSignIn, googleSignInConfigured, signInUrl } from '../auth/google.js';
import {
  clearSessionCookie,
  createSession,
  createToken,
  deleteSession,
  emailAllowed,
  isPerson,
  listTokens,
  readSessionCookie,
  revokeToken,
  setSessionCookie,
  upsertUser,
  userByEmail,
} from '../auth/session.js';
import type { AppContext } from '../context.js';
import { NotConfiguredError } from '@collected/core/ingest/types';
import { bad, parseBody } from './util.js';

/** OAuth state for sign-in: nobody is signed in yet, so it carries only the return path and an expiry. */
const pending = new Map<string, { next: string; exp: number }>();
const STATE_TTL_MS = 10 * 60_000;

/** Only a path on this site may be the post-sign-in destination; without one, the board (web/src/lib/routes.ts). */
const safeNext = (v: string | undefined): string => (v && /^\/(?!\/)/.test(v) && v.length < 500 ? v : '/dashboard');

const toToken = (r: { id: string; name: string; prefix: string; createdAt: string; lastUsedAt: string | null }): ApiToken => ({
  id: r.id,
  name: r.name,
  prefix: r.prefix,
  createdAt: r.createdAt,
  lastUsedAt: r.lastUsedAt,
});

/**
 * Sign-in with Google, sessions, and the CLI's API tokens. `/me`, `/google/start` and `/google/callback` are open;
 * everything else needs an identity, and the token routes need a person (never a token managing tokens).
 */
export function authRoutes(ctx: AppContext) {
  const r = new Hono<{ Variables: AuthVariables }>();
  const signInPage = (q: string) => `${ctx.env.PUBLIC_URL.replace(/\/$/, '')}/signin?${q}`;

  r.get('/me', async (c) => {
    const identity = c.get('user') ?? null;
    const email = isPerson(identity) && identity !== 'dev' ? identity! : null;
    const row = email ? await userByEmail(ctx, email) : null;
    const body: Me = {
      identity,
      user: identity === 'dev' ? { email: 'dev@localhost', name: 'Local development', picture: null } : row ? { email: row.email, name: row.name, picture: row.picture } : email ? { email, name: null, picture: null } : null,
      authDisabled: ctx.env.AUTH_DISABLED,
      signIn: { google: googleSignInConfigured(ctx.env), access: !!(ctx.env.CF_ACCESS_TEAM_DOMAIN && ctx.env.CF_ACCESS_AUD) },
    };
    c.header('Cache-Control', 'no-store');
    return c.json(body);
  });

  r.get('/google/start', (c) => {
    try {
      const now = Date.now();
      for (const [k, v] of pending) if (v.exp < now) pending.delete(k);
      const state = randomBytes(16).toString('hex');
      pending.set(state, { next: safeNext(c.req.query('next')), exp: now + STATE_TTL_MS });
      return c.redirect(signInUrl(ctx.env, state));
    } catch (err) {
      if (err instanceof NotConfiguredError) return c.redirect(signInPage('error=config'));
      throw err;
    }
  });

  r.get('/google/callback', async (c) => {
    const { code, state, error } = c.req.query();
    if (error) return c.redirect(signInPage(error === 'access_denied' ? 'error=denied' : 'error=unknown'));
    const p = state ? pending.get(state) : undefined;
    pending.delete(state ?? '');
    if (!code || !p || p.exp < Date.now()) return c.redirect(signInPage('error=expired'));
    try {
      const profile = await exchangeSignIn(ctx.env, code);
      if (!(await emailAllowed(ctx, profile.email))) {
        ctx.log.warn({ email: profile.email }, 'sign-in refused: not an allowed email');
        return c.redirect(signInPage('error=not_allowed'));
      }
      const user = await upsertUser(ctx, profile);
      const s = await createSession(ctx, user.id, c.req.header('user-agent'));
      setSessionCookie(c, ctx.env, s.id, s.expiresAt);
      ctx.log.info({ user: user.email }, 'signed in');
      return c.redirect(`${ctx.env.PUBLIC_URL.replace(/\/$/, '')}${p.next}`);
    } catch (err) {
      ctx.log.error({ err }, 'google sign-in failed');
      return c.redirect(signInPage(err instanceof NotConfiguredError ? 'error=config' : 'error=exchange'));
    }
  });

  r.post('/logout', async (c) => {
    const sid = readSessionCookie(c);
    if (sid) await deleteSession(ctx, sid);
    clearSessionCookie(c, ctx.env);
    return c.json({ ok: true });
  });

  /** The signed-in person's user row; the dev identity gets a synthetic one so the CLI can be exercised locally. */
  async function personRow(c: { get(k: 'user'): string | null }) {
    const identity = c.get('user');
    if (!isPerson(identity)) bad('sign in as a person to manage tokens', 403);
    return identity === 'dev' ? upsertUser(ctx, { email: 'dev@localhost', name: 'Local development' }) : (await userByEmail(ctx, identity!)) ?? upsertUser(ctx, { email: identity! });
  }

  r.get('/tokens', async (c) => {
    const user = await personRow(c);
    return c.json((await listTokens(ctx, user.id)).map(toToken));
  });

  r.post('/tokens', async (c) => {
    const user = await personRow(c);
    const { name } = await parseBody(c, z.object({ name: z.string().trim().min(1).max(80) }));
    const { token, row } = await createToken(ctx, user.id, name);
    ctx.log.info({ user: user.email, token: row.prefix }, 'api token created');
    c.header('Cache-Control', 'no-store');
    return c.json({ ...toToken(row), token }, 201);
  });

  r.delete('/tokens/:id', async (c) => {
    const user = await personRow(c);
    if (!(await revokeToken(ctx, user.id, c.req.param('id')))) bad('no such token', 404);
    return c.json({ ok: true });
  });

  /** Every session but the current one, for "sign out everywhere". */
  r.post('/logout-all', async (c) => {
    const user = await personRow(c);
    const { sessions } = await import('@collected/core/db/schema');
    const { eq } = await import('drizzle-orm');
    await ctx.db.delete(sessions).where(eq(sessions.userId, user.id));
    clearSessionCookie(c, ctx.env);
    return c.json({ ok: true });
  });

  return r;
}
