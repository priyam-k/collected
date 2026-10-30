import { spawn, spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { compareSemver, parseSemver } from '@collected/core/lib/changelog';

/*
 * `collected upgrade`: install the newest collected-cli with whatever installed this one. The installer is read off
 * the running script's path (process.argv[1], symlinks resolved), since that is the one fact about the install the
 * process has; when the path says nothing, the npm command is printed and nothing runs.
 */

export const PACKAGE = 'collected-cli';
export const REGISTRY_LATEST_URL = `https://registry.npmjs.org/${PACKAGE}/latest`;
export const REGISTRY_TIMEOUT_MS = 10_000;

export type InstallMethod = 'brew' | 'npm' | 'pnpm' | 'bun' | 'npx' | 'checkout' | 'unknown';

/**
 * How the running CLI was installed, from the path of its entry script (resolved). Order matters: a Homebrew keg, an
 * npx cache and a pnpm global store all contain `node_modules/collected-cli`, so they are recognised before the plain
 * npm layout.
 *   brew      <prefix>/Cellar/collected-cli/<version>/libexec/lib/node_modules/collected-cli/dist/cli.js, the prefix
 *             being /opt/homebrew, /usr/local or /home/linuxbrew/.linuxbrew (the tap priyam-k/collected)
 *   npx       ~/.npm/_npx/<hash>/node_modules/collected-cli/dist/cli.js
 *   pnpm      <pnpm home>/global/5/.pnpm/collected-cli@1.2.0/node_modules/collected-cli/dist/cli.js
 *   bun       ~/.bun/install/global/node_modules/collected-cli/dist/cli.js
 *   npm       <prefix>/lib/node_modules/collected-cli/dist/cli.js (also nvm, volta, fnm, Homebrew's node) or
 *             %APPDATA%\npm\node_modules\collected-cli\dist\cli.js on Windows
 *   checkout  <repo>/agent/dist/cli.js or <repo>/agent/src/cli.ts, outside any node_modules
 *   unknown   anything else, a project-local node_modules included
 */
export function detectInstallMethod(argv1: string): InstallMethod {
  const p = argv1.replace(/\\/g, '/');
  const ours = `/node_modules/${PACKAGE}/`;
  if (p.includes(`/Cellar/${PACKAGE}/`)) return 'brew';
  if (p.includes('/_npx/')) return 'npx';
  if (/\/pnpm\/global\//.test(p) && p.includes(ours)) return 'pnpm';
  if (/\/(\.bun|bun)\/install\/global\//.test(p) && p.includes(ours)) return 'bun';
  if ((p.includes(`/lib${ours}`) || p.includes(`/npm${ours}`)) && !p.includes(`/node_modules/.pnpm/`)) return 'npm';
  if (!p.includes('/node_modules/') && /\/agent\/(dist\/cli\.js|src\/cli\.ts)$/.test(p)) return 'checkout';
  return 'unknown';
}

/** The install command for a method, or null when there is no in-place upgrade to run. */
export function upgradeCommand(method: InstallMethod): { cmd: string; args: string[] } | null {
  switch (method) {
    case 'brew':
      return { cmd: 'brew', args: ['upgrade', PACKAGE] };
    case 'npm':
      return { cmd: 'npm', args: ['install', '-g', `${PACKAGE}@latest`] };
    case 'pnpm':
      return { cmd: 'pnpm', args: ['add', '-g', `${PACKAGE}@latest`] };
    case 'bun':
      return { cmd: 'bun', args: ['add', '-g', `${PACKAGE}@latest`] };
    default:
      return null;
  }
}

export const commandLine = (c: { cmd: string; args: string[] }): string => [c.cmd, ...c.args].join(' ');

/** What npm says `latest` is, or why it could not say. Never throws. */
export async function fetchNpmLatest(opts: { fetch?: typeof fetch; timeoutMs?: number } = {}): Promise<{ version: string | null; error?: string }> {
  const doFetch = opts.fetch ?? fetch;
  try {
    const res = await doFetch(REGISTRY_LATEST_URL, { headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(opts.timeoutMs ?? REGISTRY_TIMEOUT_MS) });
    if (!res.ok) return { version: null, error: `registry answered ${res.status}` };
    const body = (await res.json()) as { version?: unknown };
    const v = typeof body.version === 'string' ? body.version.trim() : '';
    return parseSemver(v) ? { version: v } : { version: null, error: 'registry answered without a version' };
  } catch (e) {
    return { version: null, error: e instanceof Error ? (e.name === 'TimeoutError' ? `no answer from the registry in ${(opts.timeoutMs ?? REGISTRY_TIMEOUT_MS) / 1000} s` : e.message) : String(e) };
  }
}

export interface UpgradeOptions {
  argv1: string;
  current: string;
  dryRun: boolean;
  verbose: boolean;
  say: (line: string) => void;
  warn: (line: string) => void;
  /** Resolves `argv1` through its symlinks (the global bin is one); tests pass identity. */
  realpath?: (p: string) => string;
  latest?: () => Promise<{ version: string | null; error?: string }>;
  /** Runs the install with inherited stdio and resolves to its exit code; tests fake it. */
  run?: (cmd: string, args: string[]) => Promise<number>;
  /** `<new binary> --version`, or null when no binary could be run; tests fake it. */
  newVersion?: () => string | null;
}

const realpathOr = (p: string): string => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};

function runInherited(cmd: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

/** The version of whatever `collected` is now: the one on PATH first (what the user will run), else the script we came from. */
export function installedVersion(argv1: string): string | null {
  const tries: [string, string[]][] = [[process.platform === 'win32' ? 'collected.cmd' : 'collected', ['--version']]];
  if (existsSync(argv1)) tries.push([process.execPath, [argv1, '--version']]);
  for (const [cmd, args] of tries) {
    try {
      const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'ignore'], shell: process.platform === 'win32' });
      const v = (r.stdout ?? '').trim();
      if (r.status === 0 && parseSemver(v)) return v;
    } catch {
      /* next */
    }
  }
  return null;
}

/** The command. Returns the exit code: 0 upgraded (or nothing to do, or --dry-run), 1 could not, the installer's code otherwise. */
export async function runUpgrade(o: UpgradeOptions): Promise<number> {
  const argv1 = (o.realpath ?? realpathOr)(o.argv1);
  const method = detectInstallMethod(argv1);
  const latest = await (o.latest ?? (() => fetchNpmLatest()))();
  if (latest.version) {
    const cmp = compareSemver(latest.version, o.current);
    if (cmp > 0) o.say(`collected-cli ${o.current} → ${latest.version} (the newest on npm)`);
    else if (cmp === 0) o.say(`collected-cli ${o.current} is the newest on npm`);
    else o.say(`collected-cli ${o.current} is newer than npm's ${latest.version}`);
    if (cmp <= 0 && !o.dryRun) return 0;
  } else if (o.verbose || o.dryRun) o.warn(`could not ask npm which version is newest (${latest.error ?? 'no answer'}); installing @latest anyway`);
  const command = upgradeCommand(method);
  if (!command) {
    const npm = commandLine(upgradeCommand('npm')!);
    if (method === 'checkout') o.say(`this is a checkout (${argv1}): git pull, then pnpm build:cli`);
    else if (method === 'npx') o.say(`this run came from the npx cache; npx fetches the newest when the cache is stale, or install it for good:\n  ${npm}`);
    else o.say(`could not tell how collected-cli was installed (${argv1}); for a global npm install run:\n  ${npm}`);
    return 1;
  }
  o.say(`${o.dryRun ? 'would run' : 'running'}: ${commandLine(command)}`);
  if (o.dryRun) return 0;
  const code = await (o.run ?? runInherited)(command.cmd, command.args);
  if (code !== 0) {
    o.warn(`${command.cmd} exited ${code}`);
    return code;
  }
  const v = (o.newVersion ?? (() => installedVersion(argv1)))();
  o.say(v ? `collected-cli ${v}` : 'done');
  return 0;
}
