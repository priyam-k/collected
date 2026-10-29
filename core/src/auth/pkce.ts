import { createHash, randomBytes } from 'node:crypto';

/*
 * PKCE (RFC 7636), S256. The connect flows send a code_challenge with the authorization request and the matching
 * code_verifier with the token exchange, so an authorization code that leaks (a logged redirect, another process on
 * the loopback) is useless without the verifier that stayed in this process. Google requires nothing of a web client
 * here and recommends it for an installed one; the CLI's local mode is the latter, and the web client is not harmed.
 */

export interface Pkce {
  /** 43–128 chars of [A-Za-z0-9-._~]; 32 random bytes as base64url is 43. Stays server-side, with the pending state. */
  verifier: string;
  /** base64url(sha256(verifier)), what the authorization URL carries. */
  challenge: string;
}

export const pkceChallenge = (verifier: string): string => createHash('sha256').update(verifier).digest('base64url');

export function createPkce(): Pkce {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: pkceChallenge(verifier) };
}
