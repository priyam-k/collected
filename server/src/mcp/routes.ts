import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { formatScopes } from '@collected/shared';
import { createToken } from '@collected/core/auth/session';
import { readJson, type CommandApi } from '@collected/core/commands/api';
import { buildServer } from '@collected/core/commands/mcp';
import { resolveIdentity } from '../auth/cloudflare-access.js';
import type { AppContext } from '../context.js';
import { CodeStore, RegistrationError, clientInfo, getClient, publicBase, registerClient, resourceMetadata, serverMetadata, validChallenge, verifyPkce } from './oauth.js';

/*
 * The remote MCP endpoint and its OAuth front door, mounted at the app root (not under /api, whose middleware is for
 * the dashboard's own routes). `POST /mcp` takes a bearer API token and answers through the running app itself: every
 * tool call becomes an in-process request carrying the same Authorization header, so identityAllows and the token's
 * scopes decide exactly as they would for the CLI. Stateless Streamable HTTP: one server per request, JSON answers,
 * no sessions, no SSE.
 */

export interface McpRouteDeps {
  /** The app's own fetch, for the in-process requests the tools make. */
  fetchApp: (req: Request) => Promise<Response>;
  version: string;
  codes: CodeStore;
}

const MB = 1024 * 1024;

export function mcpRoutes(ctx: AppContext, deps: McpRouteDeps) {
  const r = new Hono();
  const base = publicBase(ctx.env);
  const noStore = (c: { header: (k: string, v: string) => void }) => {
    c.header('Cache-Control', 'no-store');
    c.header('Pragma', 'no-cache');
  };
  r.use('/oauth/*', bodyLimit({ maxSize: 64 * 1024 }));
  r.use('/mcp', bodyLimit({ maxSize: 1 * MB }));

  // --- discovery (RFC 9728, RFC 8414)
  const resource = (c: { json: (b: unknown) => Response }) => c.json(resourceMetadata(base));
  r.get('/.well-known/oauth-protected-resource', resource);
  r.get('/.well-known/oauth-protected-resource/mcp', resource);
  r.get('/.well-known/oauth-authorization-server', (c) => c.json(serverMetadata(base)));

  // --- dynamic client registration (RFC 7591)
  r.post('/oauth/register', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_client_metadata', error_description: 'a JSON body' }, 400);
    }
    try {
      const row = await registerClient(ctx, (body ?? {}) as Parameters<typeof registerClient>[1]);
      ctx.log.info({ client: row.id, name: row.name }, 'mcp client registered');
      noStore(c);
      return c.json(clientInfo(row), 201);
    } catch (err) {
      if (err instanceof RegistrationError) return c.json({ error: err.code, error_description: err.message }, 400);
      throw err;
    }
  });

  // --- authorization: validate, then hand the person to the consent page in the web app
  r.get('/oauth/authorize', async (c) => {
    const q = c.req.query();
    const client = await getClient(ctx, q.client_id ?? '');
    // An unknown client or a redirect it did not register gets an answer here, never a redirect (RFC 6749 §4.1.2.1).
    if (!client) return c.text('unknown client_id: register at /oauth/register first', 400);
    if (!q.redirect_uri || !client.uris.includes(q.redirect_uri)) return c.text('redirect_uri is not one this client registered', 400);
    const back = new URL(q.redirect_uri);
    const fail = (error: string, description: string) => {
      back.searchParams.set('error', error);
      back.searchParams.set('error_description', description);
      if (q.state) back.searchParams.set('state', q.state);
      return c.redirect(back.toString(), 302);
    };
    if (q.response_type !== 'code') return fail('unsupported_response_type', 'response_type must be code');
    if (!validChallenge(q.code_challenge) || (q.code_challenge_method ?? 'plain') !== 'S256') return fail('invalid_request', 'PKCE with S256 is required');
    if (q.state && q.state.length > 512) return fail('invalid_request', 'state is too long');
    if (q.resource && q.resource !== `${base}/mcp`) return fail('invalid_target', `resource must be ${base}/mcp`);
    const consent = new URL(`${base}/oauth/consent`);
    for (const k of ['client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'scope', 'resource'] as const) if (q[k]) consent.searchParams.set(k, q[k]!);
    consent.searchParams.set('client_name', client.name);
    noStore(c);
    return c.redirect(consent.toString(), 302);
  });

  // --- token: a code plus its verifier becomes an API token with the scopes the person chose
  r.post('/oauth/token', async (c) => {
    noStore(c);
    const fail = (error: string, description: string, status: 400 | 401 = 400) => c.json({ error, error_description: description }, status);
    let p: Record<string, string>;
    try {
      const ct = c.req.header('content-type') ?? '';
      p = /^application\/json\b/i.test(ct) ? ((await c.req.json()) as Record<string, string>) : (Object.fromEntries(Object.entries(await c.req.parseBody()).map(([k, v]) => [k, typeof v === 'string' ? v : ''])) as Record<string, string>);
    } catch {
      return fail('invalid_request', 'a form or JSON body');
    }
    if (p.grant_type !== 'authorization_code') return fail('unsupported_grant_type', 'only authorization_code');
    if (!p.code || !p.client_id || !p.code_verifier) return fail('invalid_request', 'code, client_id and code_verifier are required');
    const entry = deps.codes.redeem(p.code);
    if (!entry) return fail('invalid_grant', 'the code is unknown, used or expired; start again');
    if (entry.clientId !== p.client_id) return fail('invalid_grant', 'the code belongs to another client');
    if (p.redirect_uri && p.redirect_uri !== entry.redirectUri) return fail('invalid_grant', 'redirect_uri differs from the authorization request');
    if (!verifyPkce(p.code_verifier, entry.codeChallenge)) return fail('invalid_grant', 'code_verifier does not match');
    if (p.resource && p.resource !== `${base}/mcp`) return fail('invalid_target', `resource must be ${base}/mcp`);
    const client = await getClient(ctx, entry.clientId);
    const { token, row } = await createToken(ctx, entry.userId, `${client?.name ?? 'MCP client'} · MCP`, entry.scopes);
    ctx.log.info({ user: entry.userEmail, token: row.prefix, client: entry.clientId, scopes: entry.scopes ?? 'all' }, 'mcp token issued');
    return c.json({ access_token: token, token_type: 'Bearer', scope: formatScopes(entry.scopes).replace(/,/g, ' ') });
  });

  // --- the endpoint
  const unauthorized = (c: { header: (k: string, v: string) => void; json: (b: unknown, s: 401) => Response }) => {
    c.header('WWW-Authenticate', `Bearer realm="collected", resource_metadata="${base}/.well-known/oauth-protected-resource"`);
    return c.json({ error: 'unauthorized', error_description: 'a bearer API token; see the resource metadata' }, 401);
  };
  r.on(['GET', 'DELETE'], '/mcp', (c) => {
    c.header('Allow', 'POST');
    return c.json({ error: 'method not allowed: this server is stateless, POST each request' }, 405);
  });
  r.post('/mcp', async (c) => {
    const authz = c.req.header('authorization');
    // A cookie never opens this route: the bearer header is the credential, so a browser cannot be made to call it.
    if (!authz && !ctx.env.AUTH_DISABLED && !ctx.env.LOCAL_OWNER) return unauthorized(c);
    const id = await resolveIdentity(ctx, c);
    if (!id || id.user === 'helper') return unauthorized(c);
    const headers: Record<string, string> = { accept: 'application/json' };
    if (authz) headers.authorization = authz;
    const api: CommandApi = {
      get: <T>(p: string) => call<T>('GET', p),
      send: <T>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', p: string, body?: unknown) => call<T>(method, p, body),
    };
    async function call<T>(method: string, p: string, body?: unknown): Promise<T> {
      const init: RequestInit = { method, headers: body !== undefined ? { ...headers, 'content-type': 'application/json' } : headers };
      if (body !== undefined) init.body = JSON.stringify(body);
      return readJson<T>(p, await deps.fetchApp(new Request(`${base}${p}`, init)));
    }
    const server = buildServer({ api, version: deps.version });
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    try {
      return await transport.handleRequest(c.req.raw);
    } finally {
      void transport.close();
    }
  });

  return r;
}
