import { parseArgs } from 'node:util';
import { Api } from './api.js';
import { HELP, isCollectedCommand, runCollected } from './collected.js';
import { configPath, defaultConfig, loadConfig, saveConfig, targetDir } from './config.js';
import { installLaunchd, uninstallLaunchd } from './launchd.js';
import { pullFile } from './pull.js';
import { loadState } from './state.js';
import { runSync } from './sync.js';

const [cmd, ...rest] = process.argv.slice(2);

function usage(): never {
  console.log(`${HELP}

  File sync (course files → folders on this machine)

    init <server-url>                         write ${configPath()} (device name, cache dir, model on)
    auth service-token <id> <secret> | auth helper-key <key> | auth model <typesafe-api-key>
    files courses                             what the server wants synced and where it lands here
    files link <course-id> <path>             root folder for a course;  files link <course-id> <target> <path>;  files unlink <course-id> [target]
    sync [--dry-run] [--course X] [--no-model]    run the file sync now
    status                                    last file sync and what has been placed
    install-launchd [--interval 30] | uninstall-launchd`);
  process.exit(cmd ? 1 : 0);
}

const say = (s: string) => console.log(s);

try {
  // `files <sub>` is the file sync's own namespace; `link <course-id> <path>` (the old spelling) still means a folder.
  let command = cmd;
  let argv = rest;
  if (cmd === 'files') {
    command = rest[0] === 'courses' ? 'files-courses' : rest[0] === 'link' ? 'files-link' : rest[0] === 'unlink' ? 'unlink' : rest[0];
    argv = rest.slice(1);
  } else if (cmd === 'link' && rest[0] !== 'add' && rest[0] !== 'rm') command = 'files-link';
  if (command === cmd && isCollectedCommand(cmd)) {
    say(await runCollected(new Api(loadConfig()), cmd, rest));
    process.exit(0);
  }
  switch (command) {
    case undefined:
    case 'help':
    case '--help':
      usage();
    // eslint-disable-next-line no-fallthrough
    case 'init': {
      const server = rest[0];
      if (!server) usage();
      const { values } = parseArgs({ args: rest.slice(1), options: { force: { type: 'boolean' }, device: { type: 'string' } } });
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
      saveConfig(cfg);
      say(`wrote ${configPath()}\nnext: collected auth service-token <id> <secret>   (or auth helper-key <key> for a local server)\n      collected auth model <typesafe-api-key>         (for the Jev classifier; skip to use rules only)\n      collected courses`);
      break;
    }
    case 'auth': {
      const cfg = loadConfig();
      if (rest[0] === 'service-token' && rest[1] && rest[2]) cfg.auth = { cfAccessClientId: rest[1], cfAccessClientSecret: rest[2] };
      else if (rest[0] === 'helper-key' && rest[1]) cfg.auth = { helperKey: rest[1] };
      else if (rest[0] === 'model' && rest[1]) cfg.model = { ...cfg.model, enabled: true, apiKey: rest[1] };
      else usage();
      saveConfig(cfg);
      say('saved');
      break;
    }
    case 'files-courses': {
      const cfg = loadConfig();
      const m = await new Api(cfg).getManifest();
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
      say(`server ${cfg.server} · device ${cfg.device} · model ${cfg.model.enabled ? 'on' : 'off'}\nlast run ${st.lastRunAt ?? 'never'} · ${n} file${n === 1 ? '' : 's'} placed`);
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
