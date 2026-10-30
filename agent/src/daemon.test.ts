import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { daemonIntervalMinutes, defaultConfig, type AgentConfig } from './config.js';
import { DAEMON_LABEL, LEGACY_LABEL, SYSTEMD_UNIT, daemonLine, daemonLogDir, daemonNames, daemonPlan, describeStatus, readLog, removeLegacyLaunchAgent, type DaemonSpec, type DaemonStatus } from './daemon.js';

const spec = (over: Partial<DaemonSpec> = {}): DaemonSpec => ({
  platform: 'darwin',
  node: '/opt/homebrew/bin/node',
  cli: '/Users/me/.npm-global/lib/node_modules/collected-cli/dist/cli.js',
  intervalMinutes: 15,
  logDir: '/Users/me/.collected/data',
  home: '/Users/me',
  ...over,
});

const localCfg = (daemon?: AgentConfig['daemon']): AgentConfig => ({ ...defaultConfig('local'), local: { dataDir: '/Users/me/.collected/data' }, ...(daemon ? { daemon } : {}) });
const clientCfg = (daemon?: AgentConfig['daemon']): AgentConfig => ({ ...defaultConfig('https://collected.example.com'), ...(daemon ? { daemon } : {}) });

describe('daemonNames', () => {
  it('the default home keeps the bare names, however it is spelled', () => {
    const bare = { label: 'com.collected.sync', unit: 'collected-sync', task: 'collected-sync', isDefault: true };
    expect(daemonNames('/Users/me/.collected', '/Users/me')).toEqual(bare);
    expect(daemonNames('/Users/me/.collected/', '/Users/me')).toEqual(bare);
    expect(daemonNames('/Users/me/x/../.collected', '/Users/me')).toEqual(bare);
    expect(daemonNames('~/.collected', homedir())).toEqual(bare);
    expect(daemonNames(path.join(homedir(), '.collected'))).toEqual(bare);
    expect(DAEMON_LABEL).toBe('com.collected.sync');
    expect(SYSTEMD_UNIT).toBe('collected-sync');
  });

  it('another home gets a suffix hashed from its resolved path: stable, and different for different homes', () => {
    const trial = daemonNames('/Users/me/.collected-trial', '/Users/me');
    expect(trial.isDefault).toBe(false);
    expect(trial.label).toMatch(/^com\.collected\.sync\.[0-9a-f]{8}$/);
    expect(trial.unit).toMatch(/^collected-sync-[0-9a-f]{8}$/);
    expect(trial.task).toBe(trial.unit);
    expect(trial.label.slice(-8)).toBe(trial.unit.slice(-8));
    expect(daemonNames('/Users/me/.collected-trial', '/Users/me')).toEqual(trial);
    expect(daemonNames('/Users/me/.collected-trial/', '/Users/me')).toEqual(trial);
    const other = daemonNames('/Users/me/.collected-other', '/Users/me');
    expect(other.label).not.toBe(trial.label);
    expect(other.unit).not.toBe(trial.unit);
    // The same path is another person's default: the hash depends on the home, not on who asks.
    expect(daemonNames('/Users/me/.collected', '/Users/you').isDefault).toBe(false);
  });
});

describe('daemonPlan', () => {
  it('macOS: a LaunchAgent plist calling the running binary with bare `sync`, logging to the data dir, no secrets', () => {
    const plan = daemonPlan(spec({ agentHome: '/Users/me/alt<home>' }));
    const names = daemonNames('/Users/me/alt<home>', '/Users/me');
    expect(plan.kind).toBe('launchd');
    expect(plan.names).toEqual(names);
    expect(plan.files).toHaveLength(1);
    const [f] = plan.files;
    expect(f!.path).toBe(`/Users/me/Library/LaunchAgents/${names.label}.plist`);
    expect(f!.content).toContain(`<key>Label</key><string>${names.label}</string>`);
    expect(names.label).not.toBe(DAEMON_LABEL);
    expect(f!.content).toContain('<string>/opt/homebrew/bin/node</string>\n    <string>/Users/me/.npm-global/lib/node_modules/collected-cli/dist/cli.js</string>\n    <string>sync</string>\n  </array>');
    expect(f!.content).not.toContain('<string>all</string>');
    expect(f!.content).toContain('<key>StartInterval</key><integer>900</integer>');
    expect(f!.content).toContain('<key>StandardOutPath</key><string>/Users/me/.collected/data/daemon.log</string>');
    expect(f!.content).toContain('<key>COLLECTED_AGENT_HOME</key><string>/Users/me/alt&lt;home&gt;</string>');
    expect(plan.logFile).toBe('/Users/me/.collected/data/daemon.log');
    expect(f!.content).not.toMatch(/token|secret|key_|password/i);
  });

  it('macOS: the interval never goes under five minutes; no COLLECTED_AGENT_HOME unless the shell had one', () => {
    const plan = daemonPlan(spec({ intervalMinutes: 1 }));
    expect(plan.files[0]!.content).toContain('<integer>300</integer>');
    expect(plan.files[0]!.content).not.toContain('COLLECTED_AGENT_HOME');
  });

  it('the default home, bare or spelled out, writes the unsuffixed plist existing installs have', () => {
    for (const s of [spec(), spec({ agentHome: '/Users/me/.collected' })]) {
      const plan = daemonPlan(s);
      expect(plan.names.isDefault).toBe(true);
      expect(plan.files[0]!.path).toBe('/Users/me/Library/LaunchAgents/com.collected.sync.plist');
      expect(plan.files[0]!.content).toContain('<key>Label</key><string>com.collected.sync</string>');
    }
  });

  it('two homes get two timers: a second COLLECTED_AGENT_HOME never lands on the default plist', () => {
    const a = daemonPlan(spec());
    const b = daemonPlan(spec({ agentHome: '/Users/me/.collected-trial' }));
    expect(b.files[0]!.path).not.toBe(a.files[0]!.path);
    expect(b.files[0]!.path).toBe(`/Users/me/Library/LaunchAgents/${b.names.label}.plist`);
    expect(b.files[0]!.content).toContain(`<key>Label</key><string>${b.names.label}</string>`);
    expect(b.files[0]!.content).toContain('<key>COLLECTED_AGENT_HOME</key><string>/Users/me/.collected-trial</string>');
  });

  it('client mode: the same unit, bare `sync`, every 30 minutes by default, logging next to agent.json', () => {
    const cfg = clientCfg();
    expect(daemonIntervalMinutes(cfg)).toBe(30);
    expect(daemonLogDir(cfg)).toBe(path.join(process.env.COLLECTED_AGENT_HOME ?? path.join(process.env.HOME ?? '', '.collected')));
    const plan = daemonPlan(spec({ intervalMinutes: daemonIntervalMinutes(cfg), logDir: '/Users/me/.collected' }));
    expect(plan.files[0]!.path).toBe(`/Users/me/Library/LaunchAgents/${DAEMON_LABEL}.plist`);
    expect(plan.files[0]!.content).toContain('<string>sync</string>\n  </array>');
    expect(plan.files[0]!.content).toContain('<key>StartInterval</key><integer>1800</integer>');
    expect(plan.logFile).toBe('/Users/me/.collected/daemon.log');
  });

  it('the interval: agent.json wins, then --interval, then 15 in local mode and 30 against a server, never under 5', () => {
    expect(daemonIntervalMinutes(localCfg())).toBe(15);
    expect(daemonIntervalMinutes(clientCfg())).toBe(30);
    expect(daemonIntervalMinutes(localCfg(), 45)).toBe(45);
    expect(daemonIntervalMinutes(clientCfg(), 10)).toBe(10);
    expect(daemonIntervalMinutes(localCfg({ intervalMinutes: 20 }), 45)).toBe(20);
    expect(daemonIntervalMinutes(clientCfg({ intervalMinutes: 60 }))).toBe(60);
    expect(daemonIntervalMinutes(clientCfg(), 1)).toBe(5);
    expect(daemonLogDir(localCfg())).toBe('/Users/me/.collected/data');
  });

  it('Linux: a systemd user service and timer', () => {
    const plan = daemonPlan(spec({ platform: 'linux', node: '/usr/bin/node', cli: '/home/me/.local/lib/node_modules/collected-cli/dist/cli.js', logDir: '/home/me/.collected/data', home: '/home/me', intervalMinutes: 20 }));
    expect(plan.kind).toBe('systemd');
    expect(plan.names.unit).toBe(SYSTEMD_UNIT);
    expect(plan.files.map((f) => f.path)).toEqual(['/home/me/.config/systemd/user/collected-sync.service', '/home/me/.config/systemd/user/collected-sync.timer']);
    const [service, timer] = plan.files;
    expect(service!.content).toContain('Type=oneshot');
    expect(service!.content).toContain('ExecStart="/usr/bin/node" "/home/me/.local/lib/node_modules/collected-cli/dist/cli.js" sync\n');
    expect(service!.content).toContain('StandardOutput=append:/home/me/.collected/data/daemon.log');
    expect(service!.content).not.toContain('Environment=');
    expect(timer!.content).toContain('OnUnitActiveSec=20min');
    expect(timer!.content).toContain('Persistent=true');
    expect(timer!.content).toContain('WantedBy=timers.target');
  });

  it('Linux: a second home gets its own service and timer, named with the hash', () => {
    const plan = daemonPlan(spec({ platform: 'linux', node: '/usr/bin/node', cli: '/home/me/cli.js', logDir: '/home/me/.collected-trial/data', home: '/home/me', agentHome: '/home/me/.collected-trial' }));
    const names = daemonNames('/home/me/.collected-trial', '/home/me');
    expect(names.isDefault).toBe(false);
    expect(plan.files.map((f) => f.path)).toEqual([`/home/me/.config/systemd/user/${names.unit}.service`, `/home/me/.config/systemd/user/${names.unit}.timer`]);
    expect(plan.files[0]!.content).toContain('Environment=COLLECTED_AGENT_HOME=/home/me/.collected-trial\n');
  });

  it('Windows: nothing is written; the schtasks line is handed back', () => {
    const plan = daemonPlan(spec({ platform: 'win32', node: 'C:\\Program Files\\nodejs\\node.exe', cli: 'C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\collected-cli\\dist\\cli.js' }));
    expect(plan.kind).toBe('schtasks');
    expect(plan.files).toEqual([]);
    expect(plan.manual).toBe('schtasks /Create /F /SC MINUTE /MO 15 /TN collected-sync /TR "\\"C:\\Program Files\\nodejs\\node.exe\\" \\"C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\collected-cli\\dist\\cli.js\\" sync"');
    const trial = daemonPlan(spec({ platform: 'win32', node: 'C:\\node.exe', cli: 'C:\\cli.js', agentHome: 'C:\\Users\\me\\.collected-trial' }));
    expect(trial.manual).toContain(`/TN ${trial.names.task} /TR`);
    expect(trial.names.task).toMatch(/^collected-sync-[0-9a-f]{8}$/);
  });
});

describe('the legacy file-sync timer', () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('is unloaded and deleted when install finds com.collected.agent.plist, and nothing happens without it', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'collected-launchagents-'));
    const unloaded: string[] = [];
    const unload = (file: string) => unloaded.push(file);
    expect(removeLegacyLaunchAgent(dir, unload)).toBeNull();
    expect(unloaded).toEqual([]);

    const legacy = path.join(dir, `${LEGACY_LABEL}.plist`);
    const ours = path.join(dir, `${DAEMON_LABEL}.plist`);
    writeFileSync(legacy, '<plist/>');
    writeFileSync(ours, '<plist/>');
    expect(removeLegacyLaunchAgent(dir, unload)).toBe(legacy);
    expect(unloaded).toEqual([legacy]);
    expect(existsSync(legacy)).toBe(false);
    expect(existsSync(ours)).toBe(true);
    // Idempotent: a second install finds nothing to migrate.
    expect(removeLegacyLaunchAgent(dir, unload)).toBeNull();
    expect(unloaded).toEqual([legacy]);
  });

  it('a home without a LaunchAgents folder (Linux) is left alone', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'collected-home-'));
    const missing = path.join(dir, 'Library', 'LaunchAgents');
    expect(removeLegacyLaunchAgent(missing, () => { throw new Error('must not unload'); })).toBeNull();
    expect(existsSync(missing)).toBe(false);
    mkdirSync(missing, { recursive: true });
    expect(removeLegacyLaunchAgent(missing, () => { throw new Error('must not unload'); })).toBeNull();
  });
});

describe('status from the log', () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('reads the last run time from the log mtime and shows its tail', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'collected-daemon-'));
    const log = path.join(dir, 'daemon.log');
    expect(readLog(log)).toEqual({ lastRunAt: null, tail: [] });
    writeFileSync(log, Array.from({ length: 12 }, (_, i) => `line ${i}`).join('\n') + '\n');
    const when = new Date('2026-10-29T08:00:00Z');
    utimesSync(log, when, when);
    const r = readLog(log);
    expect(r.lastRunAt).toBe(when.toISOString());
    expect(r.tail).toEqual(['line 4', 'line 5', 'line 6', 'line 7', 'line 8', 'line 9', 'line 10', 'line 11']);
    const installed: DaemonStatus = { unit: 'com.collected.sync', installed: true, files: ['/x/plist'], loaded: true, logFile: log, ...r };
    const text = describeStatus(installed);
    expect(text).toContain('com.collected.sync installed: /x/plist (loaded)');
    expect(text).toContain(`last run ${when.toISOString()}`);
    const none: DaemonStatus = { unit: 'collected-sync.timer', installed: false, files: [], loaded: null, logFile: log, lastRunAt: null, tail: [] };
    expect(describeStatus(none)).toContain('collected-sync.timer not installed');
    // The one line `collected status` prints, in both modes.
    expect(daemonLine(installed)).toBe(`daemon installed (loaded) · last run ${when.toISOString()}`);
    expect(daemonLine({ ...installed, loaded: false, lastRunAt: null })).toBe('daemon installed (not loaded: run collected daemon install again) · last run none logged yet');
    expect(daemonLine(none)).toBe('daemon not installed (collected daemon install keeps this machine current)');
  });
});
