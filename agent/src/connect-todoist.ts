import { openApi } from './api.js';
import { isLocal, type AgentConfig } from './config.js';

/*
 * `collected connect todoist`: store a Todoist API token (Todoist → Settings → Integrations → Developer) and run the
 * first sync. Local mode only: against a server the CLI's token may not write a source's config (identityAllows),
 * and a server with a Todoist app offers Sign in with Todoist, so the command says to use Settings → Sources there.
 * The token is typed at a prompt or piped on stdin, never an argv word, and never printed.
 */

export const TODOIST_TOKEN_HOWTO = 'Todoist → Settings → Integrations → Developer → API token';

export interface ConnectTodoistOptions {
  log: (s: string) => void;
  readSecret: () => Promise<string>;
  api?: Pick<Awaited<ReturnType<typeof openApi>>, 'send'>;
}

/** A token's shape, before any network: Todoist's are 40 hex characters; anything with spaces or punctuation is a paste gone wrong. */
export const looksLikeTodoistToken = (t: string): boolean => /^[A-Za-z0-9_-]{20,200}$/.test(t);

export function todoistElsewhere(cfg: AgentConfig): string {
  return `\`collected connect todoist\` stores the token in local mode only. On ${cfg.server.replace(/\/$/, '')}, open Settings → Sources → Todoist and paste it there (or Sign in with Todoist, when the server offers it).`;
}

export async function connectTodoist(cfg: AgentConfig, opts: ConnectTodoistOptions): Promise<{ saved: boolean; synced: boolean }> {
  if (!isLocal(cfg)) throw new Error(todoistElsewhere(cfg));
  opts.log(`Todoist API token (${TODOIST_TOKEN_HOWTO}).`);
  const token = (await opts.readSecret()).trim();
  if (!looksLikeTodoistToken(token)) throw new Error('that does not look like a Todoist API token (a long string of letters and digits); copy it whole from Todoist → Settings → Integrations → Developer');
  const api = opts.api ?? (await openApi(cfg));
  await api.send('PUT', '/api/sources/todoist/config', { token });
  opts.log('token saved.');
  type SyncOutcome = { ok?: boolean; result?: { counts?: unknown }; error?: unknown };
  const sync = await api.send<{ outcome?: SyncOutcome }>('POST', '/api/sources/todoist/sync').catch((err: Error): { outcome: SyncOutcome } => ({ outcome: { ok: false, error: err.message } }));
  const outcome: SyncOutcome = sync.outcome ?? {};
  if (outcome.ok) opts.log(`Todoist synced: ${JSON.stringify(outcome.result?.counts ?? {})}`);
  else opts.log(`the first sync did not succeed: ${JSON.stringify(outcome.error ?? outcome)} (collected sources shows the status)`);
  return { saved: true, synced: !!outcome.ok };
}
