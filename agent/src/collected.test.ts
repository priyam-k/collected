import { describe, expect, it } from 'vitest';
import type { Course } from '@collected/shared';
import type { Api } from './api.js';
import { isCollectedCommand, resolveCourse, runCollected } from './collected.js';
import { describeSchedule, htmlToText, linkedFiles, parseMeetings, table } from './format.js';

const course = (over: Partial<Course>): Course => ({
  id: '2026-fall-enme480-0102', term: '2026-fall', code: 'ENME480', section: '0102', name: 'Intro to Robotics', role: 'student', canvasCourseId: '2001008', gradescopeCourseId: null, submitsVia: 'both', color: '#16a34a',
  links: [{ label: 'Website', url: 'https://enme480.github.io/' }],
  schedule: { lecture: [{ day: 'mon', start: '14:00', end: '14:50', location: 'CHE 2110' }, { day: 'wed', start: '14:00', end: '14:50', location: 'CHE 2110' }] },
  notes: null, archived: false, grading: null, fileSync: null, createdAt: '', updatedAt: '', ...over,
});
const COURSES = [course({}), course({ id: '2026-fall-cmsc422-0101', code: 'CMSC422', canvasCourseId: '2001001', links: [], schedule: {} }), course({ id: '2026-fall-cmsc330-0103', code: 'CMSC330', role: 'ta', links: [], schedule: {} })];

/** Records every request; answers GETs from a table of path prefixes. */
function fakeApi(gets: Record<string, unknown> = {}) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const api = {
    get: async (path: string) => {
      calls.push({ method: 'GET', path });
      if (path === '/api/courses') return COURSES;
      const hit = Object.keys(gets).find((k) => path.startsWith(k));
      if (!hit) throw new Error(`unexpected GET ${path}`);
      return gets[hit];
    },
    send: async (method: string, path: string, body?: unknown) => {
      calls.push({ method, path, body });
      if (method === 'PUT' && path.startsWith('/api/courses/')) return { ...COURSES.find((c) => path.endsWith(encodeURIComponent(c.id)))!, ...(body as object) };
      if (path === '/api/items/manual') return { id: 'manual:u1', title: (body as { title: string }).title, startsAt: '2026-10-19T04:00:00.000Z', allDay: true };
      if (path === '/api/todoist/tasks/quick') return { id: 'todoist:9', title: 'essay draft', dueAt: '2026-10-09T21:00:00.000Z' };
      return { ok: true };
    },
  } as unknown as Api;
  return { api, calls, writes: () => calls.filter((c) => c.method !== 'GET') };
}

describe('formatting and parsing', () => {
  it('reads a schedule spec and writes one back', () => {
    expect(parseMeetings('mon,wed 14:00-14:50 @ CHE 2110')).toEqual([{ day: 'mon', start: '14:00', end: '14:50', location: 'CHE 2110' }, { day: 'wed', start: '14:00', end: '14:50', location: 'CHE 2110' }]);
    expect(parseMeetings('Tuesday/Thu 9:30–10:45')).toEqual([{ day: 'tue', start: '09:30', end: '10:45' }, { day: 'thu', start: '09:30', end: '10:45' }]);
    expect(() => parseMeetings('someday 9-10')).toThrow(/can't read/);
    expect(() => parseMeetings('mon 15:00-14:00')).toThrow(/after the start/);
    expect(() => parseMeetings('mon,funday 10:00-11:00')).toThrow(/unknown day "funday"/);
    expect(describeSchedule({ lecture: parseMeetings('mon,wed 14:00-14:50 @ CHE 2110'), lab: parseMeetings('fri 08:00-10:00') })).toBe('lecture Mon/Wed 14:00–14:50 @ CHE 2110; lab Fri 08:00–10:00');
    expect(describeSchedule({})).toBe('(none)');
  });
  it('turns Canvas HTML into text and finds the files it links', () => {
    const html = '<h2>Homework 2</h2><p>Read <a href="https://x.test/a">chapter 3</a> &amp; solve:</p><ul><li>1.1</li><li>1.2</li></ul><p><a class="instructure_file_link" href="https://umd.instructure.com/courses/1/files/91124380?wrap=1">spec.pdf</a></p><script>evil()</script>';
    expect(htmlToText(html)).toBe('## Homework 2\n\nRead chapter 3 (https://x.test/a) & solve:\n\n- 1.1\n- 1.2\n\nspec.pdf (https://umd.instructure.com/courses/1/files/91124380?wrap=1)');
    expect(linkedFiles(html)).toEqual([{ fileId: '91124380', text: 'spec.pdf' }]);
    expect(htmlToText(null)).toBe('');
  });
  it('lays out a table', () => {
    expect(table(['A', 'Bee'], [['x', 1], ['long', null]])).toBe('A     Bee\n----  ---\nx     1\nlong');
    expect(table(['A'], [])).toBe('(none)');
  });
});

describe('commands', () => {
  it('finds a course by code, digits or id, and says so when it cannot', async () => {
    const { api } = fakeApi();
    expect((await resolveCourse(api, 'enme480')).code).toBe('ENME480');
    expect((await resolveCourse(api, '422')).code).toBe('CMSC422');
    expect((await resolveCourse(api, '2026-fall-cmsc330-0103')).code).toBe('CMSC330');
    await expect(resolveCourse(api, 'cmsc')).rejects.toThrow(/no course "cmsc"/);
    await expect(resolveCourse(api, '0')).rejects.toThrow(/no course "0"/); // suffixes need three digits
    await expect(resolveCourse(api, 'e480')).rejects.toThrow(/no course "e480"/);
    expect(isCollectedCommand('assignments')).toBe(true);
    expect(isCollectedCommand('sync')).toBe(false); // the file sync keeps that name
  });

  it('course edits send exactly one field and report before and after', async () => {
    const f = fakeApi();
    const out = await runCollected(f.api, 'link', ['add', 'enme480', 'Piazza', 'https://piazza.com/x']);
    expect(f.writes()).toEqual([{ method: 'PUT', path: '/api/courses/2026-fall-enme480-0102', body: { links: [{ label: 'Website', url: 'https://enme480.github.io/' }, { label: 'Piazza', url: 'https://piazza.com/x' }] } }]);
    expect(out).toContain('was: Website → https://enme480.github.io/');
    expect(out).toContain('now: Website → https://enme480.github.io/ · Piazza → https://piazza.com/x');

    const g = fakeApi();
    await runCollected(g.api, 'schedule', ['set', '480', 'lab', 'fri 08:00-10:00 @ KEB 2111']);
    expect(g.writes()[0]!.body).toEqual({ schedule: { lecture: COURSES[0]!.schedule.lecture, lab: [{ day: 'fri', start: '08:00', end: '10:00', location: 'KEB 2111' }] } }); // other kinds kept
    await runCollected(g.api, 'schedule', ['rm', '480', 'lecture']);
    expect(g.writes()[1]!.body).toEqual({ schedule: {} });
    await runCollected(g.api, 'notes', ['set', '480', 'bring', 'calculator']);
    expect(g.writes()[2]!.body).toEqual({ notes: 'bring calculator' });
    await expect(runCollected(g.api, 'link', ['rm', '480', 'Nope'])).rejects.toThrow(/has no link "Nope"/);
    expect(g.writes()).toHaveLength(3); // a refused edit sends nothing
  });

  it('adds dates and tasks, and prints JSON on request', async () => {
    const f = fakeApi();
    const out = await runCollected(f.api, 'date', ['add', 'enme480', 'exam', 'Exam 1', '2026-10-19', '--start', '14:00', '--end', '14:50', '--location', 'CHE 2110']);
    expect(f.writes()[0]).toEqual({ method: 'POST', path: '/api/items/manual', body: { courseId: '2026-fall-enme480-0102', kind: 'exam', title: 'Exam 1', date: '2026-10-19', start: '14:00', end: '14:50', location: 'CHE 2110', note: null, meetingKind: null } });
    expect(out).toContain('added exam "Exam 1" for ENME480');
    await runCollected(f.api, 'date', ['rm', 'manual:u1']);
    expect(f.writes()[1]).toMatchObject({ method: 'DELETE', path: '/api/items/manual/u1' });
    const json = JSON.parse(await runCollected(f.api, 'task', ['add', 'essay', 'draft', 'fri', '5pm', '--json']));
    expect(f.writes()[2]).toMatchObject({ path: '/api/todoist/tasks/quick', body: { text: 'essay draft fri 5pm' } });
    expect(json.id).toBe('todoist:9');
    await runCollected(f.api, 'done', ['canvas:assignment:7', '--undo']);
    expect(f.writes()[3]).toEqual({ method: 'POST', path: '/api/items/canvas%3Aassignment%3A7/override', body: { done: false } });
  });

  it('reads Canvas through the proxy with the path encoded, and shows full text, rubric and linked files', async () => {
    const f = fakeApi({
      '/api/canvas/raw': { name: 'Homework 2', description: '<p>Do it. <a href="/courses/2001008/files/91124380/download">spec.pdf</a></p>', due_at: '2026-10-06T03:59:00Z', lock_at: null, points_possible: 20, submission_types: ['online_upload'], html_url: 'https://umd.instructure.com/courses/2001008/assignments/7795797', rubric: [{ description: 'Correctness', points: 15, ratings: [{ description: 'Full', points: 15 }, { description: 'None', points: 0 }] }] },
    });
    const out = await runCollected(f.api, 'canvas', ['show', 'enme480', 'assignment', '7795797']);
    expect(f.calls.at(-1)!.path).toBe(`/api/canvas/raw?path=${encodeURIComponent('/api/v1/courses/2001008/assignments/7795797')}`);
    expect(out).toContain('Homework 2');
    expect(out).toContain('20 pts · online_upload');
    expect(out).toContain('15 pts  Correctness');
    expect(out).toContain('91124380  spec.pdf');
    await runCollected(f.api, 'canvas', ['ls', 'enme480', 'pages']).catch(() => undefined);
    expect(f.calls.at(-1)!.path).toBe(`/api/canvas/raw?path=${encodeURIComponent('/api/v1/courses/2001008/pages')}&all=1`);
  });
});
