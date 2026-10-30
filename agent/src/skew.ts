import { compareSemver, parseSemver } from '@collected/core/lib/changelog';
import { MIN_CLIENT_HEADER, VERSION_HEADER } from '@collected/core/lib/version';
import type { SkewState } from './state.js';

/*
 * Client/server version skew, client mode only (local mode runs the app in-process, so there is nothing to compare).
 * The server puts its version and the oldest CLI it talks to in two headers on every `/api/*` answer; the CLI reads
 * them off whatever request it was making and decides, with no round trip of its own:
 *
 *   ok      same major, at or above minClient, not behind in minor         nothing printed
 *   behind  same major, at or above minClient, the server's minor is newer  one stderr line, at most once a day
 *   refuse  another major, or below minClient                               nothing else is sent; exit 2
 *
 * A missing or unreadable header (an older server, a proxy page) is never a reason to break a command. Everything
 * here goes to stderr; `--json` on stdout is untouched. The once-a-day notice also says when npm has a newer CLI than
 * the one running, in both modes; the gate and the npm answer live in ~/.collected/state.json.
 */

export const NOTICE_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type SkewDecision = { kind: 'ok' } | { kind: 'behind'; line: string } | { kind: 'refuse'; line: string };

export interface SkewInput {
  /** This CLI's version (version.ts). */
  client: string;
  /** The server's, from the header; null or garbage when there was none. */
  server: string | null | undefined;
  /** The server's minClient, from its header; null when the server did not say. */
  minClient?: string | null | undefined;
}

/** `collected-cli 1.2.0 · server 1.3.0`, the start of every line. */
const pair = (client: string, server: string): string => `collected-cli ${client} · server ${server}`;

export function decideSkew({ client, server, minClient }: SkewInput): SkewDecision {
  const c = parseSemver(client);
  const s = server ? parseSemver(server) : null;
  if (!c || !s || !server) return { kind: 'ok' };
  if (c[0] !== s[0]) {
    const line =
      c[0] < s[0]
        ? `${pair(client, server)} · run: collected upgrade · this server needs collected-cli >= ${minClient && parseSemver(minClient) ? minClient : `${s[0]}.0.0`}`
        : `${pair(client, server)} · this server takes collected-cli ${s[0]}.x: npm install -g collected-cli@${s[0]}`;
    return { kind: 'refuse', line };
  }
  if (minClient && parseSemver(minClient) && compareSemver(client, minClient) < 0) {
    return { kind: 'refuse', line: `${pair(client, server)} · run: collected upgrade · this server needs collected-cli >= ${minClient}` };
  }
  if (c[1] < s[1]) return { kind: 'behind', line: `${pair(client, server)} · run: collected upgrade` };
  return { kind: 'ok' };
}

/** The refusal: the command stops before sending anything else; cli.ts exits 2 with the line. */
export class SkewError extends Error {
  readonly exitCode = 2;
  constructor(line: string) {
    super(line);
    this.name = 'SkewError';
  }
}

/**
 * Watches the headers of every answer the HTTP client gets. The first answer that names a server version decides:
 * a refusal throws once, from inside the request that learned it, so no later request goes out; anything else is
 * remembered for the notice at the end of the command.
 */
export class VersionWatch {
  server: string | null = null;
  minClient: string | null = null;
  private decided = false;

  constructor(readonly client: string) {}

  see(headers: Pick<Headers, 'get'>): void {
    const v = headers.get(VERSION_HEADER);
    if (!v || !parseSemver(v)) return;
    this.server = v.trim();
    this.minClient = headers.get(MIN_CLIENT_HEADER);
    if (this.decided) return;
    this.decided = true;
    const d = decideSkew({ client: this.client, server: this.server, minClient: this.minClient });
    if (d.kind === 'refuse') throw new SkewError(d.line);
  }
}

/**
 * Whether the once-a-day check runs now: never within 24 h of the last one, unless the server's version changed since
 * (a server that moved is worth a fresh look). An unreadable or far-future timestamp counts as "never ran".
 */
export function noticeDue(state: Pick<SkewState, 'lastSkewNoticeAt' | 'lastServerVersion'>, now: Date, server: string | null): boolean {
  if (server && state.lastServerVersion && server !== state.lastServerVersion) return true;
  if (!state.lastSkewNoticeAt) return true;
  const last = Date.parse(state.lastSkewNoticeAt);
  if (Number.isNaN(last)) return true;
  const age = now.getTime() - last;
  return age >= NOTICE_INTERVAL_MS || age < -NOTICE_INTERVAL_MS;
}

/**
 * The one line, or null when there is nothing to say: the server's newer minor when behind it, npm's newer version
 * when the registry has one, both when both, each ending in `run: collected upgrade`.
 */
export function noticeLine(client: string, server: string | null, minClient: string | null, npmLatest: string | null): string | null {
  const d = decideSkew({ client, server, minClient });
  const npmNewer = !!npmLatest && !!parseSemver(npmLatest) && compareSemver(npmLatest, client) > 0;
  if (d.kind === 'ok' && !npmNewer) return null;
  const parts = [`collected-cli ${client}`];
  if (d.kind !== 'ok' && server) parts.push(`server ${server}`);
  if (npmNewer) parts.push(`${npmLatest} on npm`);
  parts.push('run: collected upgrade');
  return parts.join(' · ');
}

export interface NoticeOptions {
  client: string;
  /** What the command's requests saw (client mode); null in local mode. */
  server: string | null;
  minClient: string | null;
  verbose: boolean;
  /** Where the line goes: stderr. */
  warn: (line: string) => void;
  now?: Date;
  state: { load: () => SkewState; save: (patch: SkewState) => void };
  /** Asks npm for the newest version, or null when it cannot (upgrade.ts); unset or a disabled check asks nothing. */
  npmLatest?: (() => Promise<{ version: string | null; error?: string }>) | undefined;
}

/** The end-of-command check behind the gate: ask npm (when allowed), remember when and what, print the line if any. */
export async function maybeNotice(o: NoticeOptions): Promise<void> {
  const now = o.now ?? new Date();
  const st = o.state.load();
  if (!noticeDue(st, now, o.server)) return;
  let npmLatest = st.npmLatest;
  if (o.npmLatest) {
    const r = await o.npmLatest();
    if (r.version) npmLatest = r.version;
    else if (o.verbose) o.warn(`npm version check: ${r.error ?? 'no answer'}`);
  }
  o.state.save({ lastSkewNoticeAt: now.toISOString(), lastServerVersion: o.server ?? st.lastServerVersion, npmLatest });
  const line = noticeLine(o.client, o.server, o.minClient, npmLatest);
  if (line) o.warn(line);
}
