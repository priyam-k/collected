import { Hono } from 'hono';
import { z } from 'zod';
import { normalizeScopes, scopeGrantsAny, TOKEN_AREAS } from '@collected/shared';
import { SYNTHETIC_PERSONS, isPerson, upsertUser, userByEmail } from '@collected/core/auth/session';
import type { AuthVariables } from '../auth/cloudflare-access.js';
import type { AppContext } from '../context.js';
import { getClient, publicBase, validChallenge, type CodeStore } from '../mcp/oauth.js';
import { bad, parseBody } from './util.js';

/*
 * The consent page's one call: the signed-in person approves an MCP client with the scopes they picked, and gets back
 * the redirect that carries the code. Under /api so the session, the CSRF check and the person-only rule apply; the
 * rest of the flow (discovery, registration, authorize, token) is server/src/mcp/routes.ts and needs no sign-in.
 */

const approveSchema = z.object({
  clientId: z.string().min(1).max(100),
  redirectUri: z.string().min(1).max(2048),
  state: z.string().max(512).optional(),
  codeChallenge: z.string().refine(validChallenge, 'a base64url SHA-256'),
  codeChallengeMethod: z.literal('S256'),
  scopes: z
    .union([z.null(), z.partialRecord(z.enum(TOKEN_AREAS), z.enum(['read', 'write']))])
    .optional()
    .transform((v) => normalizeScopes(v)),
  resource: z.string().max(2048).optional(),
});

export function oauthApproveRoutes(ctx: AppContext, codes: CodeStore) {
  const r = new Hono<{ Variables: AuthVariables }>();
  const base = publicBase(ctx.env);

  r.post('/approve', async (c) => {
    const identity = c.get('user');
    if (!isPerson(identity)) bad('sign in as a person to approve a connector', 403);
    const synthetic = SYNTHETIC_PERSONS[identity!];
    const user = synthetic ? await upsertUser(ctx, synthetic) : ((await userByEmail(ctx, identity!)) ?? (await upsertUser(ctx, { email: identity! })));
    const b = await parseBody(c, approveSchema);
    const client = await getClient(ctx, b.clientId);
    if (!client) bad('unknown client', 404);
    if (!client.uris.includes(b.redirectUri)) bad('that redirect address is not one the client registered');
    if (b.resource && b.resource !== `${base}/mcp`) bad(`resource must be ${base}/mcp`);
    if (!scopeGrantsAny(b.scopes)) bad('give the connector read or write access to at least one area');
    const code = codes.issue({ clientId: client.id, redirectUri: b.redirectUri, codeChallenge: b.codeChallenge, scopes: b.scopes, userId: user.id, userEmail: user.email, resource: b.resource });
    const back = new URL(b.redirectUri);
    back.searchParams.set('code', code);
    if (b.state) back.searchParams.set('state', b.state);
    ctx.log.info({ user: user.email, client: client.id, scopes: b.scopes ?? 'all' }, 'mcp client approved');
    c.header('Cache-Control', 'no-store');
    return c.json({ redirect: back.toString() });
  });

  return r;
}
