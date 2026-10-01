import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { agentHome } from './config.js';

export const LABEL = 'com.collected.agent';
const plistPath = (): string => path.join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** Runs `collected-agent sync` every N minutes while you're logged in. Needs the built CLI (dist/cli.js). */
export function installLaunchd(intervalMinutes: number): string {
  const cli = fileURLToPath(import.meta.url).replace(/[\\/][^\\/]+$/, '/cli.js');
  if (!existsSync(cli) || cli.endsWith('.ts')) throw new Error(`built CLI not found at ${cli}; run: pnpm --filter agent build`);
  const logFile = path.join(agentHome(), 'agent.log');
  mkdirSync(agentHome(), { recursive: true });
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${esc(process.execPath)}</string>
    <string>${esc(cli)}</string>
    <string>sync</string>
  </array>
  <key>StartInterval</key><integer>${Math.max(5, intervalMinutes) * 60}</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${esc(logFile)}</string>
  <key>StandardErrorPath</key><string>${esc(logFile)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
    <key>HOME</key><string>${esc(homedir())}</string>
  </dict>
</dict>
</plist>
`;
  const file = plistPath();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, plist);
  const uid = process.getuid?.() ?? 501;
  spawnSync('launchctl', ['bootout', `gui/${uid}`, file], { stdio: 'ignore' });
  const r = spawnSync('launchctl', ['bootstrap', `gui/${uid}`, file], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`launchctl bootstrap failed: ${r.stderr || r.stdout}`);
  return file;
}

export function uninstallLaunchd(): boolean {
  const file = plistPath();
  if (!existsSync(file)) return false;
  const uid = process.getuid?.() ?? 501;
  spawnSync('launchctl', ['bootout', `gui/${uid}`, file], { stdio: 'ignore' });
  unlinkSync(file);
  return true;
}
