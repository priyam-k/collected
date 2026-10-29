import { existsSync } from 'node:fs';
import path from 'node:path';
import { createContext, createLogger } from '@collected/core';
import { getSourceRow } from '@collected/core/lib/sources';
import type { GoogleConnectReason, GoogleConnectResult, GoogleConnectTarget } from '@collected/server/api/google';
import { startServer } from '@collected/server/serve';
import { isLocal, localDataDir, type AgentConfig } from './config.js';
import { localDotenvPath } from './dotenv.js';
import { localEnv } from './local.js';
import { shippedWebDist } from './paths.js';
import { LOOPBACK, openBrowser } from './ui.js';

/*
 * `collected connect google [calendar|tasks]`: the Google sign-in for people who never open `ui`. Local mode only.
 * The same app `ui` serves is put on an ephemeral loopback port without the scheduler, the browser is sent to its
 * `/api/google/start`, and the command waits for Google to bring the browser back to the callback, then stops the
 * listener. PUBLIC_URL is the literal `http://127.0.0.1:<port>` the listener got: the redirect URI Google sees and
 * the same-site check are both built from it, and a desktop client accepts any loopback port. Against a server the
 * flow has to run where the server's redirect URI points, so the command says to use Settings → Sources there.
 */

export type GoogleTarget = 'calendar' | 'tasks';

export const CONNECT_TIMEOUT_MS = 3 * 60_000;
/** How long the listener stays up after the callback, so the Sources page the browser was sent to can load. */
const GRACE_MS = 1500;
const POLL_MS = 1000;

export interface ConnectGoogleOptions {
  target: GoogleTarget;
  log: (s: string) => void;
  /** Only print the URL; for a shell without a browser. */
  noOpen?: boolean | undefined;
  logLevel?: string | undefined;
  verbose?: boolean | undefined;
  /** Injected in tests: a fake browser that drives the callback, a short timeout, no grace. */
  open?: ((url: string) => void) | undefined;
  timeoutMs?: number | undefined;
  graceMs?: number | undefined;
}

export type ConnectGoogleOutcome =
  | { ok: true; source: GoogleConnectTarget; detail: string }
  | { ok: false; source: GoogleConnectTarget; reason: GoogleConnectReason | 'timeout'; detail: string };

const SOURCE: Record<GoogleTarget, GoogleConnectTarget> = { calendar: 'gcal', tasks: 'gtasks' };
const LABEL: Record<GoogleConnectTarget, string> = { gcal: 'Google Calendar', gtasks: 'Google Tasks' };

/** What a failed callback means, in the words the Sources page uses for the same reason codes. */
export const CONNECT_ERRORS: Record<GoogleConnectReason | 'timeout', string> = {
  denied: 'access was denied on the consent screen',
  expired: 'the sign-in link expired; run it again',
  exchange: 'Google rejected the token exchange',
  config: 'the Google client is not set up correctly (client id, secret or redirect URI)',
  unknown: 'the first sync failed; `collected sources` has the error',
  timeout: 'no answer from the browser in 3 minutes; run it again',
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function connectGoogle(cfg: AgentConfig, opts: ConnectGoogleOptions): Promise<ConnectGoogleOutcome> {
  const source = SOURCE[opts.target];
  const label = LABEL[source];
  if (!isLocal(cfg)) {
    throw new Error(`\`collected connect google\` runs the Google sign-in on this machine in local mode only. Against a server, open ${cfg.server.replace(/\/$/, '')}/settings/sources and click Connect ${label}.`);
  }
  const dataDir = localDataDir(cfg);
  // The port is not known yet; PUBLIC_URL is corrected to the listener's address below, before the browser is sent.
  const env = localEnv(dataDir, { logLevel: opts.logLevel, verbose: opts.verbose, publicUrl: `http://${LOOPBACK}`, scheduler: false });
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new Error(`this build ships without a Google client. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to ${localDotenvPath()} (a "Desktop app" OAuth client; see the README), or use the Google Calendar (iCal) source.`);
  }
  const log = createLogger(env.LOG_LEVEL, false, { stderr: true });
  const ctx = await createContext(env, { log });
  let settle: (r: GoogleConnectResult) => void = () => {};
  const fromCallback = new Promise<GoogleConnectResult>((resolve) => (settle = resolve));
  // The web build, when there is one, so the page Google sends the browser back to is the Sources page with its toast.
  const webDist = shippedWebDist();
  const running = await startServer(ctx, {
    port: 0,
    hostname: LOOPBACK,
    webDist: existsSync(path.join(webDist, 'index.html')) ? webDist : undefined,
    onGoogleConnect: (r) => {
      if (r.target === source) settle(r);
    },
  });
  try {
    // Same object the routes read (`ctx.env`), per request: the redirect URI and the same-site check now carry the real port.
    ctx.env.PUBLIC_URL = running.url;
    const startUrl = `${running.url}/api/google/start${source === 'gtasks' ? '?source=gtasks' : ''}`;
    opts.log(`listening on ${running.url} for Google's answer (data ${dataDir})`);
    opts.log(opts.noOpen ? `open this in your browser to connect ${label}:\n  ${startUrl}` : `opening Google's consent screen for ${label}; if the browser does not open, visit:\n  ${startUrl}`);
    if (!opts.noOpen) (opts.open ?? openBrowser)(startUrl);
    const before = (await getSourceRow(ctx, source)).configEnc;
    const timeoutMs = opts.timeoutMs ?? CONNECT_TIMEOUT_MS;
    const outcome = await Promise.race([fromCallback, pollConnected(ctx, source, before, timeoutMs), sleep(timeoutMs).then(() => 'timeout' as const)]);
    if (outcome === 'timeout') return { ok: false, source, reason: 'timeout', detail: `${label} not connected: ${CONNECT_ERRORS.timeout}` };
    // The browser is being sent to the Sources page of this listener either way; give that page a moment to load.
    await sleep(opts.graceMs ?? GRACE_MS);
    if (!outcome.ok) return { ok: false, source, reason: outcome.reason, detail: `${label} not connected: ${CONNECT_ERRORS[outcome.reason]}` };
    const row = await getSourceRow(ctx, source);
    const meta = (row.meta ?? {}) as { calendars?: { summary: string }[]; lists?: { title: string }[] };
    const what = source === 'gcal' ? meta.calendars?.map((c) => c.summary) : meta.lists?.map((l) => l.title);
    const detail = `${label} connected${what?.length ? `: ${what.length} ${source === 'gcal' ? 'calendar' : 'list'}${what.length === 1 ? '' : 's'} (${what.join(', ')})` : ''}`;
    return { ok: true, source, detail };
  } finally {
    await running.stop();
  }
}

/**
 * The second way to notice success, behind the callback hook: the source row holds a credential this flow stored
 * (the callback always writes a fresh one, and the ciphertext never repeats) and reads `connected`. A row that was
 * connected before the flow, or a background sync finishing on it, does not count.
 */
async function pollConnected(ctx: Parameters<typeof getSourceRow>[0], source: GoogleConnectTarget, configBefore: string | null, budgetMs: number): Promise<GoogleConnectResult> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    const row = await getSourceRow(ctx, source);
    if (row.status === 'connected' && row.configEnc && row.configEnc !== configBefore) return { target: source, ok: true };
  }
  return new Promise<never>(() => {});
}
