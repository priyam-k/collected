import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';

export interface Crypto {
  encryptJson(value: unknown): string;
  decryptJson<T = unknown>(payload: string): T;
}

/** AES-256-GCM. Output: base64(iv) . base64(tag) . base64(ciphertext) */
export function createCrypto(secretKeyHex: string): Crypto {
  const key = Buffer.from(secretKeyHex, 'hex');
  if (key.length !== 32) throw new Error('SECRET_KEY must decode to 32 bytes');
  return {
    encryptJson(value) {
      const iv = randomBytes(12);
      const cipher = createCipheriv(ALGO, key, iv);
      const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
      const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const tag = cipher.getAuthTag();
      return [iv, tag, ct].map((b) => b.toString('base64')).join('.');
    },
    decryptJson(payload) {
      const parts = payload.split('.');
      if (parts.length !== 3) throw new Error('Malformed encrypted payload');
      const [iv, tag, ct] = parts.map((p) => Buffer.from(p, 'base64')) as [Buffer, Buffer, Buffer];
      const decipher = createDecipheriv(ALGO, key, iv);
      decipher.setAuthTag(tag);
      const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
      return JSON.parse(pt.toString('utf8'));
    },
  };
}
