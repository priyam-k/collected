import { describe, expect, it } from 'vitest';
import { createPkce, pkceChallenge } from './pkce.js';

describe('pkce', () => {
  it('makes a 43-char base64url verifier and its S256 challenge', () => {
    const p = createPkce();
    expect(p.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(p.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(p.challenge).toBe(pkceChallenge(p.verifier));
    expect(createPkce().verifier).not.toBe(p.verifier);
  });

  it('matches the RFC 7636 appendix B vector', () => {
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
});
