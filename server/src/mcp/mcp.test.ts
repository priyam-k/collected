import { describe, expect, it } from 'vitest';
import { createPkce } from '@collected/core/auth/pkce';
import { createSession, upsertUser } from '@collected/core/auth/session';
import { createApp } from '../app.js';
import type { AppContext } from '../context.js';
import { testContext } from '../test-util.js';

const BASE = 'https://collected.example.com';
async function signedCtx(): Promise<AppContext> {
  const ctx = await testContext();
  return { ...ctx, env: { ...ctx.env, AUTH_DISABLED: false, GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret', PUBLIC_URL: BASE } };
}
const json = (body: unknown, headers: Record<string, string> = {}) => ({ method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const form = (fields: Record<string, string>) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() });
const rpc = (token: string | null, id: number, method: string, params?: unknown) =>
  json({ jsonrpc: '2.0', id, method, params }, { accept: 'application/json, text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {}) });

describe('remote MCP: OAuth front door and the endpoint', () => {
  it('runs the whole flow and the token comes out scoped', async () => {
    const ctx = await signedCtx();
    const { app } = createApp(ctx);
    const user = await upsertUser(ctx, { email: 'me@example.com' });
    const s = await createSession(ctx, user.id);
    const cookie = { cookie: `collected_session=${s.id}` };

    // discovery
    const prm = await (await app.request(`${BASE}/.well-known/oauth-protected-resource`)).json();
    expect(prm).toMatchObject({ resource: `${BASE}/mcp`, authorization_servers: [BASE] });
    const asm = await (await app.request(`${BASE}/.well-known/oauth-authorization-server`)).json();
    expect(asm).toMatchObject({ issuer: BASE, token_endpoint: `${BASE}/oauth/token`, registration_endpoint: `${BASE}/oauth/register`, code_challenge_methods_supported: ['S256'] });

    // the endpoint without a token points at the metadata
    const anon = await app.request(`${BASE}/mcp`, rpc(null, 1, 'tools/list'));
    expect(anon.status).toBe(401);
    expect(anon.headers.get('www-authenticate')).toContain('resource_metadata=');
    expect((await app.request(`${BASE}/mcp`)).status).toBe(405);

    // registration
    expect((await app.request(`${BASE}/oauth/register`, json({ client_name: 'Claude', redirect_uris: ['javascript:alert(1)'] }))).status).toBe(400);
    expect((await app.request(`${BASE}/oauth/register`, json({ client_name: 'Claude', redirect_uris: ['http://evil.example.com/cb'] }))).status).toBe(400);
    const reg = await app.request(`${BASE}/oauth/register`, json({ client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback', 'claude://cb'], token_endpoint_auth_method: 'none' }));
    expect(reg.status).toBe(201);
    const client = (await reg.json()) as { client_id: string; client_name: string };
    expect(client.client_name).toBe('Claude');

    // authorize: bad redirect answers 400, a good one lands on the consent page with the client's name
    const pkce = createPkce();
    const q = (extra: Record<string, string> = {}) =>
      new URLSearchParams({ response_type: 'code', client_id: client.client_id, redirect_uri: 'https://claude.ai/api/mcp/auth_callback', state: 'xyz', code_challenge: pkce.challenge, code_challenge_method: 'S256', ...extra }).toString();
    expect((await app.request(`${BASE}/oauth/authorize?${q({ redirect_uri: 'https://claude.ai/other' })}`)).status).toBe(400);
    expect((await app.request(`${BASE}/oauth/authorize?${q({ client_id: 'nope' })}`)).status).toBe(400);
    const plain = await app.request(`${BASE}/oauth/authorize?${q({ code_challenge_method: 'plain' })}`);
    expect(plain.status).toBe(302);
    expect(plain.headers.get('location')).toContain('error=invalid_request');
    const auth = await app.request(`${BASE}/oauth/authorize?${q()}`);
    expect(auth.status).toBe(302);
    const consent = new URL(auth.headers.get('location')!);
    expect(consent.pathname).toBe('/oauth/consent');
    expect(consent.searchParams.get('client_name')).toBe('Claude');
    expect(consent.searchParams.get('code_challenge')).toBe(pkce.challenge);

    // consent: a person approves with scopes; a token may not
    const approval = { clientId: client.client_id, redirectUri: 'https://claude.ai/api/mcp/auth_callback', state: 'xyz', codeChallenge: pkce.challenge, codeChallengeMethod: 'S256', scopes: { jobs: 'read' } };
    expect((await app.request(`${BASE}/api/oauth/approve`, json(approval))).status).toBe(401);
    expect((await app.request(`${BASE}/api/oauth/approve`, json({ ...approval, redirectUri: 'https://claude.ai/other' }, cookie))).status).toBe(400);
    expect((await app.request(`${BASE}/api/oauth/approve`, json({ ...approval, scopes: {} }, cookie))).status).toBe(400);
    const ok = await app.request(`${BASE}/api/oauth/approve`, json(approval, cookie));
    expect(ok.status).toBe(200);
    const back = new URL(((await ok.json()) as { redirect: string }).redirect);
    expect(back.origin + back.pathname).toBe('https://claude.ai/api/mcp/auth_callback');
    expect(back.searchParams.get('state')).toBe('xyz');
    const code = back.searchParams.get('code')!;
    expect(code.length).toBeGreaterThan(20);

    // token: wrong verifier fails and burns the code; so approve again and exchange properly
    const bad = await app.request(`${BASE}/oauth/token`, form({ grant_type: 'authorization_code', code, client_id: client.client_id, redirect_uri: approval.redirectUri, code_verifier: 'x'.repeat(50) }));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: 'invalid_grant' });
    const again = new URL(((await (await app.request(`${BASE}/api/oauth/approve`, json(approval, cookie))).json()) as { redirect: string }).redirect);
    const tok = await app.request(`${BASE}/oauth/token`, form({ grant_type: 'authorization_code', code: again.searchParams.get('code')!, client_id: client.client_id, redirect_uri: approval.redirectUri, code_verifier: pkce.verifier }));
    expect(tok.status).toBe(200);
    expect(tok.headers.get('cache-control')).toBe('no-store');
    const issued = (await tok.json()) as { access_token: string; token_type: string; scope: string };
    expect(issued.token_type).toBe('Bearer');
    expect(issued.scope).toBe('jobs:r');
    expect(issued.access_token.startsWith('clt_')).toBe(true);
    // a code is single use
    expect((await app.request(`${BASE}/oauth/token`, form({ grant_type: 'authorization_code', code: again.searchParams.get('code')!, client_id: client.client_id, code_verifier: pkce.verifier }))).status).toBe(400);

    // the token is an ordinary scoped API token, listed for the person
    const list = (await (await app.request(`${BASE}/api/auth/tokens`, { headers: cookie })).json()) as { name: string; scopes: unknown }[];
    expect(list.find((t) => t.name === 'Claude · MCP')?.scopes).toEqual({ jobs: 'read' });

    // the endpoint: tools listed, a read works, a write is refused by the scope and reported as a tool error
    const t = issued.access_token;
    const listed = (await (await app.request(`${BASE}/mcp`, rpc(t, 2, 'tools/list'))).json()) as { result: { tools: { name: string }[] } };
    expect(listed.result.tools.map((x) => x.name)).toContain('jobs_search');
    const read = (await (await app.request(`${BASE}/mcp`, rpc(t, 3, 'tools/call', { name: 'jobs_tracked', arguments: {} }))).json()) as { result: { isError?: boolean; content: { text: string }[] } };
    expect(read.result.isError).toBeFalsy();
    expect(JSON.parse(read.result.content[0]!.text)).toEqual([]);
    const write = (await (await app.request(`${BASE}/mcp`, rpc(t, 4, 'tools/call', { name: 'jobs_add', arguments: { company: 'Beta', title: 'Intern' } }))).json()) as { result: { isError?: boolean; content: { text: string }[] } };
    expect(write.result.isError).toBe(true);
    expect(write.result.content[0]!.text).toContain('no write access to jobs');
    const other = (await (await app.request(`${BASE}/mcp`, rpc(t, 5, 'tools/call', { name: 'courses', arguments: {} }))).json()) as { result: { isError?: boolean; content: { text: string }[] } };
    expect(other.result.isError).toBe(true);
    expect(other.result.content[0]!.text).toContain('no read access to courses');
    // a token never approves connectors
    expect((await app.request(`${BASE}/api/oauth/approve`, json(approval, { authorization: `Bearer ${t}` }))).status).toBe(403);
    // revoked in Settings → Account, the connector is out
    const row = (await (await app.request(`${BASE}/api/auth/tokens`, { headers: cookie })).json() as { id: string; name: string }[]).find((x) => x.name === 'Claude · MCP')!;
    await app.request(`${BASE}/api/auth/tokens/${row.id}`, { method: 'DELETE', headers: cookie });
    expect((await app.request(`${BASE}/mcp`, rpc(t, 6, 'tools/list'))).status).toBe(401);
  });
});
