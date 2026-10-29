import { describe, expect, it } from 'vitest';
import { testConfig } from '../../test-util.js';
import { pkceChallenge } from '../../auth/pkce.js';
import { signInRedirectUri, signInUrl } from '../../auth/google.js';
import { TASKS_SCOPE } from '../gtasks/api.js';
import { authUrl, exchangeCode, googleOAuthConfigured, incrementalAuthUrl, oauthClient, redirectUri } from './api.js';

const env = () => ({ ...testConfig(), GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' });

describe('google oauth client', () => {
  it('is configured only with both the id and the secret', () => {
    expect(googleOAuthConfigured(testConfig())).toBe(false);
    expect(googleOAuthConfigured({ ...testConfig(), GOOGLE_CLIENT_ID: 'id' })).toBe(false);
    expect(googleOAuthConfigured(env())).toBe(true);
  });

  it('builds every redirect URI from PUBLIC_URL alone, loopback literal included', () => {
    const local = { ...env(), PUBLIC_URL: 'http://127.0.0.1:53021' };
    expect(redirectUri(local)).toBe('http://127.0.0.1:53021/api/google/callback');
    expect(signInRedirectUri(local)).toBe('http://127.0.0.1:53021/api/auth/google/callback');
    expect(redirectUri({ ...env(), PUBLIC_URL: 'https://c.example.com/' })).toBe('https://c.example.com/api/google/callback');
    for (const u of [authUrl(local, 's', 'c'), incrementalAuthUrl(local, 's', [TASKS_SCOPE], 'c'), signInUrl(local, 's', 'c')]) {
      expect(new URL(u).searchParams.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:53021\/api\/(auth\/)?google\/callback$/);
    }
  });

  it('puts the S256 challenge on the auth URLs and keeps the consent parameters', () => {
    const challenge = pkceChallenge('v'.repeat(43));
    const cal = new URL(authUrl(env(), 'st', challenge));
    expect(cal.searchParams.get('code_challenge')).toBe(challenge);
    expect(cal.searchParams.get('code_challenge_method')).toBe('S256');
    expect(cal.searchParams.get('include_granted_scopes')).toBe('true');
    expect(cal.searchParams.get('prompt')).toBe('consent');
    expect(cal.searchParams.get('state')).toBe('st');
    const tasks = new URL(incrementalAuthUrl(env(), 'st', [TASKS_SCOPE], challenge));
    expect(tasks.searchParams.get('code_challenge')).toBe(challenge);
    expect(tasks.searchParams.get('scope')).toBe(TASKS_SCOPE);
    // Without a challenge (an older caller) nothing PKCE-related is sent.
    expect(new URL(authUrl(env(), 'st')).searchParams.has('code_challenge')).toBe(false);
  });

  it('sends the verifier with the code on the exchange', async () => {
    const client = oauthClient(env());
    const sent: URLSearchParams[] = [];
    // The library posts through its transporter; a fake one records the form and answers like Google.
    (client as unknown as { transporter: unknown }).transporter = {
      request: async (opts: { data: URLSearchParams }) => {
        sent.push(opts.data);
        return { data: { refresh_token: 'rt', scope: 'a b', access_token: 'at', expires_in: 3600 } };
      },
    };
    const out = await exchangeCode(env(), 'the-code', 'the-verifier', client);
    expect(out).toEqual({ refreshToken: 'rt', scopes: ['a', 'b'] });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.get('code')).toBe('the-code');
    expect(sent[0]!.get('code_verifier')).toBe('the-verifier');
    expect(sent[0]!.get('grant_type')).toBe('authorization_code');
    expect(sent[0]!.get('redirect_uri')).toBe('http://localhost:5173/api/google/callback');
  });
});
