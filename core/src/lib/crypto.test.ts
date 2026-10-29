import { describe, expect, it } from 'vitest';
import { createCrypto } from './crypto.js';

const KEY = 'a'.repeat(64);

describe('crypto', () => {
  it('round-trips JSON', () => {
    const c = createCrypto(KEY);
    const value = { token: 'secret', nested: { n: 1, arr: [1, 2, 3] } };
    const enc = c.encryptJson(value);
    expect(enc).not.toContain('secret');
    expect(c.decryptJson(enc)).toEqual(value);
  });

  it('produces a different ciphertext each time (random iv)', () => {
    const c = createCrypto(KEY);
    expect(c.encryptJson('x')).not.toEqual(c.encryptJson('x'));
  });

  it('rejects tampered payloads and wrong keys', () => {
    const c = createCrypto(KEY);
    const enc = c.encryptJson({ a: 1 });
    const [iv, tag, ct] = enc.split('.');
    const flipped = Buffer.from(ct!, 'base64');
    flipped[0] = (flipped[0]! + 1) & 0xff;
    expect(() => c.decryptJson([iv, tag, flipped.toString('base64')].join('.'))).toThrow();
    expect(() => createCrypto('b'.repeat(64)).decryptJson(enc)).toThrow();
    expect(() => createCrypto('short')).toThrow();
  });
});
