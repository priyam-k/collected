import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { SESSION_COOKIE } from '@collected/core/auth/session';
import type { Env } from '../env.js';

/** The session cookie on the wire; the session itself lives in core (auth/session.ts). */

export function readSessionCookie(c: Context): string | undefined {
  return getCookie(c, SESSION_COOKIE);
}

export function setSessionCookie(c: Context, env: Env, id: string, expiresAt: string): void {
  setCookie(c, SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: env.PUBLIC_URL.startsWith('https://'),
    path: '/',
    expires: new Date(expiresAt),
  });
}

export function clearSessionCookie(c: Context, env: Env): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: env.PUBLIC_URL.startsWith('https://') });
}
