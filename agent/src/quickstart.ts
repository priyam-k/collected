import { createInterface } from 'node:readline/promises';
import type { Source } from '@collected/shared';
import { openApi, type CollectedApi } from './api.js';
import { runCollected } from './collected.js';
import { configPath, daemonIntervalMinutes, existingConfig, initConfig, isLocal, localDataDir, type AgentConfig } from './config.js';
import { connectCanvas } from './connect.js';
import { connectTodoist, todoistElsewhere } from './connect-todoist.js';
import type { ConnectGoogleOutcome, GoogleTarget } from './connect-google.js';
import { daemonStatus, installDaemon, type DaemonStatus } from './daemon.js';
import { defaultSelection, describeImport, enrollmentTable, importEnrollments, listEnrollments, pickEnrollments } from './enroll.js';
import { assertSecureUrl } from './guard.js';
import { login } from './login.js';
import { QUICKSTART_STEPS, type QuickstartStep, type QuickstartStepId } from './quickstart-plan.js';

/*
 * `collected quickstart`: the setup as a conversation at the terminal. Every step is one of QUICKSTART_STEPS
 * (quickstart-plan.ts): its sentence is said, the step is done or skipped, and the next one comes. Re-running is
 * safe: a step whose work exists (a config, a connected source, an installed timer) says so and moves on. A step
 * that fails prints the error and the wizard continues; only the first step (there is no config to work with) ends
 * it. `--yes` takes every default without asking, which is how the tests drive it; without a terminal and without
 * `--yes` the command refuses, since a wizard reading EOF would silently take every default.
 */

export interface QuickstartIo {
  say: (s: string) => void;
  /** One line typed at a prompt; `def` when the person presses Enter. */
  ask: (question: string, def: string) => Promise<string>;
  /** A secret typed with echo off; cli.ts passes its `readSecret`. */
  readSecret: (prompt: string) => Promise<string>;
}

export interface QuickstartOptions {
  io: QuickstartIo;
  /** Take every default without prompting. */
  yes?: boolean | undefined;
  logLevel?: string | undefined;
  verbose?: boolean | undefined;
  /** The step runners, injectable so tests never read a browser, open Google, write a LaunchAgent or serve a port. */
  canvas?: (cfg: AgentConfig, log: (s: string) => void) => Promise<unknown>;
  google?: (cfg: AgentConfig, target: GoogleTarget, log: (s: string) => void) => Promise<ConnectGoogleOutcome>;
  daemon?: { status: (cfg: AgentConfig) => DaemonStatus; install: (cfg: AgentConfig) => string };
  ui?: (cfg: AgentConfig) => Promise<void>;
  openBrowser?: (url: string) => void;
}

const SKIP = new Set(['s', 'skip']);
const yes = (a: string): boolean => /^y(es)?$/i.test(a.trim());

/** The readline-backed prompts for a real terminal. */
export function terminalIo(readSecret: QuickstartIo['readSecret'], say: (s: string) => void = console.log): QuickstartIo {
  return {
    say,
    async ask(question, def) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        const a = (await rl.question(`${question} `)).trim();
        return a === '' ? def : a;
      } finally {
        rl.close();
      }
    },
    readSecret,
  };
}

const step = (id: QuickstartStepId): QuickstartStep => QUICKSTART_STEPS.find((s) => s.id === id)!;

/** Printed by step 1's third choice: enough to get a server up, then come back and pick 2. */
export const SERVER_SETUP_STEPS = `
  Setting up a collected server (full guide: https://github.com/priyam-k/collected/blob/main/docs/self-host.md)

  You need: a Linux box that stays on (1 GB RAM is plenty) with Docker Compose v2, a domain pointed at it,
  and a Google Cloud project for sign-in (the guide has the clicks).

    git clone https://github.com/priyam-k/collected.git /srv/collected && cd /srv/collected
    cp .env.example .env            # set PUBLIC_URL, SECRET_KEY, GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
    docker compose pull             # ghcr.io/priyam-k/collected:latest
    docker compose up -d
    docker compose logs -f app      # wait for "listening"

  Put TLS in front (Caddy, or a Cloudflare Tunnel; both in the guide), open https://your.domain and sign in
  with Google: the first account to sign in owns the instance. Then run collected quickstart again here and
  choose 2 with that URL.
`.replace(/^\n/, '');

export async function runQuickstart(opts: QuickstartOptions): Promise<number> {
  const { io } = opts;
  const say = io.say;
  const ask = async (question: string, def: string): Promise<string> => {
    if (!opts.yes) return io.ask(question, def);
    say(`${question} ${def || '(skipped)'}`);
    return def;
  };
  /** A yes/no question; Enter and `s` give the default. */
  const confirm = async (question: string, def: boolean): Promise<boolean> => {
    const a = await ask(`${question} [${def ? 'Y/n' : 'y/N'}]`, def ? 'y' : 'n');
    return SKIP.has(a.toLowerCase()) ? def : yes(a);
  };
  let n = 0;
  const begin = (id: QuickstartStepId): void => {
    const s = step(id);
    n += 1;
    say(`\n${n}. ${s.title}. ${s.why}`);
  };
  const failed = (e: unknown): void => say(`  ${(e as Error).message}\n  moving on; run collected quickstart again to retry this step.`);

  say('collected quickstart: a few steps, each explained first. Enter takes the default, s skips a step, Ctrl-C leaves; run it again any time.');

  // A config that already exists is settled before the numbered step, so the step reads as one question.
  let cfg: AgentConfig | null = null;
  const existing = existingConfig();
  if (existing) {
    say(`config exists at ${configPath()}: ${isLocal(existing) ? `local · data in ${localDataDir(existing)}` : `server ${existing.server}${existing.auth.token ? ' (signed in)' : ''}`}`);
    if (await confirm('Keep it?', true)) cfg = existing;
  }

  // 1. Where: the config.
  begin('where');
  try {
    if (cfg) say('  using the config above');
    if (!cfg) {
      say('    1  this computer: everything runs here, data in ~/.collected, nothing to host');
      say('    2  a collected server you already run: this machine becomes a client of it');
      say('    3  help me set up a server: prints the steps and stops here');
      const a = (await ask('  Choose 1, 2 or 3 [1]', '1')).trim();
      if (SKIP.has(a.toLowerCase())) throw new Error('nothing to set up without a config');
      if (a === '' || a === '1' || a.toLowerCase() === 'local') {
        cfg = initConfig('local', { local: true });
        say(`  wrote ${configPath()}; data in ${localDataDir(cfg)}`);
      } else if (a === '3' || /^help/i.test(a)) {
        say(SERVER_SETUP_STEPS);
        return 0;
      } else if (a === '2' || /^https?:\/\//.test(a) || /\./.test(a)) {
        const raw = a === '2' ? (await ask('  Server URL (https://…)', '')).trim() : a;
        if (!raw) throw new Error('no server URL given');
        const server = /^https?:\/\//.test(raw) ? raw : `https://${raw}`;
        assertSecureUrl(server, 'the server URL');
        cfg = initConfig(server);
        say(`  wrote ${configPath()} for ${server}`);
        cfg = await login(cfg, { say: (s) => say(`  ${s}`), readSecret: io.readSecret, open: opts.openBrowser });
      } else {
        throw new Error(`"${a}" is not one of 1, 2 or 3`);
      }
    }
  } catch (e) {
    say(`  ${(e as Error).message}\n  quickstart needs a config to go on: collected init --local, or collected init <url> then collected login.`);
    return 1;
  }
  const local = isLocal(cfg);
  // The wizard narrates each step itself; the ingesters' own warnings would land mid-sentence, so they stay at error unless --verbose.
  const api: CollectedApi = await openApi(cfg, { logLevel: opts.logLevel ?? (opts.verbose ? 'info' : 'error'), verbose: opts.verbose });
  const sources = async (): Promise<Map<string, Source>> => new Map((await api.get<Source[]>('/api/sources')).map((s) => [s.id, s]));
  const connected = async (id: string): Promise<Source | null> => {
    const s = (await sources()).get(id);
    return s?.status === 'connected' ? s : null;
  };

  // 2. Canvas.
  begin('canvas');
  let canvasOk = false;
  try {
    const have = await connected('canvas');
    if (have) {
      say(`  Canvas is connected (last synced ${have.lastSuccessAt ?? 'never'}); skipping.`);
      canvasOk = true;
    } else if (await confirm('  Read the cookie from your browser now?', true)) {
      await (opts.canvas ?? ((c, log) => connectCanvas(c, { log })))(cfg, (s) => say(`  ${s}`));
      canvasOk = !!(await connected('canvas'));
    }
  } catch (e) {
    say(`  ${(e as Error).message.split('\n')[0]}`);
    say(`  ${step('canvas').fallback}`);
    say('  moving on; run collected quickstart or collected connect canvas again once that is done.');
  }

  // 3. Courses.
  begin('courses');
  try {
    const have = await api.get<{ archived: boolean }[]>('/api/courses');
    const live = have.filter((c) => !c.archived).length;
    if (live) say(`  ${live} course${live === 1 ? '' : 's'} already set up; skipping (collected courses import --list shows what else Canvas has).`);
    else if (!canvasOk) say('  skipped: Canvas is not connected yet; collected courses import does this once it is.');
    else {
      const list = await listEnrollments(api);
      if (!list.length) say('  Canvas reports no active enrollments; nothing to import.');
      else {
        const picked = defaultSelection(list);
        say(enrollmentTable(list, new Set(picked.map((e) => e.canvasCourseId))).replace(/^/gm, '  '));
        const a = await ask(`  Import the ${picked.length} marked (*)? [Enter = yes, or row numbers like 1,3-4, s to skip]`, 'y');
        const picks = SKIP.has(a.toLowerCase()) ? [] : yes(a) ? picked : pickEnrollments(list, [a]).filter((e) => !e.trackedAs);
        if (!picks.length) say('  nothing imported.');
        else {
          const r = await importEnrollments(api, picks);
          say(`  ${describeImport(r).replace(/\n/g, '\n  ')}`);
          if (r.created.length && local) {
            const sync = await api.send<{ outcome: { ok: boolean; result?: { counts?: unknown }; error?: string } }>('POST', '/api/sources/canvas/sync');
            say(sync.outcome.ok ? `  Canvas synced: ${JSON.stringify(sync.outcome.result?.counts ?? {})}` : `  the Canvas sync did not succeed: ${sync.outcome.error ?? '?'}`);
          }
        }
      }
    }
  } catch (e) {
    failed(e);
  }

  // 4. Google.
  begin('google');
  if (!local) say(`  against a server the sign-in has to end where the server's redirect URI points: open ${cfg.server.replace(/\/$/, '')}/settings/sources and click Connect there.`);
  else {
    for (const [target, id, label] of [
      ['calendar', 'gcal', 'Google Calendar'],
      ['tasks', 'gtasks', 'Google Tasks'],
    ] as const) {
      try {
        const have = await connected(id);
        if (have) {
          say(`  ${label} is connected; skipping.`);
          continue;
        }
        if (!(await confirm(`  Connect ${label}? (opens your browser once)`, false))) continue;
        const run = opts.google ?? (async (c, t, log) => (await import('./connect-google.js')).connectGoogle(c, { target: t, log, logLevel: opts.logLevel, verbose: opts.verbose }));
        const r = await run(cfg, target, (s) => say(`  ${s}`));
        say(`  ${r.detail}`);
      } catch (e) {
        failed(e);
      }
    }
  }

  // 5. Todoist.
  begin('todoist');
  try {
    const row = (await sources()).get('todoist');
    if (row?.status === 'connected') say('  Todoist is connected; skipping.');
    else if (!local) say(`  ${todoistElsewhere(cfg)}`);
    else if (row?.oauthAvailable) say('  this build has a Todoist app: use Sign in with Todoist under Settings → Sources in collected ui (a pasted token works there too).');
    else if (opts.yes) say('  Paste a Todoist API token (Todoist → Settings → Integrations → Developer)? Enter to skip. (skipped)');
    else {
      say('  Paste a Todoist API token (Todoist → Settings → Integrations → Developer)? Enter to skip.');
      let token = '';
      try {
        token = await io.readSecret('  token: ');
      } catch {
        token = '';
      }
      if (!token || SKIP.has(token.toLowerCase())) say('  skipped.');
      else await connectTodoist(cfg, { log: (s) => say(`  ${s}`), readSecret: async () => token, api });
    }
  } catch (e) {
    failed(e);
  }

  // 6. Keep it current.
  begin('daemon');
  try {
    const d = opts.daemon ?? { status: (c) => daemonStatus(c), install: (c) => installDaemon(c) };
    const st = d.status(cfg);
    if (st.installed) say(`  ${st.unit} is installed (log: ${st.logFile}); skipping.`);
    else {
      const every = daemonIntervalMinutes(cfg);
      say(`  a user timer runs \`collected sync\` every ${every} minutes: ${local ? 'every enabled source, then the course files' : 'the course files (the server syncs its own sources)'}; log at ${st.logFile}.`);
      if (await confirm('  Install it?', false)) say(`  ${d.install(cfg).replace(/\n/g, '\n  ')}`);
      else say('  skipped; collected daemon install does it later.');
    }
  } catch (e) {
    failed(e);
  }

  // 7. See it.
  begin('finish');
  try {
    say('  collected agenda --days 3:');
    say((await runCollected(api, 'agenda', ['--days', '3'])).replace(/^/gm, '    '));
  } catch (e) {
    failed(e);
  }
  say(`\nDone. The three you will use most:\n  collected agenda          the next week by day\n  collected todo            open tasks and assignments\n  collected ui              the dashboard${local ? ' at http://127.0.0.1:4848' : ` (${cfg.server})`}\ncollected help for the rest.`);
  if (local && (await confirm('\nOpen the dashboard now? (runs until Ctrl-C)', false))) {
    await (opts.ui ?? (async (c) => (await import('./ui.js')).runUi(c, { port: (await import('./ui.js')).DEFAULT_UI_PORT, open: true, logLevel: opts.logLevel, verbose: opts.verbose, say })))(cfg);
  }
  return 0;
}
