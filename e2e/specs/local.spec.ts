import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { cli, cliOk, tmpDir } from '../helpers.js';

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

  test('sync <source> runs a source in-process; login and demo say what they need', () => {
    const out = cliOk(['sync', 'gradescope'], { home });
    expect(out).toMatch(/gradescope\s+disconnected/);
    expect(cli(['login'], { home }).stderr).toContain('local mode needs no sign-in');
    // The client-mode home (the other specs) refuses demo and sync <source>.
    expect(cli(['demo', 'canvas']).stderr).toContain('needs local mode');
    expect(cli(['sync', 'canvas']).stderr).toContain('local mode only');
  });

  test('demo clear takes the fixtures out again', () => {
    expect(cliOk(['demo', 'clear'], { home })).toMatch(/removed \d+ items?/);
    expect(JSON.parse(cliOk(['assignments', '--all', '--json'], { home }))).toEqual([]);
  });
});
