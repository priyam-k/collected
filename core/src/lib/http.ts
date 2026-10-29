import { isIP } from 'node:net';

/** Per-request deadline on top of the run's signal, so one stuck upstream connection cannot hold a run open. */
export function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const t = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, t]) : t;
}

export class ResponseTooLargeError extends Error {
  constructor(limit: number) {
    super(`response exceeded ${Math.round(limit / 1024 / 1024)} MB`);
    this.name = 'ResponseTooLargeError';
  }
}

/**
 * Reads a response body as text with a byte budget. Every upstream (Canvas, Gradescope, a job feed, an iCal URL)
 * is read this way so a hostile or broken server cannot grow the heap past the 384 MB the box gives us.
 */
export async function readText(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new ResponseTooLargeError(maxBytes);
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export async function readJson(res: Response, maxBytes: number): Promise<unknown> {
  return JSON.parse(await readText(res, maxBytes));
}

export const MB = 1024 * 1024;

const PRIVATE_V4 = [/^10\./, /^127\./, /^0\./, /^169\.254\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./];

/** Loopback, link-local, private and ULA ranges, plus the names resolvers hand them out under. */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h === 'metadata.google.internal') return true;
  const v = isIP(h);
  if (v === 4) return PRIVATE_V4.some((re) => re.test(h));
  if (v === 6) {
    if (h === '::1' || h === '::') return true;
    if (/^f[cd]/.test(h) || /^fe[89ab]/.test(h)) return true;
    const mapped = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return PRIVATE_V4.some((re) => re.test(mapped[1]!));
  }
  return false;
}

/**
 * Whether a configured upstream URL may be fetched from the server: https to a public host. Plain http is allowed
 * only to loopback, for a local fixture server in development. This is the policy for every user-settable URL
 * (Canvas base URL, iCal feed, job feeds) and for every redirect or pagination link an upstream hands back.
 */
export function isAllowedOutboundUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.username || u.password) return false;
  const priv = isPrivateHost(u.hostname);
  if (u.protocol === 'https:') return !priv;
  if (u.protocol === 'http:') return priv && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname);
  return false;
}

export function assertAllowedOutboundUrl(raw: string, what: string): URL {
  if (!isAllowedOutboundUrl(raw)) throw new Error(`${what} must be an https URL to a public host (got ${safeUrlForLog(raw)})`);
  return new URL(raw);
}

/** Origin + path only: never log a query string, which is where upstreams put tokens. */
export function safeUrlForLog(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.origin}${u.pathname}`;
  } catch {
    return raw.slice(0, 80);
  }
}
