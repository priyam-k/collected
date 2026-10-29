import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DAEMON_LABEL, daemonPlan, describeStatus, readLog, type DaemonSpec } from './daemon.js';

const spec = (over: Partial<DaemonSpec> = {}): DaemonSpec => ({
  platform: 'darwin',
  node: '/opt/homebrew/bin/node',
  cli: '/Users/me/.npm-global/lib/node_modules/collected-cli/dist/cli.js',
  intervalMinutes: 15,
  dataDir: '/Users/me/.collected/data',
  home: '/Users/me',
  ...over,
});

describe('daemonPlan', () => {
  it('macOS: a LaunchAgent plist calling the running binary, logging to the data dir, no secrets', () => {
    const plan = daemonPlan(spec({ agentHome: '/Users/me/alt<home>' }));
    expect(plan.kind).toBe('launchd');
    expect(plan.files).toHaveLength(1);
    const [f] = plan.files;
    expect(f!.path).toBe(`/Users/me/Library/LaunchAgents/${DAEMON_LABEL}.plist`);
    expect(f!.content).toContain(`<key>Label</key><string>${DAEMON_LABEL}</string>`);
    expect(f!.content).toContain('<string>/opt/homebrew/bin/node</string>\n    <string>/Users/me/.npm-global/lib/node_modules/collected-cli/dist/cli.js</string>\n    <string>sync</string>\n    <string>all</string>');
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

  it('Linux: a systemd user service and timer', () => {
    const plan = daemonPlan(spec({ platform: 'linux', node: '/usr/bin/node', cli: '/home/me/.local/lib/node_modules/collected-cli/dist/cli.js', dataDir: '/home/me/.collected/data', home: '/home/me', intervalMinutes: 20 }));
    expect(plan.kind).toBe('systemd');
    expect(plan.files.map((f) => f.path)).toEqual(['/home/me/.config/systemd/user/collected-sync.service', '/home/me/.config/systemd/user/collected-sync.timer']);
    const [service, timer] = plan.files;
    expect(service!.content).toContain('Type=oneshot');
    expect(service!.content).toContain('ExecStart="/usr/bin/node" "/home/me/.local/lib/node_modules/collected-cli/dist/cli.js" sync all');
    expect(service!.content).toContain('StandardOutput=append:/home/me/.collected/data/daemon.log');
    expect(service!.content).not.toContain('Environment=');
    expect(timer!.content).toContain('OnUnitActiveSec=20min');
    expect(timer!.content).toContain('Persistent=true');
    expect(timer!.content).toContain('WantedBy=timers.target');
  });

  it('Windows: nothing is written; the schtasks line is handed back', () => {
    const plan = daemonPlan(spec({ platform: 'win32', node: 'C:\\Program Files\\nodejs\\node.exe', cli: 'C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\collected-cli\\dist\\cli.js' }));
    expect(plan.kind).toBe('schtasks');
    expect(plan.files).toEqual([]);
    expect(plan.manual).toBe('schtasks /Create /F /SC MINUTE /MO 15 /TN collected-sync /TR "\\"C:\\Program Files\\nodejs\\node.exe\\" \\"C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\collected-cli\\dist\\cli.js\\" sync all"');
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
    const text = describeStatus({ installed: true, files: ['/x/plist'], loaded: true, logFile: log, ...r });
    expect(text).toContain('installed: /x/plist (loaded)');
    expect(text).toContain(`last run ${when.toISOString()}`);
    expect(describeStatus({ installed: false, files: [], loaded: null, logFile: log, lastRunAt: null, tail: [] })).toContain('not installed');
  });
});
