import { isIP } from 'node:net';

/*
 * Checks on what the server, the model and the manifest hand this machine. The agent writes files and sends
 * credentials on the strength of their answers, so each one is validated here before it is acted on
 * (SECURITY-REVIEW 1.7, 1.8, 2.7, 2.10).
 */

/** The server's own rule for target names; a manifest or model answer that breaks it is never used as a path. */
export const TARGET_NAME = /^[a-z][a-z0-9_-]*$/;

/** Null when `name` may be used as a target, else why not. */
export function badTarget(name: string, allowed: string[]): string | null {
  if (!TARGET_NAME.test(name)) return `target "${name}" is not a valid name`;
  if (!allowed.includes(name)) return `target "${name}" is not one of this course's targets`;
  return null;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Throws unless `url` is https, or http to this machine. Credentials go to whatever this passes. The literal `local`
 * (agent.json's `server` in local mode) is not a URL and passes as null: nothing is sent anywhere.
 */
export function assertSecureUrl(url: string, what: string): URL | null {
  if (url === 'local') return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`${what} is not a URL: ${url}`);
  }
  if (u.protocol === 'https:') return u;
  if (u.protocol === 'http:' && LOOPBACK.has(u.hostname)) return u;
  throw new Error(`${what} must be https (plain http is only allowed for localhost): ${url}`);
}

const v4 = (h: string): number[] | null => {
  if (isIP(h) !== 4) return null;
  return h.split('.').map(Number);
};

/**
 * Hosts a download redirect may never point at: this machine, the LAN, link-local (cloud metadata lives there)
 * and mDNS names. Checked on the literal host only; a public name that resolves privately is out of scope here.
 */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
  const ip4 = v4(h);
  if (ip4) {
    const [a, b] = ip4 as [number, number];
    return a === 127 || a === 0 || a === 10 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (isIP(h) === 6) {
    if (h === '::1' || h === '::') return true;
    const head = h.split(':')[0]!.toLowerCase();
    if (/^fe[89ab]/.test(head)) return true; // fe80::/10
    if (/^f[cd]/.test(head)) return true; // fc00::/7
    const mapped = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateHost(mapped[1]!);
  }
  return false;
}

/**
 * Why a rule pattern from the manifest will not be compiled, or null when it is fine. Long patterns and a
 * quantified group that itself holds a quantifier (`(a+)+`) are the usual catastrophic-backtracking shapes.
 */
export function unsafePattern(pattern: string | null | undefined): string | null {
  if (pattern == null) return null;
  if (pattern.length > 200) return `pattern longer than 200 characters`;
  let depth = 0;
  const quantified: boolean[] = []; // per open group: has a quantifier been seen inside it
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === '(') {
      depth++;
      quantified.push(false);
    } else if (ch === ')') {
      const inner = quantified.pop() ?? false;
      depth = Math.max(0, depth - 1);
      const next = pattern[i + 1];
      if (inner && (next === '+' || next === '*' || next === '{')) return `nested quantifier at "${pattern.slice(Math.max(0, i - 8), i + 2)}"`;
      if (inner && quantified.length) quantified[quantified.length - 1] = true;
    } else if ((ch === '+' || ch === '*' || ch === '{') && quantified.length) {
      quantified[quantified.length - 1] = true;
    }
  }
  return null;
}
