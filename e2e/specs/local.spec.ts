import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { AGENT_CLI } from '../env.js';
import { cli, cliOk, tmpDir } from '../helpers.js';

/** A port nothing listens on right now. */
const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });

/*
 * The built CLI in local mode: no server, no .env. `init --local` points it at a database under its own
 * COLLECTED_AGENT_HOME (a folder of this run's temp dir, not the one the other specs use), the demo loaders fill it
 * through the in-process app, and the reads answer from it. The e2e server is not contacted at all.
 */
test.describe.serial('collected CLI, local mode', () => {
  let home: string;
  test.beforeAll(() => {
    home = path.join(tmpDir(), 'local-home');
    mkdirSync(home, { recursive: true });
  });

  test('init --local writes the config and creates a private data directory', () => {
    const out = cliOk(['init', '--local', '--device', 'e2e-local'], { home });
    expect(out).toContain('local mode');
    const cfg = JSON.parse(readFileSync(path.join(home, 'agent.json'), 'utf8')) as { server: string; local: { dataDir: string } };
    expect(cfg.server).toBe('local');
    expect(cfg.local.dataDir).toBe(path.join(home, 'data'));
    expect(statSync(cfg.local.dataDir).mode & 0o777).toBe(0o700);
    expect(cliOk(['status'], { home })).toContain(`local · ${cfg.local.dataDir}`);
  });

  test('demo canvas and todoist load fixtures into the local database', () => {
    const out = cliOk(['demo', 'canvas'], { home });
    expect(out).toMatch(/canvas: .*assignments \d+/);
    expect(out).toContain('courses created from the fixture');
    expect(cliOk(['demo', 'todoist'], { home })).toMatch(/todoist: /);
    expect(existsSync(path.join(home, 'data', 'collected.db'))).toBe(true);
    expect(existsSync(path.join(home, 'data', '.secret_key'))).toBe(true);
  });

  test('courses --json and agenda --json read what was loaded', () => {
    const courses = JSON.parse(cliOk(['courses', '--json'], { home })) as { code: string; role: string }[];
    expect(courses.map((c) => c.code)).toEqual(expect.arrayContaining(['CMSC422', 'CMSC330', 'MATH423']));
    expect(courses.find((c) => c.code === 'CMSC330' && c.role === 'ta')).toBeTruthy();
    expect(cliOk(['courses'], { home })).toMatch(/CMSC422\s+student/);

    const agenda = JSON.parse(cliOk(['agenda', '--json'], { home })) as { title: string }[];
    expect(agenda.some((i) => i.title === 'Buy oat milk')).toBe(true);
    expect(cliOk(['agenda'], { home })).toContain('[task] Buy oat milk');
    // Logs stay off stdout: the JSON parsed above is the whole answer.
    const r = cli(['sources', '--json'], { home });
    expect(r.status).toBe(0);
    expect(() => JSON.parse(r.stdout)).not.toThrow();
  });

  test('a read syncs a stale connected source first and still answers when that fails; --stale-ok never syncs', () => {
    // demo todoist left the source `connected` a moment ago: not stale, so a plain read does not touch it.
    const quiet = cli(['agenda'], { home });
    expect(quiet.status).toBe(0);
    expect(quiet.stderr).toBe('');
    // --fresh syncs it regardless; the real ingester finds no token, which is reported on stderr, and the answer is what is there.
    const fresh = cli(['agenda', '--fresh'], { home });
    expect(fresh.status).toBe(0);
    expect(fresh.stderr).toContain('sync before answering failed for todoist');
    expect(fresh.stdout).toContain('[task] Buy oat milk');
    const sources = JSON.parse(cliOk(['sources', '--json'], { home })) as { id: string; status: string }[];
    expect(sources.find((s) => s.id === 'todoist')?.status).toBe('disconnected');
    // Now stale-or-not does not matter: nothing is connected, so nothing is synced, and --stale-ok is silent by construction.
    const stale = cli(['agenda', '--stale-ok', '--json'], { home });
    expect(stale.status).toBe(0);
    expect(stale.stderr).toBe('');
    expect(() => JSON.parse(stale.stdout)).not.toThrow();
  });

  test('ui serves the dashboard on the loopback, as the local person, and stops on SIGINT', async ({ page }) => {
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    let out = '';
    let child: ChildProcess | null = spawn(process.execPath, [AGENT_CLI, 'ui', '--no-open', '--port', String(port)], {
      env: { ...process.env, COLLECTED_AGENT_HOME: home, TZ: 'America/New_York' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout!.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr!.on('data', (d: Buffer) => (out += d.toString()));
    const exited = new Promise<number | null>((resolve) => child!.once('exit', (code) => resolve(code)));
    try {
      const deadline = Date.now() + 20_000;
      let up = false;
      while (!up && Date.now() < deadline) {
        if (child.exitCode != null) throw new Error(`ui exited early: ${out}`);
        up = await fetch(`${base}/api/health`).then((r) => r.ok, () => false);
        if (!up) await new Promise((r) => setTimeout(r, 200));
      }
      expect(up, out).toBe(true);
      expect(out).toContain(`collected is at ${base}`);

      const root = await fetch(`${base}/`, { redirect: 'manual' });
      expect(root.status).toBe(302);
      expect(root.headers.get('location')).toBe('/dashboard');
      const followed = await fetch(`${base}/`);
      expect(followed.status).toBe(200);
      expect(followed.url).toBe(`${base}/dashboard`);
      expect(await followed.text()).toContain('id="root"');

      const me = (await (await fetch(`${base}/api/auth/me`)).json()) as { identity: string; user: { email: string; name: string } | null };
      expect(me.identity).toBe('local');
      expect(me.user).toEqual(expect.objectContaining({ email: 'local@this-machine', name: 'This machine' }));

      // In the browser: no sign-in gate, the board renders, and the Account page reads as this machine's.
      await page.goto(`${base}/`);
      await expect(page).toHaveURL(`${base}/dashboard`);
      await expect(page.getByRole('heading', { name: /^Today,/ })).toBeVisible();
      await page.goto(`${base}/settings/account`);
      await expect(page.getByText('Running on this machine (collected ui)')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
    } finally {
      const t0 = Date.now();
      child.kill('SIGINT');
      const code = await Promise.race([exited, new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 5_000))]);
      if (code === 'timeout') child.kill('SIGKILL');
      expect(code, `ui did not exit within 5 s after SIGINT: ${out}`).not.toBe('timeout');
      expect(code).toBe(0);
      expect(Date.now() - t0).toBeLessThan(5_000);
      child = null;
    }
  });

  test('sync <source> runs a source in-process; login and demo say what they need', () => {
    const out = cliOk(['sync', 'gradescope'], { home });
    expect(out).toMatch(/gradescope\s+disconnected/);
    expect(cli(['login'], { home }).stderr).toContain('local mode needs no sign-in');
    // The client-mode home (the other specs) refuses demo and sync <source>.
    expect(cli(['demo', 'canvas']).stderr).toContain('needs local mode');
    expect(cli(['sync', 'canvas']).stderr).toContain('local mode only');
  });

  test('quickstart --agent prints the setup plan for an agent; quickstart itself wants a terminal', () => {
    const plan = cliOk(['quickstart', '--agent'], { home });
    expect(plan).toContain('https://raw.githubusercontent.com/priyam-k/collected/main/skills/collected/SKILL.md');
    expect(plan).toContain('`collected connect canvas`');
    expect(plan).toContain('`collected init --local`');
    expect(plan.split('\n').length).toBeLessThanOrEqual(60);
    const json = JSON.parse(cliOk(['quickstart', '--agent', '--json'], { home })) as { version: string; steps: { id: string; command: string }[] };
    expect(json.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(json.steps.map((s) => s.id)).toEqual(['where', 'canvas', 'courses', 'google', 'todoist', 'daemon', 'finish']);
    // stdin is a pipe here, not a terminal: the wizard refuses rather than taking every default unasked.
    const r = cli(['quickstart'], { home });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('collected quickstart --agent');
  });

  test('demo clear takes the fixtures out again', () => {
    expect(cliOk(['demo', 'clear'], { home })).toMatch(/removed \d+ items?/);
    expect(JSON.parse(cliOk(['assignments', '--all', '--json'], { home }))).toEqual([]);
  });
});
