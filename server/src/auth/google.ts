import { auth as googleAuth } from '@googleapis/calendar';
import type { Env } from '../env.js';
import { NotConfiguredError } from '../ingest/types.js';

/** Identity only. Calendar access is a separate consent with its own callback (`/api/google/callback`). */
export const SIGN_IN_SCOPES = ['openid', 'email', 'profile'];

export const signInRedirectUri = (env: Env): string => `${env.PUBLIC_URL.replace(/\/$/, '')}/api/auth/google/callback`;

export const googleSignInConfigured = (env: Env): boolean => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

function client(env: Env) {
  if (!googleSignInConfigured(env)) throw new NotConfiguredError('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set');
  return new googleAuth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, signInRedirectUri(env));
}

export function signInUrl(env: Env, state: string): string {
  return client(env).generateAuthUrl({ scope: SIGN_IN_SCOPES, state, prompt: 'select_account' });
}

export interface GoogleProfile {
  email: string;
  name: string | null;
  picture: string | null;
}

/** Exchanges the code and verifies the ID token against our client id; only a verified email counts. */
export async function exchangeSignIn(env: Env, code: string): Promise<GoogleProfile> {
  const c = client(env);
  const { tokens } = await c.getToken(code);
  if (!tokens.id_token) throw new Error('Google returned no ID token');
  const ticket = await c.verifyIdToken({ idToken: tokens.id_token, audience: env.GOOGLE_CLIENT_ID });
  const p = ticket.getPayload();
  if (!p?.email || p.email_verified === false) throw new Error('Google account has no verified email');
  return { email: p.email, name: p.name ?? null, picture: p.picture ?? null };
}
