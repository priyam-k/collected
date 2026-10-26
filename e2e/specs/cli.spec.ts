import { expect, test } from '@playwright/test';
import { COURSE } from '../env.js';
import { apiGet, cli, cliOk, ensureAgentConfigured } from '../helpers.js';

/*
 * The built `collected` CLI (agent/dist/cli.js) against the e2e server, authenticated with the helper key.
 * `task add` needs Todoist's real quick-add endpoint (the mock API is wired only into `cli demo todoist`), so that
 * flow asserts the failure is reported cleanly instead of pretending a task was created.
 */
test.describe.serial('collected CLI', () => {
  test.beforeAll(() => ensureAgentConfigured());

  test('courses --json lists the seeded courses', () => {
    const out = JSON.parse(cliOk(['courses', '--json'])) as { code: string; id: string; role: string }[];
    expect(out.map((c) => c.code).sort()).toEqual(['CMSC330', 'CMSC422', 'MATH423', 'STAT410']);
    expect(out.find((c) => c.code === 'CMSC330')?.role).toBe('ta');
    expect(cliOk(['courses'])).toMatch(/CMSC422.*student/);
  });

  test('assignments and todo read what the dashboard shows', () => {
    const all = JSON.parse(cliOk(['assignments', '--all', '--json'])) as { id: string; title: string; effectiveDone: boolean }[];
    expect(all.some((a) => a.id === 'canvas:assignment:7775093' && a.title === 'HW01: Warm up' && !a.effectiveDone)).toBe(true);
    expect(all.some((a) => a.id === 'canvas:assignment:7775094' && a.effectiveDone)).toBe(true);

    const perCourse = JSON.parse(cliOk(['assignments', '--course', 'cmsc422', '--all', '--json'])) as { courseId: string }[];
    expect(perCourse.length).toBeGreaterThan(0);
    expect(perCourse.every((a) => a.courseId === COURSE.cmsc422)).toBe(true);

    const todo = cliOk(['todo']);
    expect(todo).toContain('Tasks');
    expect(todo).toContain('Buy oat milk');
    expect(todo).toContain('todoist:d1');
  });

  test('agenda groups the week by day', () => {
    const out = cliOk(['agenda']);
    expect(out).toContain('[task] Buy oat milk');
    expect(out).toContain('[task] Renew parking permit');
    expect(JSON.parse(cliOk(['agenda', '--days', '2', '--json'])).length).toBeGreaterThan(0);
  });

  test('sources reports every integration', () => {
    const out = cliOk(['sources']);
    expect(out).toMatch(/todoist\s+connected/);
    expect(out).toMatch(/canvas\s+disconnected/);
  });

  test('task add fails cleanly without a Todoist token', () => {
    const r = cli(['task', 'add', 'buy stamps tomorrow']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('/api/todoist/tasks/quick');
    expect(r.stdout).not.toContain('added:');
  });

  test('notes set / clear round-trip through the course', async ({ request }) => {
    const note = `Office hours moved to 3pm (e2e ${Date.now()})`;
    const out = cliOk(['notes', 'set', 'cmsc422', note]);
    expect(out).toContain('was: (none)');
    expect(out).toContain(`now: ${note}`);
    expect((await apiGet<{ notes: string | null }>(request, `/courses/${COURSE.cmsc422}`)).notes).toBe(note);
    expect(JSON.parse(cliOk(['course', 'cmsc422', '--json'])).course.notes).toBe(note);

    expect(cliOk(['notes', 'clear', 'cmsc422'])).toContain('now: (none)');
    expect((await apiGet<{ notes: string | null }>(request, `/courses/${COURSE.cmsc422}`)).notes).toBeNull();
  });

  test('done marks an assignment done here only, and --undo reverts it', async ({ request }) => {
    const id = 'canvas:assignment:7775093';
    try {
      expect(cliOk(['done', id])).toContain('marked done here');
      const items = await apiGet<{ id: string; effectiveDone: boolean; status: string }[]>(request, `/items?kind=assignment&course=${COURSE.cmsc422}&includeDone=1&limit=100`);
      const hw = items.find((i) => i.id === id)!;
      expect(hw.effectiveDone).toBe(true);
      expect(hw.status).toBe('open'); // the source row is untouched
    } finally {
      expect(cliOk(['done', id, '--undo'])).toContain('no longer marked done');
    }
    const items = await apiGet<{ id: string; effectiveDone: boolean }[]>(request, `/items?kind=assignment&course=${COURSE.cmsc422}&includeDone=1&limit=100`);
    expect(items.find((i) => i.id === id)?.effectiveDone).toBe(false);
  });

  test('canvas ls answers with a clear 404 while Canvas is not connected', () => {
    const r = cli(['canvas', 'ls', 'cmsc422', 'files']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('404');
    expect(r.stderr).toContain('Canvas is not connected');
  });
});
