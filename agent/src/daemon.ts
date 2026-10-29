import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { daemonIntervalMinutes, localDataDir, type AgentConfig } from './config.js';

/*
 * `collected daemon install|uninstall|status`: a user-level timer that runs `collected sync all` every N minutes so the
 * local database stays fresh without `collected ui` open. macOS gets a LaunchAgent, Linux a systemd user timer, Windows
 * the schtasks line to run by hand. The unit calls this exact binary (the resolved argv[1] under the running node), so
 * an upgrade that moves the CLI means reinstalling. Nothing secret goes in: the credentials are in the database, the
 * data directory is in agent.json, and the unit carries only paths.
 */

export const DAEMON_LABEL = 'com.collected.sync';
export const SYSTEMD_UNIT = 'collected-sync';
export const DAEMON_LOG = 'daemon.log';

export interface DaemonSpec {
  platform: NodeJS.Platform;
  /** The node binary (process.execPath). */
  node: string;
  /** The built CLI, absolute (dist/cli.js). */
  cli: string;
  intervalMinutes: number;
  /** Where the log goes: `<dataDir>/daemon.log`. */
  dataDir: string;
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

export const launchAgentPath = (home: string): string => path.join(home, 'Library', 'LaunchAgents', `${DAEMON_LABEL}.plist`);
export const systemdDir = (home: string): string => path.join(home, '.config', 'systemd', 'user');

/** The files (or the command) for a platform, from a spec: pure, so the texts can be checked without launchctl. */
export function daemonPlan(spec: DaemonSpec): DaemonPlan {
  const logFile = path.join(spec.dataDir, DAEMON_LOG);
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
    <string>all</string>
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
    const tr = `\\"${spec.node}\\" \\"${spec.cli}\\" sync all`;
    return { kind: 'schtasks', files: [], logFile, manual: `schtasks /Create /F /SC MINUTE /MO ${interval} /TN collected-sync /TR "${tr}"` };
  }
  const dir = systemdDir(spec.home);
  const service = `[Unit]
Description=collected: sync every source into the local database

[Service]
Type=oneshot
ExecStart=${unitWord(spec.node)} ${unitWord(spec.cli)} sync all
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

export function specFor(cfg: AgentConfig, env: NodeJS.ProcessEnv = process.env): DaemonSpec {
  return {
    platform: process.platform,
    node: process.execPath,
    cli: runningCli(),
    intervalMinutes: daemonIntervalMinutes(cfg),
    dataDir: localDataDir(cfg),
    home: homedir(),
    agentHome: env.COLLECTED_AGENT_HOME || undefined,
  };
}

const run = (cmd: string, args: string[]) => spawnSync(cmd, args, { encoding: 'utf8' });
const uid = () => process.getuid?.() ?? 501;

/** Writes the unit files and loads them. Returns what to tell the person. */
export function installDaemon(cfg: AgentConfig): string {
  const plan = daemonPlan(specFor(cfg));
  if (plan.kind === 'schtasks') return `Windows: run this once in a terminal to sync every ${daemonIntervalMinutes(cfg)} minutes (collected does not run it for you):\n  ${plan.manual}\nlog: the task's own history (schtasks /Query /TN collected-sync)`;
  mkdirSync(path.dirname(plan.logFile), { recursive: true, mode: 0o700 });
  // The log names courses and assignment titles; make it ours before launchd or systemd creates it world-readable.
  if (!existsSync(plan.logFile)) writeFileSync(plan.logFile, '', { mode: 0o600 });
  for (const f of plan.files) {
    mkdirSync(path.dirname(f.path), { recursive: true });
    writeFileSync(f.path, f.content, { mode: 0o644 });
  }
  if (plan.kind === 'launchd') {
    const file = plan.files[0]!.path;
    run('launchctl', ['bootout', `gui/${uid()}`, file]);
    let r = run('launchctl', ['bootstrap', `gui/${uid()}`, file]);
    if (r.status !== 0) r = run('launchctl', ['load', '-w', file]);
    if (r.status !== 0) throw new Error(`launchctl could not load ${file}: ${(r.stderr || r.stdout || '').trim()}`);
    return `installed ${file}\nsync all runs every ${daemonIntervalMinutes(cfg)} minutes while you are logged in; log: ${plan.logFile}`;
  }
  let r = run('systemctl', ['--user', 'daemon-reload']);
  if (r.status === 0) r = run('systemctl', ['--user', 'enable', '--now', `${SYSTEMD_UNIT}.timer`]);
  if (r.status !== 0) throw new Error(`systemctl --user could not enable ${SYSTEMD_UNIT}.timer: ${(r.stderr || r.stdout || '').trim()}`);
  return `installed ${plan.files.map((f) => f.path).join(' and ')}\nsync all runs every ${daemonIntervalMinutes(cfg)} minutes; log: ${plan.logFile}`;
}

/** Unloads and removes whatever `install` wrote; false when nothing was there. */
export function uninstallDaemon(): boolean {
  const home = homedir();
  if (process.platform === 'darwin') {
    const file = launchAgentPath(home);
    if (!existsSync(file)) return false;
    run('launchctl', ['bootout', `gui/${uid()}`, file]);
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
  const dataDir = localDataDir(cfg);
  const logFile = path.join(dataDir, DAEMON_LOG);
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

export function describeStatus(s: DaemonStatus): string {
  const head = s.installed ? `installed: ${s.files.join(', ')}${s.loaded === null ? '' : s.loaded ? ' (loaded)' : ' (not loaded: run collected daemon install again)'}` : 'not installed (collected daemon install)';
  const last = s.lastRunAt ? `last run ${s.lastRunAt} (${s.logFile})` : `no run logged yet (${s.logFile})`;
  return [head, last, ...s.tail.map((l) => `  ${l}`)].join('\n');
}
