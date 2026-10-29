import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { Api, openApi } from './api.js';
import { HELP, isCollectedCommand, runCollected } from './collected.js';
import { connectCanvas } from './connect.js';
import { LOCAL, configPath, defaultConfig, defaultLocalDataDir, isLocal, loadConfig, localDataDir, maxAgeMinutes, saveConfig, targetDir } from './config.js';
import { daemonStatus, describeStatus, installDaemon, uninstallDaemon } from './daemon.js';
import { READ_SOURCES, ensureFresh, takeFreshnessFlags } from './freshness.js';
import { assertSecureUrl } from './guard.js';
import { installLaunchd, uninstallLaunchd } from './launchd.js';
import { pullFile } from './pull.js';
import { loadState } from './state.js';
import { runSync } from './sync.js';

// `--verbose` anywhere raises the in-process app's log level in local mode (warnings only otherwise, on stderr).
// `--fresh` / `--stale-ok` anywhere decide whether a local-mode read syncs first (freshness.ts); a server keeps itself fresh.
const verbose = process.argv.includes('--verbose');
const { flags: freshness, rest: argvWords } = takeFreshnessFlags(process.argv.slice(2).filter((a) => a !== '--verbose'));
const [cmd, ...rest] = argvWords;
const DEMO_SOURCES = ['canvas', 'gradescope', 'gcal', 'todoist', 'gtasks'] as const;
const SYNC_SOURCES = ['canvas', 'canvas_ical', 'gradescope', 'gcal', 'gcal_ical', 'todoist', 'gtasks', 'jobs', 'all'];

function usage(): never {
  console.log(`${HELP}

  File sync (course files → folders on this machine)

    init <server-url>                         write ${configPath()} (device name, cache dir, model on); https, or http://localhost
    init --local [--data-dir <path>]          no server: run collected inside this command against a database on this machine
                                              (default ${defaultLocalDataDir()}); then: collected demo canvas, collected courses
    ui [--port 4848] [--no-open]              local mode: the dashboard at http://127.0.0.1:<port>, syncing in the background, until Ctrl-C
                                              (against a server: prints its address and opens it)
    daemon install | uninstall | status       local mode: a user timer that runs \`sync all\` every 15 minutes (config daemon.intervalMinutes)
    demo <canvas|gradescope|gcal|todoist|gtasks> | demo clear    local mode: load the fixture data into the local database, or remove it
    sync <source|all>                         local mode: run that source's sync now and wait (same as resync)
    --fresh | --stale-ok                      on any read, local mode: sync first regardless of age, or never sync first
                                              (default: sync a source whose last success is older than freshness.maxAgeMinutes, 30)
    auth service-token <id> [secret] | auth helper-key [key] | auth token [token] | auth model [typesafe-api-key]
                                              leave the secret off to be prompted for it (or pipe it in): it then stays out of shell history
    login                                     sign in: opens Settings → Account on the server, then paste the token here
    files courses                             what the server wants synced and where it lands here
    files link <course-id> <path>             root folder for a course;  files link <course-id> <target> <path>;  files unlink <course-id> [target]
    sync [--dry-run] [--course X] [--no-model]    run the file sync now
    status                                    last file sync and what has been placed
    install-launchd [--interval 30] | uninstall-launchd
    connect canvas [--browser X] [--domain host] [--dry-run]
                                              read the Canvas session cookie from your browser and send it to the server`);
  process.exit(cmd ? 1 : 0);
}

const say = (s: string) => console.log(s);

/** A secret typed at a prompt with echo off, or the whole of stdin when piped. Never an argv word. */
async function readSecret(prompt: string): Promise<string> {
  let value: string;
  if (process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: new Writable({ write: (_c, _e, cb) => cb() }), terminal: true });
    process.stderr.write(prompt);
    try {
      value = await rl.question('');
    } finally {
      rl.close();
      process.stderr.write('\n');
    }
  } else {
    value = '';
    for await (const chunk of process.stdin) value += chunk;
  }
  value = value.trim();
  if (!value) throw new Error('no secret given');
  return value;
}

try {
  // `files <sub>` is the file sync's own namespace; `link <course-id> <path>` (the old spelling) still means a folder.
  let command = cmd;
  let argv = rest;
  if (cmd === 'files') {
    command = rest[0] === 'courses' ? 'files-courses' : rest[0] === 'link' ? 'files-link' : rest[0] === 'unlink' ? 'unlink' : rest[0];
    argv = rest.slice(1);
  } else if (cmd === 'link' && rest[0] !== 'add' && rest[0] !== 'rm') command = 'files-link';
  const cfgOf = () => loadConfig();
  const apiFor = (cfg = cfgOf()) => openApi(cfg, { logLevel: verbose ? 'info' : 'warn' });
  // Local mode gives `sync` a second meaning: `sync <source|all>` is the source sync (`resync`), not the file sync.
  if (cmd === 'sync' && rest[0] && SYNC_SOURCES.includes(rest[0])) {
    const cfg = cfgOf();
    if (!isLocal(cfg)) throw new Error(`\`collected sync ${rest[0]}\` runs a source sync in local mode only; against a server use \`collected resync ${rest[0]}\` (the file sync is \`collected sync\` with no source)`);
    say(await runCollected(await apiFor(cfg), 'resync', rest));
    process.exit(0);
  }
  if (command === cmd && isCollectedCommand(cmd)) {
    const cfg = cfgOf();
    const api = await apiFor(cfg);
    if (isLocal(cfg) && cmd in READ_SOURCES) await ensureFresh(api, cmd, { maxAgeMinutes: maxAgeMinutes(cfg), flags: freshness, warn: (line) => console.error(line) });
    say(await runCollected(api, cmd, rest));
    process.exit(0);
  }
  switch (command) {
    case undefined:
    case 'help':
    case '--help':
      usage();
    // eslint-disable-next-line no-fallthrough
    case 'init': {
      const { values, positionals } = parseArgs({ args: rest, options: { force: { type: 'boolean' }, device: { type: 'string' }, local: { type: 'boolean' }, 'data-dir': { type: 'string' } }, allowPositionals: true });
      const server = values.local ? LOCAL : positionals[0];
      if (!server || (values.local && positionals[0])) usage();
      if (values['data-dir'] && !values.local) throw new Error('--data-dir goes with --local');
      assertSecureUrl(server, 'the server URL');
      let existing: ReturnType<typeof loadConfig> | null = null;
      try {
        existing = loadConfig();
      } catch {
        /* none yet */
      }
      if (existing && !values.force) {
        say(`config exists at ${configPath()}; pass --force to replace it`);
        process.exit(1);
      }
      const cfg = defaultConfig(server);
      if (values.device) cfg.device = values.device;
      if (values.local) {
        cfg.local = { dataDir: values['data-dir'] ? path.resolve(values['data-dir']) : defaultLocalDataDir() };
        mkdirSync(cfg.local.dataDir, { recursive: true, mode: 0o700 });
      }
      saveConfig(cfg);
      if (values.local) say(`wrote ${configPath()}\nlocal mode: data in ${cfg.local!.dataDir} (created on first command)\nnext: collected demo canvas              (fixture courses and assignments, to look around)\n      collected courses\n      collected auth model                 (prompts for the TypeSafe key, for the Jev classifier; skip to use rules only)`);
      else say(`wrote ${configPath()}\nnext: collected auth service-token <id>   (prompts for the secret; or auth helper-key for a local server)\n      collected auth model                 (prompts for the TypeSafe key, for the Jev classifier; skip to use rules only)\n      collected courses`);
      break;
    }
    case 'ui': {
      const { values } = parseArgs({ args: rest, options: { port: { type: 'string' }, 'no-open': { type: 'boolean' } } });
      const open = !values['no-open'];
      const cfg = cfgOf();
      if (!isLocal(cfg)) {
        say(`the dashboard is at ${cfg.server}`);
        if (open) (await import('./ui.js')).openBrowser(cfg.server);
        break;
      }
      const port = values.port === undefined ? (await import('./ui.js')).DEFAULT_UI_PORT : Number(values.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`--port needs a number from 1 to 65535, not "${values.port}"`);
      await (await import('./ui.js')).runUi(cfg, { port, open, logLevel: verbose ? 'info' : 'warn', say });
      break;
    }
    case 'daemon': {
      const cfg = cfgOf();
      if (!isLocal(cfg)) throw new Error('`collected daemon` keeps a local database fresh; a server runs its own scheduler. (The file sync has `install-launchd`.)');
      const what = rest[0];
      if (what === 'install') say(installDaemon(cfg));
      else if (what === 'uninstall') say(uninstallDaemon() ? 'removed' : 'nothing installed');
      else if (what === 'status') say(describeStatus(daemonStatus(cfg)));
      else usage();
      break;
    }
    case 'demo': {
      const cfg = cfgOf();
      if (!isLocal(cfg)) throw new Error('`collected demo` loads fixtures into a local database; it needs local mode (collected init --local). A server loads them with `pnpm cli demo <source>`.');
      const what = rest[0];
      const { LocalApi } = await import('./local.js');
      const api = await LocalApi.open(cfg, { logLevel: verbose ? 'info' : 'warn' });
      if (what === 'clear') {
        const r = await api.demoClear();
        say(`removed ${r.items} item${r.items === 1 ? '' : 's'} and ${r.content} content row${r.content === 1 ? '' : 's'} the demo loaders had created`);
        break;
      }
      if (!what || !(DEMO_SOURCES as readonly string[]).includes(what)) usage();
      const r = await api.demo(what as (typeof DEMO_SOURCES)[number]);
      const counts = Object.entries(r.counts).map(([k, v]) => `${k} ${v}`).join(', ');
      say(`${r.source}: ${counts || 'loaded'}${r.coursesCreated.length ? `\ncourses created from the fixture: ${r.coursesCreated.join(', ')}` : ''}\nremove with: collected demo clear`);
      break;
    }
    case 'auth': {
      const cfg = loadConfig();
      const [what, a, b] = rest;
      if (isLocal(cfg) && what !== 'model') throw new Error('local mode has no server credential: the database is on this machine. `collected auth model` still sets the classifier key.');
      if (what === 'service-token' && a) cfg.auth = { cfAccessClientId: a, cfAccessClientSecret: b ?? (await readSecret('service token secret: ')) };
      else if (what === 'helper-key') cfg.auth = { helperKey: a ?? (await readSecret('helper key: ')) };
      else if (what === 'token') cfg.auth = { ...cfg.auth, token: a ?? (await readSecret('token: ')) }; // keeps the edge credentials
      else if (what === 'model') cfg.model = { ...cfg.model, enabled: true, apiKey: a ?? (await readSecret('TypeSafe API key: ')) };
      else usage();
      saveConfig(cfg);
      say('saved');
      if ((what === 'service-token' && b) || (what !== 'service-token' && a)) console.error('note: a secret on the command line lands in shell history; next time leave it off and type it at the prompt');
      break;
    }
    case 'login': {
      const cfg = loadConfig();
      if (isLocal(cfg)) throw new Error('local mode needs no sign-in: this command already owns the database.');
      const url = `${cfg.server.replace(/\/$/, '')}/settings/account?cli=1&device=${encodeURIComponent(cfg.device)}`;
      say(`Sign in and create a token for this machine:\n  ${url}`);
      if (process.platform === 'darwin') spawnSync('open', [url], { stdio: 'ignore' });
      const token = await readSecret('paste the token: ');
      if (!token.startsWith('clt_')) {
        say('that does not look like a collected token (they start with clt_)');
        process.exit(1);
      }
      // Keep the edge credentials (Access service token or helper key): the Bearer token identifies the person to the app,
      // the service token still gets the request past Cloudflare Access.
      const trial = { ...cfg, auth: { ...cfg.auth, token } };
      const me = await new Api(trial).get<{ identity: string | null }>('/api/auth/me');
      if (!me.identity) {
        say('the server did not accept that token; nothing saved');
        process.exit(1);
      }
      saveConfig(trial);
      say(`signed in as ${me.identity}`);
      break;
    }
    case 'connect': {
      if (rest[0] !== 'canvas') usage();
      const { values } = parseArgs({ args: rest.slice(1), options: { browser: { type: 'string' }, domain: { type: 'string' }, 'dry-run': { type: 'boolean' } } });
      await connectCanvas(loadConfig(), { browser: values.browser, domain: values.domain, dryRun: values['dry-run'], log: say });
      break;
    }
    case 'files-courses': {
      const cfg = loadConfig();
      const m = await (await apiFor(cfg)).getManifest();
      if (!m.courses.length) say('no course has file sync enabled yet (turn it on in the course drawer → Files → Sync to laptop)');
      for (const c of m.courses) {
        const local = cfg.courses[c.course.id];
        say(`${c.course.code}  (${c.course.id})  ${c.files.length} files${local ? '' : '  ← not linked here'}`);
        const names = [...c.config.targets.map((t) => t.name), 'unsorted'];
        for (const n of names) say(`    ${n.padEnd(14)} ${targetDir(cfg, c.course.id, n) ?? '(no folder)'}`);
        const pending = c.files.filter((f) => !f.decision).length;
        if (pending) say(`    ${pending} file${pending === 1 ? '' : 's'} waiting for the model`);
      }
      break;
    }
    case 'files-link': {
      const cfg = loadConfig();
      const [course, a, b] = argv;
      if (!course || !a) usage();
      cfg.courses[course] ??= {};
      if (b) {
        cfg.courses[course].targets ??= {};
        cfg.courses[course].targets[a] = b;
        say(`${course}: ${a} → ${b}`);
      } else {
        cfg.courses[course].root = a;
        say(`${course}: root → ${a}  (targets become ${a}/<target>)`);
      }
      saveConfig(cfg);
      break;
    }
    case 'unlink': {
      const cfg = loadConfig();
      const [course, target] = argv;
      if (!course) usage();
      if (target) delete cfg.courses[course]?.targets?.[target];
      else delete cfg.courses[course];
      saveConfig(cfg);
      say('ok');
      break;
    }
    case 'sync': {
      const { values } = parseArgs({ args: argv, options: { 'dry-run': { type: 'boolean' }, course: { type: 'string' }, 'no-model': { type: 'boolean' } } });
      const cfg = loadConfig();
      const t0 = Date.now();
      const s = await runSync(cfg, { dryRun: values['dry-run'], course: values.course, noModel: values['no-model'], log: say });
      const parts = [`${s.placed} new`, `${s.updated} updated`, `${s.moved} moved`, `${s.adopted} adopted`, `${s.removed} removed`, `${s.unchanged} unchanged`, `${s.skipped} skipped`];
      if (s.pending) parts.push(`${s.pending} waiting for the model`);
      if (s.classified) parts.push(`${s.classified} classified`);
      say(`${values['dry-run'] ? 'dry run: ' : ''}${s.courses} course${s.courses === 1 ? '' : 's'}: ${parts.join(', ')}${s.errors.length ? `, ${s.errors.length} error${s.errors.length === 1 ? '' : 's'}` : ''} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      process.exit(s.errors.length ? 1 : 0);
    }
    // eslint-disable-next-line no-fallthrough
    case 'pull': {
      const { values, positionals } = parseArgs({ args: argv, options: { to: { type: 'string' }, course: { type: 'string' } }, allowPositionals: true });
      const fileId = positionals[0];
      if (!fileId || !values.to) usage();
      const r = await pullFile(loadConfig(), fileId, values.to, { course: values.course });
      say(JSON.stringify(r, null, 2));
      break;
    }
    case 'status': {
      const cfg = loadConfig();
      const st = loadState();
      const n = Object.keys(st.placements).length;
      say(`${isLocal(cfg) ? `local · ${localDataDir(cfg)}` : `server ${cfg.server}`} · device ${cfg.device} · model ${cfg.model.enabled ? 'on' : 'off'}\nlast run ${st.lastRunAt ?? 'never'} · ${n} file${n === 1 ? '' : 's'} placed`);
      const byCourse = new Map<string, number>();
      for (const p of Object.values(st.placements)) byCourse.set(p.courseId, (byCourse.get(p.courseId) ?? 0) + 1);
      for (const [c, k] of byCourse) say(`  ${c}: ${k}`);
      break;
    }
    case 'install-launchd': {
      const { values } = parseArgs({ args: argv, options: { interval: { type: 'string', default: '30' } } });
      const file = installLaunchd(Number(values.interval) || 30);
      say(`installed ${file}; log: ~/.collected/agent.log`);
      break;
    }
    case 'uninstall-launchd':
      say(uninstallLaunchd() ? 'removed' : 'nothing installed');
      break;
    default:
      usage();
  }
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
