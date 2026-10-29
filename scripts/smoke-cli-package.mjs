#!/usr/bin/env node
/*
 * Installs the CLI the way a user does and runs local mode end to end, so a package that cannot install or cannot
 * serve the dashboard never publishes (1.1.0 shipped uninstallable; this is the guard). Nothing here uses the
 * workspace: the tarball goes into a fresh `npm init -y` project outside the repo, dependencies come from the
 * registry, and the commands run from that project's node_modules/.bin with COLLECTED_AGENT_HOME in another temp dir.
 *
 *   node scripts/smoke-cli-package.mjs [path/to/collected-cli-<version>.tgz]
 *
 * Without an argument it packs agent/ itself (which must already be built: `pnpm build:cli`). Checks, in order:
 * `init --local`, `demo canvas`, `demo todoist`, `agenda --json` parses, `courses` lists the demo courses,
 * `ui --no-open --port <free>` answers /api/health, serves /dashboard as the SPA and one of its /assets/*.js files,
 * and stops on SIGINT; then `npx -y -p <tarball> collected help`. Prints the tarball and installed sizes at the end.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AGENT = path.join(ROOT, 'agent');
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const say = (s) => console.log(`[smoke] ${s}`);
const fail = (s) => {
  console.error(`[smoke] FAIL: ${s}`);
  process.exit(1);
};

function run(cmd, args, { cwd, env = process.env, what = `${cmd} ${args.join(' ')}`, allowFail = false } = {}) {
  const r = spawnSync(cmd, args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 300_000 });
  if (r.status !== 0 && !allowFail) fail(`${what} exited ${r.status}\n${r.stdout}\n${r.stderr}`);
  return r;
}

const dirSize = (dir) => {
  let total = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) continue;
    total += e.isDirectory() ? dirSize(p) : statSync(p).size;
  }
  return total;
};
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

const scratch = mkdtempSync(path.join(tmpdir(), 'collected-smoke-'));
const project = path.join(scratch, 'project');
const home = path.join(scratch, 'home');
process.on('exit', () => {
  if (!process.env.SMOKE_KEEP) rmSync(scratch, { recursive: true, force: true });
});

// 1. The tarball: the one given, or `npm pack` of agent/ into the scratch dir.
let tarball = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (!tarball) {
  const r = run(NPM, ['pack', '--json', '--pack-destination', scratch], { cwd: AGENT, what: 'npm pack' });
  tarball = path.join(scratch, JSON.parse(r.stdout)[0].filename);
}
const tarballSize = statSync(tarball).size;
say(`tarball ${path.basename(tarball)} (${mb(tarballSize)})`);

// 2. A real install into an empty project: dependency resolution from the registry, the workspace nowhere in sight.
mkdirSync(project, { recursive: true });
run(NPM, ['init', '-y'], { cwd: project, what: 'npm init' });
run(NPM, ['install', '--no-audit', '--no-fund', '--loglevel=error', tarball], { cwd: project, what: 'npm install <tarball>' });
const bin = path.join(project, 'node_modules', '.bin', process.platform === 'win32' ? 'collected.cmd' : 'collected');
const installed = dirSize(path.join(project, 'node_modules'));
say(`installed node_modules ${mb(installed)}`);

// 3. Local mode, with its home in another temp dir so nothing of this machine's ~/.collected is read or written.
const env = { ...process.env, COLLECTED_AGENT_HOME: home, NO_COLOR: '1' };
for (const k of ['MIGRATIONS_DIR', 'SEED_CONFIG_PATH', 'DATA_DIR']) delete env[k];
const cli = (args, what = `collected ${args.join(' ')}`) => run(bin, args, { cwd: scratch, env, what });

cli(['init', '--local']);
say('init --local ok');
const demo = cli(['demo', 'canvas']);
if (!/canvas/i.test(demo.stdout)) fail(`demo canvas printed nothing about canvas:\n${demo.stdout}`);
cli(['demo', 'todoist']);
say('demo canvas, demo todoist ok');

const agenda = cli(['agenda', '--json']);
let parsed;
try {
  parsed = JSON.parse(agenda.stdout);
} catch (e) {
  fail(`agenda --json is not JSON (${e.message}):\n${agenda.stdout.slice(0, 500)}`);
}
if (typeof parsed !== 'object' || parsed === null) fail('agenda --json parsed to a non-object');
say('agenda --json is valid JSON');

const courses = cli(['courses']);
if (!/CMSC|MATH|STAT/.test(courses.stdout)) fail(`courses lists no demo course:\n${courses.stdout}`);
say('courses lists the demo courses');

// 4. The dashboard: a loopback server on a free port, the SPA and one of its assets, a clean stop on SIGINT.
const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const ui = spawn(bin, ['ui', '--no-open', '--port', String(port)], { cwd: scratch, env, stdio: ['ignore', 'pipe', 'pipe'] });
let uiOut = '';
ui.stdout.on('data', (d) => (uiOut += d));
ui.stderr.on('data', (d) => (uiOut += d));
const deadline = Date.now() + 60_000;
let healthy = false;
while (Date.now() < deadline && !healthy) {
  if (ui.exitCode != null) fail(`ui exited early with ${ui.exitCode}:\n${uiOut}`);
  healthy = await fetch(`${base}/api/health`).then((r) => r.ok, () => false);
  if (!healthy) await new Promise((r) => setTimeout(r, 250));
}
if (!healthy) fail(`ui did not answer ${base}/api/health in 60 s:\n${uiOut}`);
say(`ui answers /api/health on ${base}`);

const page = await fetch(`${base}/dashboard`);
const html = await page.text();
if (!page.ok || !/<div id="root">/.test(html)) fail(`/dashboard is not the SPA (status ${page.status}):\n${html.slice(0, 300)}`);
const asset = html.match(/(?:src|href)="(\/assets\/[^"]+\.js)"/)?.[1];
if (!asset) fail(`no /assets/*.js in the dashboard HTML:\n${html.slice(0, 500)}`);
const js = await fetch(`${base}${asset}`);
if (!js.ok || !/javascript/.test(js.headers.get('content-type') ?? '')) fail(`${asset} answered ${js.status} ${js.headers.get('content-type')}`);
say(`/dashboard is the SPA and ${asset} loads (${js.headers.get('content-type')})`);

const exited = new Promise((resolve) => ui.once('exit', resolve));
ui.kill('SIGINT');
const code = await Promise.race([exited, new Promise((r) => setTimeout(() => r('timeout'), 15_000))]);
if (code !== 0) fail(`ui did not exit cleanly on SIGINT (${code}):\n${uiOut}`);
say('ui stopped on SIGINT');

// 5. The one-off invocation, from the tarball itself.
const npx = run(NPX, ['-y', '-p', tarball, 'collected', 'help'], { cwd: scratch, env: { ...env, npm_config_cache: path.join(scratch, 'npx-cache') }, what: 'npx -p <tarball> collected help' });
if (!/agenda/.test(npx.stdout)) fail(`npx help printed no usage:\n${npx.stdout}\n${npx.stderr}`);
say('npx -p <tarball> collected help ok');

say(`PASS · tarball ${mb(tarballSize)} · installed ${mb(installed)}`);
