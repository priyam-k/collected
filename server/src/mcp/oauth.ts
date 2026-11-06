import { randomBytes, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { TOKEN_AREAS, type TokenScopes } from '@collected/shared';
import { pkceChallenge } from '@collected/core/auth/pkce';
import { oauthClients, type OAuthClientRow } from '@collected/core/db/schema';
import type { AppContext } from '../context.js';

/*
 * The OAuth pieces behind `POST /mcp` (DECISIONS 065). collected is both the resource and the authorization server:
 * a client finds this out from `/.well-known/oauth-protected-resource`, registers itself (RFC 7591, public clients
 * only, no secret), sends the person to `/oauth/authorize` with PKCE (S256 required), the person signs in and picks
 * scopes on the consent page, and the code is traded at `/oauth/token` for one of the ordinary API tokens, scoped as
 * chosen. There are no refresh tokens and no expiry: the access token is the API token, listed and revocable in
 * Settings → Account like a CLI's. Codes live in memory for ten minutes and are single-use; a restart only loses a
 * sign-in that was mid-flight.
 */

/** PUBLIC_URL without a trailing slash: the issuer, and the base of every URL in the metadata. */
export const publicBase = (env: { PUBLIC_URL: string }): string => env.PUBLIC_URL.replace(/\/$/, '');

/** The `scope` vocabulary in metadata and token answers: `<area>:r`, `<area>:rw`, or `all`. */
export const SCOPES_SUPPORTED = [...TOKEN_AREAS.flatMap((a) => [`${a}:r`, `${a}:rw`]), 'all'];

export function resourceMetadata(base: string) {
  return {
    resource: `${base}/mcp`,
    authorization_servers: [base],
    scopes_supported: SCOPES_SUPPORTED,
    bearer_methods_supported: ['header'],
    resource_name: 'collected',
  };
}

export function serverMetadata(base: string) {
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: SCOPES_SUPPORTED,
    service_documentation: `${base}/docs`,
  };
}

/**
 * A redirect URI a client may register: absolute; `https`, `http` to a loopback host only, or a private scheme
 * (`claude://…`) for native apps. Never `javascript:`, `data:`, `file:` or a bare scheme.
 */
export function validRedirectUri(raw: string): boolean {
  if (typeof raw !== 'string' || raw.length > 2048) return false;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.username || u.password || u.hash) return false;
  const scheme = u.protocol.slice(0, -1).toLowerCase();
  if (scheme === 'https') return !!u.hostname;
  if (scheme === 'http') return ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (['javascript', 'data', 'file', 'blob', 'vbscript', 'about'].includes(scheme)) return false;
  return /^[a-z][a-z0-9+.-]{1,63}$/.test(scheme) && raw.length > scheme.length + 3;
}

export interface RegisterBody {
  client_name?: unknown;
  redirect_uris?: unknown;
  token_endpoint_auth_method?: unknown;
  grant_types?: unknown;
  response_types?: unknown;
}

/** RFC 7591: stores a public client. Throws a `RegistrationError` with the RFC's error code when the request is unusable. */
export class RegistrationError extends Error {
  constructor(
    readonly code: 'invalid_client_metadata' | 'invalid_redirect_uri',
    message: string,
  ) {
    super(message);
  }
}

export async function registerClient(ctx: AppContext, body: RegisterBody): Promise<OAuthClientRow> {
  const uris = body.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > 10) throw new RegistrationError('invalid_redirect_uri', 'redirect_uris: one to ten absolute URIs');
  for (const u of uris) if (!validRedirectUri(u as string)) throw new RegistrationError('invalid_redirect_uri', `redirect_uris: ${String(u).slice(0, 80)} is not https, a loopback http address or a private app scheme`);
  const method = body.token_endpoint_auth_method ?? 'none';
  if (method !== 'none') throw new RegistrationError('invalid_client_metadata', 'token_endpoint_auth_method: only "none" (public client with PKCE)');
  if (Array.isArray(body.grant_types) && body.grant_types.some((g) => g !== 'authorization_code' && g !== 'refresh_token')) throw new RegistrationError('invalid_client_metadata', 'grant_types: only authorization_code');
  if (Array.isArray(body.response_types) && body.response_types.some((r) => r !== 'code')) throw new RegistrationError('invalid_client_metadata', 'response_types: only code');
  const name = typeof body.client_name === 'string' && body.client_name.trim() ? body.client_name.trim().slice(0, 80) : 'MCP client';
  const [row] = await ctx.db
    .insert(oauthClients)
    .values({ id: `mcp_${randomBytes(16).toString('base64url')}`, name, redirectUris: JSON.stringify((uris as string[]).map(String)) })
    .returning();
  return row!;
}

export async function getClient(ctx: AppContext, id: string): Promise<(OAuthClientRow & { uris: string[] }) | null> {
  if (!id || id.length > 100) return null;
  const row = await ctx.db.query.oauthClients.findFirst({ where: eq(oauthClients.id, id) });
  if (!row) return null;
  let uris: string[] = [];
  try {
    uris = JSON.parse(row.redirectUris) as string[];
  } catch {
    /* an unreadable row registers nothing */
  }
  return { ...row, uris };
}

/** What RFC 7591 tells the client back; never more than it sent plus the id. */
export const clientInfo = (row: OAuthClientRow) => ({
  client_id: row.id,
  client_name: row.name,
  redirect_uris: JSON.parse(row.redirectUris) as string[],
  token_endpoint_auth_method: 'none',
  grant_types: ['authorization_code'],
  response_types: ['code'],
  client_id_issued_at: Math.floor(Date.parse(row.createdAt) / 1000),
});

export interface PendingCode {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scopes: TokenScopes | null;
  userId: string;
  userEmail: string;
  resource?: string | undefined;
  exp: number;
}

const CODE_TTL_MS = 10 * 60_000;

/** Authorization codes: random, ten minutes, one use. In memory on purpose (see the header). */
export class CodeStore {
  private readonly codes = new Map<string, PendingCode>();
  constructor(private readonly now: () => number = Date.now) {}

  issue(p: Omit<PendingCode, 'exp'>): string {
    this.sweep();
    const code = randomBytes(32).toString('base64url');
    this.codes.set(code, { ...p, exp: this.now() + CODE_TTL_MS });
    return code;
  }

  /** The entry for `code`, removed as it is read; null when unknown, used or expired. */
  redeem(code: string): PendingCode | null {
    const e = this.codes.get(code);
    this.codes.delete(code);
    return e && e.exp > this.now() ? e : null;
  }

  private sweep(): void {
    const t = this.now();
    for (const [k, v] of this.codes) if (v.exp <= t) this.codes.delete(k);
  }
}

/** The code_verifier matches the challenge the authorization carried (S256; RFC 7636 lengths). */
export function verifyPkce(verifier: unknown, challenge: string): boolean {
  if (typeof verifier !== 'string' || verifier.length < 43 || verifier.length > 128 || !/^[A-Za-z0-9._~-]+$/.test(verifier)) return false;
  const a = Buffer.from(pkceChallenge(verifier));
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A code_challenge as the authorization request must carry it: base64url of a SHA-256, 43 characters. */
export const validChallenge = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{43}$/.test(v);
