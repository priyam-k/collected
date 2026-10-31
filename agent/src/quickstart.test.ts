import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CanvasEnrollment } from '@collected/shared';
import { currentTerm, defaultSelection, enrollmentTable, importBody, pickEnrollments, termRank } from './enroll.js';
import { LocalApi } from './local.js';
import { loadConfig } from './config.js';
import { QUICKSTART_STEPS, SKILL_URL, agentPlan, agentPlanJson } from './quickstart-plan.js';
import { runQuickstart, type QuickstartIo } from './quickstart.js';

/*
 * The step list is data shared by the wizard and the agent plan; the plan is checked for every command and the skill
 * URL; the wizard runs with `--yes` against a throwaway home, where Canvas fails fast through a fake, nothing opens a
 * browser or writes a timer, and the second run reports what the first did.
 */

describe('quickstart steps and the agent plan', () => {
  it('lists the seven steps in order, each with a sentence and a command', () => {
    expect(QUICKSTART_STEPS.map((s) => s.id)).toEqual(['where', 'canvas', 'courses', 'google', 'todoist', 'daemon', 'finish']);
    for (const s of QUICKSTART_STEPS) {
      expect(s.why.length).toBeGreaterThan(20);
      expect(s.command.startsWith('collected ')).toBe(true);
      expect(s.command).not.toContain('`');
    }
  });

  it('--agent prints every command, the skill URL, the rules, and stays under 60 lines', () => {
    const plan = agentPlan('9.9.9');
    expect(plan).toContain('collected-cli 9.9.9');
    expect(plan).toContain(SKILL_URL);
    expect(plan).toContain('~/.claude/skills/collected/SKILL.md');
    for (const s of QUICKSTART_STEPS) expect(plan).toContain(`\`${s.command}\``);
    for (const c of ['collected init --local', 'collected connect canvas', 'collected courses import', 'collected connect google calendar', 'collected connect google tasks', 'collected connect todoist', 'collected daemon install', 'collected agenda --days 3']) expect(plan).toContain(c);
    expect(plan).toContain('canvas_session');
    expect(plan).toContain('connect canvas --token');
    expect(plan).toMatch(/never ask the user to paste secrets into chat/i);
    expect(plan).toMatch(/do not run `collected ui` unless asked/i);
    expect(plan.split('\n').length).toBeLessThanOrEqual(60);
  });

  it('--agent --json carries the version, the skill location and the same steps', () => {
    const j = agentPlanJson('1.2.3');
    expect(j.version).toBe('1.2.3');
    expect(j.skill.url).toBe(SKILL_URL);
    expect(j.steps.map((s) => s.id)).toEqual(QUICKSTART_STEPS.map((s) => s.id));
    expect(j.steps.every((s) => s.id && s.title && s.command)).toBe(true);
    expect(j.steps.find((s) => s.id === 'canvas')?.fallback).toContain('Settings → Sources → Canvas');
  });
});

const enr = (id: string, term: string, trackedAs: string | null = null, role: 'student' | 'ta' = 'student'): CanvasEnrollment => ({
  canvasCourseId: id,
  name: `Course ${id}`,
  courseCode: `C${id}`,
  termName: term,
  role,
  trackedAs,
  suggested: { term, code: `CMSC${id}`, section: null },
});

describe('enrollments → courses', () => {
  const list = [enr('1', '2026-fall'), enr('2', '2026-spring'), enr('3', '2026-fall', '2026-fall-cmsc3'), enr('4', 'term'), enr('5', '2026-fall', null, 'ta')];

  it('ranks terms by year then season and picks the newest as current', () => {
    expect(termRank('2026-fall')).toBeGreaterThan(termRank('2026-spring'));
    expect(termRank('2027-spring')).toBeGreaterThan(termRank('2026-winter'));
    expect(termRank('term')).toBe(-1);
    expect(currentTerm(list)).toBe('2026-fall');
    expect(currentTerm([enr('9', 'term')])).toBeNull();
  });

  it('selects the current term\'s untracked enrollments by default, everything untracked when no term is dated', () => {
    expect(defaultSelection(list).map((e) => e.canvasCourseId)).toEqual(['1', '5']);
    expect(defaultSelection([enr('8', 'term'), enr('9', 'x', 'here')]).map((e) => e.canvasCourseId)).toEqual(['8']);
  });

  it('picks by row number, range or Canvas id, and names what matched nothing', () => {
    expect(pickEnrollments(list, ['1,3-4']).map((e) => e.canvasCourseId)).toEqual(['1', '3', '4']);
    expect(pickEnrollments(list, ['5', '1']).map((e) => e.canvasCourseId)).toEqual(['5', '1']);
    expect(() => pickEnrollments(list, ['7'])).toThrow(/"7" is neither a row number \(1-5\) nor a Canvas course id/);
    expect(enrollmentTable(list, new Set(['1']))).toMatch(/^\*\s+1\s+CMSC1/m);
  });

  it('sends the route the suggested slug parts, the Canvas name and the role', () => {
    expect(importBody([list[4]!])).toEqual({ courses: [{ canvasCourseId: '5', term: '2026-fall', code: 'CMSC5', section: null, name: 'Course 5', role: 'ta' }] });
  });
});

describe('the wizard with --yes in a throwaway home', () => {
  let home: string;
  const savedHome = process.env.COLLECTED_AGENT_HOME;
  const lines: string[] = [];
  const io: QuickstartIo = {
    say: (s) => lines.push(s),
    ask: async () => {
      throw new Error('asked despite --yes');
    },
    readSecret: async () => {
      throw new Error('read a secret despite --yes');
    },
  };
  const never = { status: () => ({ unit: 'test.timer', installed: false, files: [], loaded: null, logFile: '/tmp/daemon.log', lastRunAt: null, tail: [] }), install: () => 'should not install' };
  const canvasFails = async () => {
    throw new Error('no Canvas session cookie (canvas_session) for umd.instructure.com in chrome/firefox. Open https://umd.instructure.com and sign in first.\n  chrome: not installed');
  };

  beforeAll(() => {
    home = mkdtempSync(path.join(tmpdir(), 'collected-quickstart-'));
    process.env.COLLECTED_AGENT_HOME = home;
  });
  afterAll(() => {
    if (savedHome === undefined) delete process.env.COLLECTED_AGENT_HOME;
    else process.env.COLLECTED_AGENT_HOME = savedHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('first run: init local, Canvas fails with the paste fallback, Google, Todoist and the timer skipped, agenda printed, exit 0', async () => {
    const code = await runQuickstart({ io, yes: true, logLevel: 'silent', canvas: canvasFails, daemon: never, ui: async () => expect.unreachable('ui started') });
    expect(code).toBe(0);
    const out = lines.join('\n');
    expect(JSON.parse(readFileSync(path.join(home, 'agent.json'), 'utf8')).server).toBe('local');
    expect(out).toContain(`wrote ${path.join(home, 'agent.json')}`);
    // Every step announced with its sentence, numbered.
    QUICKSTART_STEPS.forEach((s, i) => expect(out).toContain(`${i + 1}. ${s.title}. ${s.why}`));
    expect(out).toContain('no Canvas session cookie');
    expect(out).toContain('DevTools → Application → Cookies');
    expect(out).toContain('connect canvas --token');
    expect(out).toContain('skipped: Canvas is not connected yet');
    expect(out).toContain('Connect Google Calendar? (opens your browser once) [y/N] n');
    expect(out).toContain('Connect Google Tasks? (opens your browser once) [y/N] n');
    expect(out).toContain('Todoist API token');
    expect(out).toContain('(skipped)');
    expect(out).toContain('Install it? [y/N] n');
    expect(out).not.toContain('should not install');
    expect(out).toContain('(nothing)');
    expect(out).toContain('collected agenda');
    expect(out).toContain('collected todo');
    expect(out).toContain('collected ui');
    expect(out).toContain('Open the dashboard now? (runs until Ctrl-C) [y/N] n');
  }, 60_000);

  it('second run: keeps the config, and reports what is already done (courses, Todoist, the timer)', async () => {
    const api = await LocalApi.open(loadConfig(), { logLevel: 'silent' });
    await api.demo('canvas');
    await api.demo('todoist');
    lines.length = 0;
    const installed = { ...never, status: () => ({ ...never.status(), installed: true }) };
    const code = await runQuickstart({ io, yes: true, logLevel: 'silent', canvas: canvasFails, daemon: installed });
    expect(code).toBe(0);
    const out = lines.join('\n');
    expect(out).toContain(`config exists at ${path.join(home, 'agent.json')}: local`);
    expect(out).toContain('Keep it? [Y/n] y');
    expect(out).toMatch(/\d+ courses already set up; skipping/);
    expect(out).toContain('Todoist is connected; skipping.');
    expect(out).toContain('test.timer is installed');
    expect(out).toContain('[task] Buy oat milk');
  }, 60_000);

  it('a Google yes runs the injected connect and prints its detail', async () => {
    lines.length = 0;
    let asked = 0;
    const answering: QuickstartIo = { ...io, ask: async (q, def) => (++asked, /Google Calendar/.test(q) ? 'y' : def) };
    const code = await runQuickstart({
      io: answering,
      logLevel: 'silent',
      canvas: canvasFails,
      daemon: never,
      google: async (_cfg, target) => ({ ok: true, source: target === 'calendar' ? 'gcal' : 'gtasks', detail: `fake ${target} connected` }),
    });
    expect(code).toBe(0);
    expect(asked).toBeGreaterThan(3);
    expect(lines.join('\n')).toContain('fake calendar connected');
    expect(lines.join('\n')).not.toContain('fake tasks connected');
  }, 60_000);
});

describe('quickstart without a terminal', () => {
  it('refuses with exit 2 and points at --agent; --agent itself works on a pipe', () => {
    const home = mkdtempSync(path.join(tmpdir(), 'collected-quickstart-tty-'));
    try {
      const env = { ...process.env, COLLECTED_AGENT_HOME: home, NO_UPDATE_NOTIFIER: '1' };
      const cli = path.join(import.meta.dirname, 'cli.ts');
      const r = spawnSync(process.execPath, ['--import', 'tsx', cli, 'quickstart'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env, cwd: path.join(import.meta.dirname, '..') });
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('quickstart is interactive; run it in a terminal, or `collected quickstart --agent` for the step list');
      const a = spawnSync(process.execPath, ['--import', 'tsx', cli, 'quickstart', '--agent'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env, cwd: path.join(import.meta.dirname, '..') });
      expect(a.status).toBe(0);
      expect(a.stdout).toContain(SKILL_URL);
      expect(a.stdout).toContain('`collected connect canvas`');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 60_000);
});
