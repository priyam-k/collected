import { Api } from './api.js';
import { isLocal, saveConfig, type AgentConfig } from './config.js';
import { openBrowser } from './open.js';

/*
 * `collected login`: sign this machine in to a server. The server's Settings → Account page mints a per-machine
 * token; the person pastes it at the prompt (never on the command line), it is proved with `GET /api/auth/me`, and
 * only then saved next to the edge credentials (an Access service token or helper key still gets the request past
 * Cloudflare Access; the Bearer token identifies the person to the app).
 */

export interface LoginOptions {
  say: (s: string) => void;
  /** The token typed at a prompt or piped on stdin; cli.ts passes its `readSecret`. */
  readSecret: (prompt: string) => Promise<string>;
  /** Injected in tests; the default opens the real browser. */
  open?: ((url: string) => void) | undefined;
  noOpen?: boolean | undefined;
}

/** Where the server shows the token for this device. */
export const loginUrl = (cfg: AgentConfig): string => `${cfg.server.replace(/\/$/, '')}/settings/account?cli=1&device=${encodeURIComponent(cfg.device)}`;

/** Runs the sign-in and returns the saved config; throws with the reason when the token is refused. */
export async function login(cfg: AgentConfig, opts: LoginOptions): Promise<AgentConfig> {
  if (isLocal(cfg)) throw new Error('local mode needs no sign-in: this command already owns the database.');
  const url = loginUrl(cfg);
  opts.say(`Sign in and create a token for this machine:\n  ${url}`);
  if (!opts.noOpen) (opts.open ?? openBrowser)(url);
  const token = await opts.readSecret('paste the token: ');
  if (!token.startsWith('clt_')) throw new Error('that does not look like a collected token (they start with clt_)');
  const trial = { ...cfg, auth: { ...cfg.auth, token } };
  const me = await new Api(trial).get<{ identity: string | null }>('/api/auth/me');
  if (!me.identity) throw new Error('the server did not accept that token; nothing saved');
  saveConfig(trial);
  opts.say(`signed in as ${me.identity}`);
  return trial;
}
