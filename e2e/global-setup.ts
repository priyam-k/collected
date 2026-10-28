import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, openSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AGENT_CLI, BASE_URL, PORT, ROOT, SEED_CONFIG, WEB_DIST } from './env.js';

/*
 * Boots one real server against a throwaway database with every external source replaced by fixtures:
 *   1. temp DATA_DIR + env (auth off, scheduler off, a helper key for the CLI, the e2e seed file)
 *   2. web/dist (built once when missing) and agent/dist (always rebuilt: tsup takes well under a second)
 *   3. `cli demo canvas|gradescope|gcal|todoist|gtasks` loads the fixture clients / mock APIs into that database
 *   4. `tsx src/index.ts` on PORT, wait for /api/health
 * Everything the specs need is handed over through process.env (Playwright copies it into the workers).
 */

const SERVER_DIR = path.join(ROOT, 'server');
const TSX = path.join(SERVER_DIR, 'node_modules', '.bin', 'tsx');
const PNPM = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

let server: ChildProcess | null = null;

function run(cmd: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv; what: string }): string {
  const r = spawnSync(cmd, args, { cwd: opts.cwd, env: opts.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.status !== 0) throw new Error(`${opts.what} failed (exit ${r.status})\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}

async function waitForHealth(url: string, log: string, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (server?.exitCode != null) throw new Error(`server exited with ${server.exitCode} before answering; see ${log}`);
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`server did not answer ${url} within ${ms} ms; see ${log}`);
}

export default async function globalSetup(): Promise<void> {
  const tmp = mkdtempSync(path.join(tmpdir(), 'collected-e2e-'));
  const dataDir = path.join(tmp, 'data');
  mkdirSync(dataDir);
  const helperKey = randomBytes(32).toString('hex');

  // Nothing from a developer's shell may leak in: these are the ones the server reads besides the ones set below.
  const inherited = { ...process.env };
  for (const k of ['CF_ACCESS_TEAM_DOMAIN', 'CF_ACCESS_AUD', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'SECRET_KEY', 'MIGRATIONS_DIR', 'AUTH_DISABLED_ACKNOWLEDGED']) delete inherited[k];
  const env: NodeJS.ProcessEnv = {
    ...inherited,
    NODE_ENV: 'development',
    PORT: String(PORT),
    PUBLIC_URL: BASE_URL,
    DATA_DIR: dataDir,
    AUTH_DISABLED: 'true',
    SCHEDULER_DISABLED: 'true',
    SEED_CONFIG_PATH: SEED_CONFIG,
    WEB_DIST,
    LOCAL_HELPER_KEY: helperKey,
    LOG_LEVEL: process.env.E2E_SERVER_LOG_LEVEL ?? 'warn',
    TZ: 'America/New_York',
  };

  // Already listening? Another stream (or a previous run that did not tear down) owns the port.
  const busy = await fetch(`${BASE_URL}/api/health`).then((r) => r.ok, () => false);
  if (busy) throw new Error(`${BASE_URL} already answers; stop that server or set E2E_PORT to another port`);

  if (!existsSync(path.join(WEB_DIST, 'index.html')) || process.env.E2E_REBUILD) {
    console.log('[e2e] building web/dist');
    // A production bundle, like the one the Docker image serves: NODE_ENV=development (set above for the server) would
    // make Vite ship React's development build, whose StrictMode double effects do not happen in production.
    run(PNPM, ['--filter', 'web', 'exec', 'vite', 'build'], { cwd: ROOT, env: { ...env, NODE_ENV: 'production' }, what: 'vite build' });
  }
  console.log('[e2e] building agent/dist');
  run(PNPM, ['--filter', 'collected-cli', 'build'], { cwd: ROOT, env, what: 'agent build' });
  if (!existsSync(AGENT_CLI)) throw new Error(`agent build produced no ${AGENT_CLI}`);

  for (const source of ['canvas', 'gradescope', 'gcal', 'todoist', 'gtasks']) {
    console.log(`[e2e] loading demo ${source}`);
    run(TSX, ['src/cli.ts', 'demo', source], { cwd: SERVER_DIR, env, what: `cli demo ${source}` });
  }

  const log = path.join(tmp, 'server.log');
  const fd = openSync(log, 'a');
  server = spawn(TSX, ['src/index.ts'], { cwd: SERVER_DIR, env, stdio: ['ignore', fd, fd] });
  await waitForHealth(`${BASE_URL}/api/health`, log, 60_000);
  console.log(`[e2e] server up on ${BASE_URL} (data ${dataDir}, log ${log})`);

  writeFileSync(path.join(tmp, 'state.json'), JSON.stringify({ pid: server.pid, port: PORT }));
  process.env.E2E_TMP = tmp;
  process.env.E2E_DATA_DIR = dataDir;
  process.env.E2E_HELPER_KEY = helperKey;
  process.env.E2E_SERVER_PID = String(server.pid);
  process.env.E2E_SERVER_LOG = log;
}
