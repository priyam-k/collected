import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { agentHome, daemonIntervalMinutes, isLocal, localDataDir, type AgentConfig } from './config.js';

/*
 * `collected daemon install|uninstall|status`: a user-level timer that runs bare `collected sync` every N minutes, which
 * is everything this machine is responsible for: in local mode every enabled source and then the course files, against
 * a server the course files alone (machine-sync.ts). macOS gets a LaunchAgent, Linux a systemd user timer, Windows the
 * schtasks line to run by hand. The unit calls this exact binary (the resolved argv[1] under the running node), so an
 * upgrade that moves the CLI means reinstalling. Nothing secret goes in: the credentials are in the database or in
 * agent.json, and the unit carries only paths.
 *
 * Before 1.3 the file sync had a timer of its own, `install-launchd` → `com.collected.agent` → bare `sync`, next to
 * this one. `install` and `uninstall` take that plist out when they find it, so no machine runs the file sync twice.
 */

export const DAEMON_LABEL = 'com.collected.sync';
/** The file-sync timer `install-launchd` wrote before the two were one. */
export const LEGACY_LABEL = 'com.collected.agent';
export const SYSTEMD_UNIT = 'collected-sync';
export const DAEMON_LOG = 'daemon.log';

export interface DaemonSpec {
  platform: NodeJS.Platform;
  /** The node binary (process.execPath). */
  node: string;
  /** The built CLI, absolute (dist/cli.js). */
  cli: string;
  intervalMinutes: number;
  /** Where the log goes: `<logDir>/daemon.log`: the data directory in local mode, the agent home against a server. */
  logDir: string;
  home: string;
  /** COLLECTED_AGENT_HOME when the shell had it set, so the timer reads the same agent.json. */
  agentHome?: string | undefined;
}

export interface DaemonFile {
  path: string;
  content: string;
}

export interface DaemonPlan {
  kind: 'launchd' | 'systemd' | 'schtasks';
  files: DaemonFile[];
  logFile: string;
  /** For schtasks: the command the person runs; the CLI prints it and does nothing else. */
  manual?: string;
}

const xml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** systemd's ExecStart quoting: double quotes around each word, backslashes and quotes escaped. */
const unitWord = (s: string): string => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

export const launchAgentsDir = (home: string): string => path.join(home, 'Library', 'LaunchAgents');
export const launchAgentPath = (home: string): string => path.join(launchAgentsDir(home), `${DAEMON_LABEL}.plist`);
export const legacyLaunchAgentPath = (home: string): string => path.join(launchAgentsDir(home), `${LEGACY_LABEL}.plist`);
export const systemdDir = (home: string): string => path.join(home, '.config', 'systemd', 'user');

/** Where the daemon logs for this config: next to the database in local mode, next to agent.json against a server. */
export const daemonLogDir = (cfg: AgentConfig): string => (isLocal(cfg) ? localDataDir(cfg) : agentHome());

/** The files (or the command) for a platform, from a spec: pure, so the texts can be checked without launchctl. */
export function daemonPlan(spec: DaemonSpec): DaemonPlan {
  const logFile = path.join(spec.logDir, DAEMON_LOG);
  const interval = Math.max(5, Math.round(spec.intervalMinutes));
  if (spec.platform === 'darwin') {
    const env = [
      ['PATH', `${spec.home}/.local/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin`],
      ['HOME', spec.home],
      ...(spec.agentHome ? [['COLLECTED_AGENT_HOME', spec.agentHome]] : []),
    ];
    const content = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${DAEMON_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(spec.node)}</string>
    <string>${xml(spec.cli)}</string>
    <string>sync</string>
  </array>
  <key>StartInterval</key><integer>${interval * 60}</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${xml(logFile)}</string>
  <key>StandardErrorPath</key><string>${xml(logFile)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${env.map(([k, v]) => `    <key>${k}</key><string>${xml(v!)}</string>`).join('\n')}
  </dict>
</dict>
</plist>
`;
    return { kind: 'launchd', files: [{ path: launchAgentPath(spec.home), content }], logFile };
  }
  if (spec.platform === 'win32') {
    const tr = `\\"${spec.node}\\" \\"${spec.cli}\\" sync`;
    return { kind: 'schtasks', files: [], logFile, manual: `schtasks /Create /F /SC MINUTE /MO ${interval} /TN collected-sync /TR "${tr}"` };
  }
  const dir = systemdDir(spec.home);
  const service = `[Unit]
Description=collected: sync the sources and the course files this machine keeps

[Service]
Type=oneshot
ExecStart=${unitWord(spec.node)} ${unitWord(spec.cli)} sync
${spec.agentHome ? `Environment=COLLECTED_AGENT_HOME=${spec.agentHome}\n` : ''}StandardOutput=append:${logFile}
StandardError=append:${logFile}
`;
  const timer = `[Unit]
Description=collected: run the sync every ${interval} minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=${interval}min
Persistent=true

[Install]
WantedBy=timers.target
`;
  return {
    kind: 'systemd',
    files: [
      { path: path.join(dir, `${SYSTEMD_UNIT}.service`), content: service },
      { path: path.join(dir, `${SYSTEMD_UNIT}.timer`), content: timer },
    ],
    logFile,
  };
}

/** The running CLI, resolved through the bin symlink; refuses the source tree, which has no `node` entry point to call. */
export function runningCli(): string {
  const arg = process.argv[1];
  if (!arg) throw new Error('cannot tell which binary is running');
  const cli = realpathSync(path.resolve(arg));
  if (!/\.[cm]?js$/.test(cli)) throw new Error(`the timer needs the built CLI, not ${cli}; run it as node agent/dist/cli.js (pnpm --filter collected-cli build) or from the npm install`);
  return cli;
}

export interface InstallOptions {
  /** `--interval N`; `daemon.intervalMinutes` in agent.json still wins over it. */
  interval?: number | undefined;
  env?: NodeJS.ProcessEnv;
}

export function specFor(cfg: AgentConfig, opts: InstallOptions = {}): DaemonSpec {
  return {
    platform: process.platform,
    node: process.execPath,
    cli: runningCli(),
    intervalMinutes: daemonIntervalMinutes(cfg, opts.interval),
    logDir: daemonLogDir(cfg),
    home: homedir(),
    agentHome: (opts.env ?? process.env).COLLECTED_AGENT_HOME || undefined,
  };
}

const run = (cmd: string, args: string[]) => spawnSync(cmd, args, { encoding: 'utf8' });
const uid = () => process.getuid?.() ?? 501;
const bootout = (file: string): void => void run('launchctl', ['bootout', `gui/${uid()}`, file]);

/**
 * Takes out the file-sync timer `install-launchd` wrote before 1.3 (`com.collected.agent`, running bare `sync` into
 * `~/.collected/agent.log`), so a machine never has it next to `com.collected.sync` running the same thing. Returns the
 * path removed, or null when there was none. A function over the directory: tests hand it a temp folder and a fake unload.
 */
export function removeLegacyLaunchAgent(dir: string, unload: (file: string) => void = bootout): string | null {
  const file = path.join(dir, `${LEGACY_LABEL}.plist`);
  if (!existsSync(file)) return null;
  unload(file);
  unlinkSync(file);
  return file;
}

/** What the timer does on this config, for the messages. */
const job = (cfg: AgentConfig): string => (isLocal(cfg) ? 'every enabled source, then the course files' : 'the course files (the server syncs its own sources)');

/** Writes the unit files and loads them. Returns what to tell the person. */
export function installDaemon(cfg: AgentConfig, opts: InstallOptions = {}): string {
  const plan = daemonPlan(specFor(cfg, opts));
  const every = daemonIntervalMinutes(cfg, opts.interval);
  const notes: string[] = [];
  if (opts.interval !== undefined && cfg.daemon?.intervalMinutes !== undefined && every !== Math.max(5, opts.interval)) notes.push(`note: daemon.intervalMinutes in agent.json is ${cfg.daemon.intervalMinutes}, so --interval ${opts.interval} is not used`);
  if (plan.kind === 'schtasks') return [...notes, `Windows: run this once in a terminal to sync every ${every} minutes (collected does not run it for you):\n  ${plan.manual}\nlog: the task's own history (schtasks /Query /TN collected-sync)`].join('\n');
  mkdirSync(path.dirname(plan.logFile), { recursive: true, mode: 0o700 });
  // The log names courses, assignment titles and placed paths; make it ours before launchd or systemd creates it world-readable.
  if (!existsSync(plan.logFile)) writeFileSync(plan.logFile, '', { mode: 0o600 });
  for (const f of plan.files) {
    mkdirSync(path.dirname(f.path), { recursive: true });
    writeFileSync(f.path, f.content, { mode: 0o644 });
  }
  if (plan.kind === 'launchd') {
    const legacy = removeLegacyLaunchAgent(launchAgentsDir(homedir()));
    if (legacy) notes.push(`removed the old file-sync timer ${legacy}: this one runs the file sync now`);
    const file = plan.files[0]!.path;
    bootout(file);
    let r = run('launchctl', ['bootstrap', `gui/${uid()}`, file]);
    if (r.status !== 0) r = run('launchctl', ['load', '-w', file]);
    if (r.status !== 0) throw new Error(`launchctl could not load ${file}: ${(r.stderr || r.stdout || '').trim()}`);
    return [...notes, `installed ${file}\ncollected sync runs every ${every} minutes while you are logged in: ${job(cfg)}; log: ${plan.logFile}`].join('\n');
  }
  let r = run('systemctl', ['--user', 'daemon-reload']);
  if (r.status === 0) r = run('systemctl', ['--user', 'enable', '--now', `${SYSTEMD_UNIT}.timer`]);
  if (r.status !== 0) throw new Error(`systemctl --user could not enable ${SYSTEMD_UNIT}.timer: ${(r.stderr || r.stdout || '').trim()}`);
  return [...notes, `installed ${plan.files.map((f) => f.path).join(' and ')}\ncollected sync runs every ${every} minutes: ${job(cfg)}; log: ${plan.logFile}`].join('\n');
}

/** Unloads and removes whatever `install` (or the old `install-launchd`) wrote; false when nothing was there. */
export function uninstallDaemon(): boolean {
  const home = homedir();
  if (process.platform === 'darwin') {
    const legacy = removeLegacyLaunchAgent(launchAgentsDir(home));
    const file = launchAgentPath(home);
    if (!existsSync(file)) return legacy !== null;
    bootout(file);
    unlinkSync(file);
    return true;
  }
  if (process.platform === 'win32') {
    console.log('Windows: schtasks /Delete /F /TN collected-sync');
    return false;
  }
  const dir = systemdDir(home);
  const files = [`${SYSTEMD_UNIT}.timer`, `${SYSTEMD_UNIT}.service`].map((f) => path.join(dir, f));
  if (!files.some(existsSync)) return false;
  run('systemctl', ['--user', 'disable', '--now', `${SYSTEMD_UNIT}.timer`]);
  for (const f of files) if (existsSync(f)) unlinkSync(f);
  run('systemctl', ['--user', 'daemon-reload']);
  return true;
}

export interface DaemonStatus {
  installed: boolean;
  files: string[];
  /** Loaded in launchd / active in systemd, when that could be asked. */
  loaded: boolean | null;
  logFile: string;
  /** When the log was last written to: the end of the last run. */
  lastRunAt: string | null;
  tail: string[];
}

export function daemonStatus(cfg: AgentConfig): DaemonStatus {
  const home = homedir();
  const logFile = path.join(daemonLogDir(cfg), DAEMON_LOG);
  let files: string[] = [];
  let loaded: boolean | null = null;
  if (process.platform === 'darwin') {
    files = [launchAgentPath(home)].filter(existsSync);
    if (files.length) loaded = run('launchctl', ['print', `gui/${uid()}/${DAEMON_LABEL}`]).status === 0;
  } else if (process.platform !== 'win32') {
    files = [`${SYSTEMD_UNIT}.timer`, `${SYSTEMD_UNIT}.service`].map((f) => path.join(systemdDir(home), f)).filter(existsSync);
    if (files.length) loaded = (run('systemctl', ['--user', 'is-active', `${SYSTEMD_UNIT}.timer`]).stdout ?? '').trim() === 'active';
  }
  return { installed: files.length > 0, files, loaded, logFile, ...readLog(logFile) };
}

export function readLog(logFile: string): { lastRunAt: string | null; tail: string[] } {
  try {
    const st = statSync(logFile);
    if (st.size === 0) return { lastRunAt: null, tail: [] };
    const lines = readFileSync(logFile, 'utf8').trimEnd().split('\n');
    return { lastRunAt: st.mtime.toISOString(), tail: lines.slice(-8) };
  } catch {
    return { lastRunAt: null, tail: [] };
  }
}

const loadedNote = (s: DaemonStatus): string => (s.loaded === null ? '' : s.loaded ? ' (loaded)' : ' (not loaded: run collected daemon install again)');

/** `collected daemon status`: the unit, the last run and the log's tail. */
export function describeStatus(s: DaemonStatus): string {
  const head = s.installed ? `installed: ${s.files.join(', ')}${loadedNote(s)}` : 'not installed (collected daemon install)';
  const last = s.lastRunAt ? `last run ${s.lastRunAt} (${s.logFile})` : `no run logged yet (${s.logFile})`;
  return [head, last, ...s.tail.map((l) => `  ${l}`)].join('\n');
}

/** The one line `collected status` shows for the timer. */
export function daemonLine(s: DaemonStatus): string {
  if (!s.installed) return 'daemon not installed (collected daemon install keeps this machine current)';
  return `daemon installed${loadedNote(s)} · last run ${s.lastRunAt ?? 'none logged yet'}`;
}
