import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_JOB_STAGES, type Course, type Job, type JobStage, type Source } from '@collected/shared';
import { ApiError, type Api } from './api.js';
import { gcalCalendars, isCollectedCommand, resolveCalendar, resolveCourse, runCollected } from './collected.js';
import { describeSchedule, htmlToText, linkedFiles, parseDuration, parseMeetings, parseWhen, table } from './format.js';

const course = (over: Partial<Course>): Course => ({
  id: '2026-fall-enme480-0102', term: '2026-fall', code: 'ENME480', section: '0102', name: 'Intro to Robotics', role: 'student', canvasCourseId: '2001008', gradescopeCourseId: null, submitsVia: 'both', color: '#16a34a',
  links: [{ label: 'Website', url: 'https://enme480.github.io/' }],
  schedule: { lecture: [{ day: 'mon', start: '14:00', end: '14:50', location: 'CHE 2110' }, { day: 'wed', start: '14:00', end: '14:50', location: 'CHE 2110' }] },
  notes: null, archived: false, grading: null, fileSync: null, createdAt: '', updatedAt: '', ...over,
});
const GCAL = (over: Partial<Source> = {}): Source => ({
  id: 'gcal', enabled: true, status: 'connected', lastRunAt: null, lastSuccessAt: null, lastError: null, hasConfig: true, running: false, updatedAt: '',
  meta: { defaultCalendarId: 'work@group.calendar.google.com', calendars: [{ id: 'me@gmail.com', summary: 'Priyam', primary: true, backgroundColor: '#1f6' }, { id: 'work@group.calendar.google.com', summary: 'Work', primary: false, backgroundColor: '#f61' }, { id: 'dup1', summary: 'Classes', primary: false, backgroundColor: null }, { id: 'dup2', summary: 'classes', primary: false, backgroundColor: null }] },
  ...over,
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
      if (path === '/api/calendar/events') {
        const b = body as { title: string; allDay: boolean; start: string; end?: string; calendarId?: string };
        const cal = b.calendarId ?? 'work@group.calendar.google.com';
        return { id: `gcal:${cal}:ev1`, title: b.title, allDay: b.allDay, startsAt: b.allDay ? new Date(`${b.start}T00:00:00`).toISOString() : b.start, endsAt: b.end ? (b.allDay ? new Date(`${b.end}T00:00:00`).toISOString() : b.end) : b.allDay ? null : new Date(Date.parse(b.start) + 3_600_000).toISOString(), raw: { calendarId: cal, calendarName: cal === 'me@gmail.com' ? 'Priyam' : 'Work' } };
      }
      if (path === '/api/gtasks/tasks/quick') return { id: 'gtasks:L1:t9', title: (body as { content: string }).content, dueAt: (body as { due?: string }).due ? `${(body as { due: string }).due}T04:00:00.000Z` : null };
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
  it('reads a moment in local time: absolute, today/tomorrow, a weekday, and refuses the rest', () => {
    const now = new Date(2026, 10, 4, 10, 0); // Wed Nov 4 2026, 10:00 local
    const cases: [string, Date][] = [
      ['2026-11-13 14:00', new Date(2026, 10, 13, 14, 0)],
      ['2026-11-13T09:05', new Date(2026, 10, 13, 9, 5)],
      ['2026-11-13 5:30pm', new Date(2026, 10, 13, 17, 30)],
      ['today 14:00', new Date(2026, 10, 4, 14, 0)],
      ['tomorrow 9:30', new Date(2026, 10, 5, 9, 30)],
      ['fri 17:00', new Date(2026, 10, 6, 17, 0)],
      ['Friday 17:00', new Date(2026, 10, 6, 17, 0)],
      ['wed 15:00', new Date(2026, 10, 4, 15, 0)], // today, the time is still ahead
      ['wed 9:00', new Date(2026, 10, 11, 9, 0)], // today's 9:00 has passed: next week
      ['tue 8:00', new Date(2026, 10, 10, 8, 0)],
    ];
    for (const [input, want] of cases) expect(parseWhen(input, now).getTime(), input).toBe(want.getTime());
    for (const bad of ['2026-11-13', 'friday', 'fri 25:00', 'fri 17:60', 'someday 10:00', '2026-02-30 10:00', 'next week', '', '14:00']) expect(() => parseWhen(bad, now), bad).toThrow();
    expect(() => parseWhen('noon', now)).toThrow(/can't read "noon"/);
  });
  it('reads a duration in minutes', () => {
    expect(parseDuration('30m')).toBe(30);
    expect(parseDuration('90m')).toBe(90);
    expect(parseDuration('1h')).toBe(60);
    expect(parseDuration('1h30m')).toBe(90);
    expect(parseDuration('2H')).toBe(120);
    for (const bad of ['2d', '0m', '90', '1h2', '', 'hour']) expect(() => parseDuration(bad), bad).toThrow(/duration/);
  });
  it('lays out a table', () => {
    expect(table(['A', 'Bee'], [['x', 1], ['long', null]])).toBe('A     Bee\n----  ---\nx     1\nlong');
    expect(table(['A'], [])).toBe('(none)');
    expect(table(['A', 'Id'], [['abcdefghij', 'manual:0123456789']], 6)).toBe('A       Id\n------  ------\nabcde…  manua…');
    expect(table(['A', 'Id'], [['abcdefghij', 'manual:0123456789']], 6, true)).toBe('A       Id\n------  -----------------\nabcde…  manual:0123456789');
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

  it('routes task add and task done to the right to-do app', async () => {
    // No /api/todo/status answer: Todoist stays the default.
    const f = fakeApi();
    await runCollected(f.api, 'task', ['add', 'buy', 'milk']);
    expect(f.writes()[0]).toMatchObject({ path: '/api/todoist/tasks/quick', body: { text: 'buy milk' } });
    const out = await runCollected(f.api, 'task', ['add', 'outline', 'project', '--to', 'gtasks', '--due', '2026-11-02']);
    expect(f.writes()[1]).toMatchObject({ path: '/api/gtasks/tasks/quick', body: { content: 'outline project', due: '2026-11-02' } });
    expect(out).toContain('added to Google Tasks: outline project');
    await expect(runCollected(f.api, 'task', ['add', 'x', '--to', 'notes'])).rejects.toThrow(/--to must be/);
    await expect(runCollected(f.api, 'task', ['add', 'x', '--due', 'friday'])).rejects.toThrow(/YYYY-MM-DD/);
    // The dashboard's default app wins when no --to is given.
    const g = fakeApi({ '/api/todo/status': { defaultApp: 'gtasks' } });
    await runCollected(g.api, 'task', ['add', 'call', 'mom']);
    expect(g.writes()[0]).toMatchObject({ path: '/api/gtasks/tasks/quick', body: { content: 'call mom' } });
    await runCollected(g.api, 'task', ['done', 'gtasks:L1:t9']);
    expect(g.writes()[1]).toMatchObject({ path: '/api/gtasks/tasks/L1%3At9/close' });
    await runCollected(g.api, 'task', ['done', 'todoist:d1']);
    expect(g.writes()[2]).toMatchObject({ path: '/api/todoist/tasks/d1/close' });
  });

  it('picks a calendar by id or name and says when it cannot', () => {
    const g = gcalCalendars([GCAL()]);
    expect(g.connected).toBe(true);
    expect(g.defaultCalendarId).toBe('work@group.calendar.google.com');
    expect(resolveCalendar(g.calendars, 'me@gmail.com').summary).toBe('Priyam');
    expect(resolveCalendar(g.calendars, 'work').id).toBe('work@group.calendar.google.com');
    expect(resolveCalendar(g.calendars, 'PRIYAM').id).toBe('me@gmail.com');
    expect(() => resolveCalendar(g.calendars, 'classes')).toThrow(/matches 2 calendars; give the id instead\. Calendars: Priyam \(me@gmail.com\), Work/);
    expect(() => resolveCalendar(g.calendars, 'Family')).toThrow(/no calendar "Family"\. Calendars: Priyam \(me@gmail.com\)/);
    expect(gcalCalendars([GCAL({ status: 'disconnected' })]).connected).toBe(false);
    expect(gcalCalendars([GCAL({ meta: {} })]).connected).toBe(false);
    expect(gcalCalendars([]).connected).toBe(false);
    // No default set: the primary calendar stands in.
    expect(gcalCalendars([GCAL({ meta: { calendars: (GCAL().meta as { calendars: unknown[] }).calendars } })]).defaultCalendarId).toBe('me@gmail.com');
  });

  it('event add sends a timed or an all-day event and names the calendar it landed in', async () => {
    const f = fakeApi({ '/api/sources': [GCAL()] });
    const out = await runCollected(f.api, 'event', ['add', 'Office', 'hours', '--at', '2026-11-13 14:00', '--for', '1h30m', '--location', 'IRB 2207', '--note', 'bring laptop']);
    const start = new Date(2026, 10, 13, 14, 0);
    expect(f.writes()[0]).toEqual({ method: 'POST', path: '/api/calendar/events', body: { title: 'Office hours', allDay: false, start: start.toISOString(), end: new Date(start.getTime() + 90 * 60_000).toISOString(), location: 'IRB 2207', description: 'bring laptop' } });
    expect(f.calls.filter((c) => c.path === '/api/sources')).toHaveLength(0); // the server picks the default calendar
    expect(out).toMatch(/^added: Office hours · Fri, Nov 13, 2:00 PM–3:30 PM · Work · gcal:work@group\.calendar\.google\.com:ev1$/);

    await runCollected(f.api, 'event', ['add', 'Dentist', '--at', '2026-11-13 09:00', '--end', '2026-11-13 09:40', '--calendar', 'priyam']);
    expect(f.writes()[1]!.body).toEqual({ title: 'Dentist', allDay: false, start: new Date(2026, 10, 13, 9, 0).toISOString(), end: new Date(2026, 10, 13, 9, 40).toISOString(), calendarId: 'me@gmail.com' });
    await runCollected(f.api, 'event', ['add', 'No end given', '--at', '2026-11-13 09:00']);
    expect(f.writes()[2]!.body).toEqual({ title: 'No end given', allDay: false, start: new Date(2026, 10, 13, 9, 0).toISOString() }); // the server adds 60 minutes

    const day = await runCollected(f.api, 'event', ['add', 'Reading day', '--on', '2026-12-11']);
    expect(f.writes()[3]!.body).toEqual({ title: 'Reading day', allDay: true, start: '2026-12-11' });
    expect(day).toContain('added: Reading day · Fri, Dec 11 · Work ·');
    const span = await runCollected(f.api, 'event', ['add', 'Thanksgiving', 'break', '--on', '2026-11-25', '--until', '2026-11-29', '--calendar', 'me@gmail.com', '--json']);
    expect(f.writes()[4]!.body).toEqual({ title: 'Thanksgiving break', allDay: true, start: '2026-11-25', end: '2026-11-30', calendarId: 'me@gmail.com' }); // --until is inclusive; Google's end is exclusive
    expect(JSON.parse(span).id).toBe('gcal:me@gmail.com:ev1');

    const n = f.writes().length;
    await expect(runCollected(f.api, 'event', ['add', 'x'])).rejects.toThrow(/--at "<when>" for a timed event or --on/);
    await expect(runCollected(f.api, 'event', ['add', 'x', '--at', 'fri 17:00', '--on', '2026-11-13'])).rejects.toThrow(/--at .* or --on/);
    await expect(runCollected(f.api, 'event', ['add', 'x', '--at', 'fri 17:00', '--for', '1h', '--end', 'fri 19:00'])).rejects.toThrow(/--for or --end, not both/);
    await expect(runCollected(f.api, 'event', ['add', 'x', '--at', 'fri 17:00', '--for', '2d'])).rejects.toThrow(/duration/);
    await expect(runCollected(f.api, 'event', ['add', 'x', '--at', '2026-11-13 17:00', '--end', '2026-11-13 16:00'])).rejects.toThrow(/--end .* must be after --at/);
    await expect(runCollected(f.api, 'event', ['add', 'x', '--on', 'friday'])).rejects.toThrow(/--on must be YYYY-MM-DD/);
    await expect(runCollected(f.api, 'event', ['add', 'x', '--on', '2026-11-13', '--until', '2026-11-12'])).rejects.toThrow(/--until must not be before --on/);
    await expect(runCollected(f.api, 'event', ['add', 'x', '--on', '2026-11-13', '--for', '1h'])).rejects.toThrow(/--for and --end go with --at/);
    await expect(runCollected(f.api, 'event', ['add', 'x', '--at', 'fri 17:00', '--calendar', 'classes'])).rejects.toThrow(/matches 2 calendars/);
    await expect(runCollected(f.api, 'event', ['add', 'x', '--at', 'fri 17:00', '--calendar', 'Family'])).rejects.toThrow(/no calendar "Family"/);
    await expect(runCollected(f.api, 'event', ['rm', 'x'])).rejects.toThrow(/usage: event add/);
    expect(f.writes()).toHaveLength(n); // a refused event sends nothing
    const off = fakeApi({ '/api/sources': [GCAL({ status: 'disconnected' })] });
    await expect(runCollected(off.api, 'event', ['add', 'x', '--at', 'fri 17:00', '--calendar', 'Work'])).rejects.toThrow(/Google Calendar is not connected/);
  });

  it('event calendars lists the connected calendars with the default and primary marked', async () => {
    const f = fakeApi({ '/api/sources': [GCAL()] });
    const out = await runCollected(f.api, 'event', ['calendars']);
    expect(out).toMatch(/^Calendar\s+Id/);
    expect(out).toMatch(/Priyam\s+me@gmail\.com\s+primary$/m);
    expect(out).toMatch(/Work\s+work@group\.calendar\.google\.com\s+default$/m);
    expect(out).toMatch(/Classes\s+dup1$/m);
    const json = JSON.parse(await runCollected(f.api, 'event', ['calendars', '--json']));
    expect(json.connected).toBe(true);
    expect(json.calendars).toHaveLength(4);
    expect(await runCollected(fakeApi({ '/api/sources': [GCAL({ status: 'needs_auth' })] }).api, 'event', ['calendars'])).toBe('Google Calendar is not connected');
    expect(await runCollected(fakeApi({ '/api/sources': [] }).api, 'event', ['calendars'])).toBe('Google Calendar is not connected');
    expect(isCollectedCommand('event')).toBe(true);
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

/* ---------- jobs ---------- */

const JOB = (over: Partial<Job>): Job => ({
  id: 'simplify:7d0f3b7a-1c2d-4e5f-8a9b-0c1d2e3f4a5b', source: 'simplify', externalId: '7d0f3b7a-1c2d-4e5f-8a9b-0c1d2e3f4a5b', company: 'Acme', title: 'Software Engineering Intern', locations: ['New York, NY', 'Remote'],
  url: 'https://boards.greenhouse.io/acme/jobs/4242424242', reqId: '4242424242', terms: ['Summer 2027'], sponsorship: null, degrees: [], category: 'Software Engineering', postedAt: '2026-11-01T12:00:00.000Z', active: true, visible: true, matchesFilter: true, score: null,
  firstSeenAt: '2026-11-01T13:00:00.000Z', updatedAt: '2026-11-01T13:00:00.000Z', state: 'new', notes: null, seenAt: null, appliedAt: null, nextAction: null, nextActionAt: null, resumePath: null, stateUpdatedAt: null, ...over,
});
const FEED = JOB({});
const UNSEEN = JOB({ id: 'simplify:unseen-1', company: 'Beta', title: 'Backend Intern', url: 'https://jobs.lever.co/beta/0a1b2c3d-0000-4000-8000-000000000000', reqId: '0a1b2c3d-0000-4000-8000-000000000000' });
const MANUAL = JOB({
  id: 'manual:9f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b', source: 'manual', externalId: '9f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b', company: 'Gamma', title: 'Platform Intern', url: '', reqId: 'G-77', terms: [], category: null, matchesFilter: false, locations: ['Boston, MA'],
  state: 'interviewing', notes: 'referral from J\nonsite is a take-home', appliedAt: '2026-10-20', nextAction: 'send thank-you', nextActionAt: '2026-11-07', resumePath: fileURLToPath(import.meta.url), seenAt: '2026-10-20T10:00:00.000Z', stateUpdatedAt: '2026-11-04T09:00:00.000Z',
});
const STARRED = JOB({ id: 'simplify:starred-1', company: 'Delta', title: 'Data Intern', state: 'starred', reqId: null, url: 'https://delta.example.com/careers/data-intern' });

/** A jobs API in memory: the tracked list, a feed, one stage list, and a POST that can be told to answer 409. */
function jobsApi(opts: { conflict?: boolean } = {}) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const stages: JobStage[] = [...DEFAULT_JOB_STAGES];
  const byId = new Map([FEED, UNSEEN, MANUAL, STARRED].map((j) => [j.id, j]));
  const one = (path: string) => {
    const id = decodeURIComponent(path.replace(/^\/api\/jobs\//, '').replace(/\/state$/, ''));
    const j = byId.get(id);
    if (!j) throw new ApiError(`${path}: 404 job not found`, 404, { error: 'job not found' });
    return j;
  };
  const api = {
    get: async (path: string) => {
      calls.push({ method: 'GET', path });
      const u = new URL(path, 'http://x');
      if (u.pathname === '/api/jobs/stages') return { stages };
      if (u.pathname === '/api/jobs/tracked') return [MANUAL, STARRED];
      if (u.pathname === '/api/jobs/find') return u.searchParams.get('req') === '4242424242' || u.searchParams.get('url')?.includes('4242424242') ? [FEED] : [];
      if (u.pathname === '/api/jobs') return u.searchParams.get('query') ? [FEED, STARRED] : [FEED, UNSEEN];
      return one(u.pathname);
    },
    send: async (method: string, path: string, body?: unknown) => {
      calls.push({ method, path, body });
      const u = new URL(path, 'http://x');
      if (method === 'POST' && u.pathname === '/api/jobs') {
        if (opts.conflict && u.searchParams.get('force') !== '1') throw new ApiError('/api/jobs: 409 already here', 409, { error: 'already here', existing: FEED });
        const b = body as Partial<Job>;
        return JOB({ ...b, id: 'manual:new-1', source: 'manual', state: b.state ?? 'applied', appliedAt: b.appliedAt ?? '2026-11-05', reqId: b.reqId ?? null, url: b.url ?? '' });
      }
      if (method === 'PATCH' && u.pathname.endsWith('/state')) return { ...one(u.pathname), ...(body as object) };
      if (method === 'PUT' && u.pathname === '/api/jobs/stages') {
        stages.splice(0, stages.length, ...(body as { stages: JobStage[] }).stages);
        return { stages };
      }
      return { ok: true };
    },
  } as unknown as Api;
  return { api, calls, stages, writes: () => calls.filter((c) => c.method !== 'GET') };
}
const query = (path: string) => Object.fromEntries(new URL(path, 'http://x').searchParams);

describe('jobs commands', () => {
  it('lists the tracker and the feed with full ids', async () => {
    const f = jobsApi();
    const out = await runCollected(f.api, 'jobs', []);
    expect(f.calls[0]!.path).toBe('/api/jobs/tracked?limit=20');
    expect(out).toMatch(/^Company\s+Title\s+State\s+Applied\s+Req\s+Next\s+Id/);
    expect(out).toContain(MANUAL.id); // never cut
    expect(out).toContain('send thank-you (2026-11-07)');
    await runCollected(f.api, 'jobs', ['--state', 'applied,Screen', '--limit', '5']);
    expect(query(f.calls.at(-1)!.path)).toEqual({ state: 'applied,screen', limit: '5' });
    expect(JSON.parse(await runCollected(f.api, 'jobs', ['--json']))).toHaveLength(2);

    const feed = await runCollected(f.api, 'jobs', ['feed']);
    expect(query(f.calls.at(-1)!.path)).toEqual({ limit: '50' });
    expect(feed).toMatch(/^Posted\s+Company\s+Title\s+Locations\s+State\s+Req\s+Id/);
    expect(feed).toContain('2026-11-01  Acme');
    expect(feed).toContain('4242424242');
    await runCollected(f.api, 'jobs', ['feed', '--all', '--since', '2026-10-01', '--limit', '10']);
    expect(query(f.calls.at(-1)!.path)).toEqual({ limit: '10', since: '2026-10-01', matchesOnly: '0', active: '0', includeHidden: '1' });
    await expect(runCollected(f.api, 'jobs', ['feed', '--since', 'yesterday'])).rejects.toThrow(/--since must be YYYY-MM-DD/);
    await expect(runCollected(f.api, 'jobs', ['nope'])).rejects.toThrow(/unknown: jobs nope/);
  });

  it('searches both lists by default, one with a flag, and dedupes', async () => {
    const f = jobsApi();
    const out = await runCollected(f.api, 'jobs', ['search', 'software', 'intern', '--state', 'oa,applied']);
    const paths = f.calls.map((c) => c.path);
    expect(paths).toContain(`/api/jobs/tracked?${new URLSearchParams({ query: 'software intern', state: 'oa,applied', limit: '50' })}`);
    expect(paths).toContain(`/api/jobs?${new URLSearchParams({ query: 'software intern', state: 'oa,applied', limit: '50', matchesOnly: '0', active: '0', includeHidden: '1' })}`);
    const json = JSON.parse(await runCollected(f.api, 'jobs', ['search', 'software', '--json'])) as Job[];
    expect(json.map((j) => j.id)).toEqual([MANUAL.id, STARRED.id, FEED.id]); // tracked first, STARRED not twice
    expect(out).toContain(FEED.id);
    f.calls.length = 0;
    await runCollected(f.api, 'jobs', ['search', 'acme', '--tracked']);
    expect(f.calls.map((c) => new URL(c.path, 'http://x').pathname)).toEqual(['/api/jobs/tracked']);
    f.calls.length = 0;
    await runCollected(f.api, 'jobs', ['search', 'acme', '--feed', '--limit', '3']);
    expect(f.calls.map((c) => new URL(c.path, 'http://x').pathname)).toEqual(['/api/jobs']);
    expect(query(f.calls[0]!.path).limit).toBe('3');
    await expect(runCollected(f.api, 'jobs', ['search'])).rejects.toThrow(/usage: jobs search/);
    await expect(runCollected(f.api, 'jobs', ['search', 'x', '--tracked', '--feed'])).rejects.toThrow(/not both/);
  });

  it('finds by req id or URL and shows every field', async () => {
    const f = jobsApi();
    const byReq = await runCollected(f.api, 'jobs', ['find', '4242424242']);
    expect(f.calls[0]!.path).toBe('/api/jobs/find?req=4242424242');
    expect(byReq).toContain('Acme · Software Engineering Intern');
    expect(byReq).toContain('req id     4242424242');
    expect(byReq).toContain(`id         ${FEED.id}`);
    const lastFind = () => query(f.calls.filter((c) => c.path.startsWith('/api/jobs/find')).at(-1)!.path);
    await runCollected(f.api, 'jobs', ['find', 'http://www.boards.greenhouse.io/acme/jobs/4242424242?gh_src=x']);
    expect(lastFind()).toEqual({ url: 'http://www.boards.greenhouse.io/acme/jobs/4242424242?gh_src=x' });
    await runCollected(f.api, 'jobs', ['find', 'boards.greenhouse.io/acme/jobs/4242424242']);
    expect(lastFind()).toEqual({ url: 'boards.greenhouse.io/acme/jobs/4242424242' });
    expect(await runCollected(f.api, 'jobs', ['find', 'R999'])).toBe('no match');
    expect(await runCollected(f.api, 'jobs', ['find', 'R999', '--json'])).toBe('[]');
    await expect(runCollected(f.api, 'jobs', ['find'])).rejects.toThrow(/usage: jobs find/);

    const show = await runCollected(f.api, 'jobs', ['show', MANUAL.id]);
    expect(f.calls.at(-2)!.path).toBe(`/api/jobs/${encodeURIComponent(MANUAL.id)}`);
    expect(show).toContain('state      interviewing (Interviewing)');
    expect(show).toContain('req id     G-77');
    expect(show).toContain('applied    2026-10-20');
    expect(show).toContain('next       send thank-you by 2026-11-07');
    expect(show).toContain(`resume     ${MANUAL.resumePath} (exists)`);
    expect(show).toContain('locations  Boston, MA');
    expect(show).toMatch(/updated    \w{3}, \w{3} \d+, \d+:\d{2} [AP]M/);
    expect(show).toContain('  notes:\n    referral from J\n    onsite is a take-home');
    expect(show).not.toContain('url'); // empty fields are left out
    const feedShow = await runCollected(f.api, 'jobs', ['show', FEED.id]);
    expect(feedShow).toContain('url        https://boards.greenhouse.io/acme/jobs/4242424242');
    expect(feedShow).toContain('active     yes');
    expect(feedShow).not.toContain('(exists)');
    await expect(runCollected(f.api, 'jobs', ['show', 'manual:nope'])).rejects.toThrow(/404 job not found/);
    expect(JSON.parse(await runCollected(f.api, 'jobs', ['show', MANUAL.id, '--json'])).id).toBe(MANUAL.id);
  });

  it('adds a job with every field, forces past a duplicate, and explains a 409', async () => {
    const f = jobsApi();
    const out = await runCollected(f.api, 'jobs', ['add', 'Acme', 'SWE Intern', '--url', 'https://acme.test/jobs/1', '--req', 'R-1', '--location', 'NYC', '--location', 'Remote', '--state', 'OA', '--applied', '2026-11-01', '--resume', '~/resumes/acme.pdf', '--notes', 'career fair', '--next', 'follow up', '--next-at', '2026-11-10']);
    expect(f.writes()).toEqual([{ method: 'POST', path: '/api/jobs', body: { company: 'Acme', title: 'SWE Intern', url: 'https://acme.test/jobs/1', locations: ['NYC', 'Remote'], state: 'oa', notes: 'career fair', nextAction: 'follow up', nextActionAt: '2026-11-10', appliedAt: '2026-11-01', resumePath: '~/resumes/acme.pdf', reqId: 'R-1' } }]);
    expect(out).toMatch(/^added: Acme · SWE Intern · oa · req R-1 · manual:new-1 · applied 2026-11-01$/);
    await runCollected(f.api, 'jobs', ['add', 'Beta', 'Intern', '--force']);
    expect(f.writes()[1]).toEqual({ method: 'POST', path: '/api/jobs?force=1', body: { company: 'Beta', title: 'Intern', locations: [] } });
    expect(JSON.parse(await runCollected(f.api, 'jobs', ['add', 'Beta', 'Intern', '--json'])).state).toBe('applied');
    const n = f.writes().length;
    await expect(runCollected(f.api, 'jobs', ['add', 'Acme'])).rejects.toThrow(/usage: jobs add/);
    await expect(runCollected(f.api, 'jobs', ['add', 'Acme', 'Intern', 'extra'])).rejects.toThrow(/usage: jobs add/);
    await expect(runCollected(f.api, 'jobs', ['add', 'Acme', 'Intern', '--applied', 'today'])).rejects.toThrow(/--applied must be YYYY-MM-DD/);
    await expect(runCollected(f.api, 'jobs', ['add', 'Acme', 'Intern', '--state', '!!!'])).rejects.toThrow(/not usable as a stage id/);
    expect(f.writes()).toHaveLength(n); // nothing sent for a refused add

    const dup = jobsApi({ conflict: true });
    const err = await runCollected(dup.api, 'jobs', ['add', 'ACME', 'Intern', '--url', 'https://boards.greenhouse.io/acme/jobs/4242424242']).catch((e: Error) => e.message);
    expect(err).toContain('already here:');
    expect(err).toContain('Acme · Software Engineering Intern');
    expect(err).toContain(`id         ${FEED.id}`);
    expect(err).toContain(`collected jobs set ${FEED.id}`);
    expect(err).toContain('--force');
    expect(dup.writes()).toHaveLength(1);
    const forced = await runCollected(dup.api, 'jobs', ['add', 'ACME', 'Intern', '--force']);
    expect(forced).toContain('added:');
    expect(dup.writes()[1]!.path).toBe('/api/jobs?force=1');
  });

  it('sets a state (any id) or fields alone, and says what changed', async () => {
    const f = jobsApi();
    const out = await runCollected(f.api, 'jobs', ['set', FEED.id, 'OA']);
    expect(f.writes()).toEqual([{ method: 'PATCH', path: `/api/jobs/${encodeURIComponent(FEED.id)}/state`, body: { state: 'oa' } }]);
    expect(out).toBe('Acme · Software Engineering Intern: oa\n  new → oa');
    const fields = await runCollected(f.api, 'jobs', ['set', MANUAL.id, '--notes', 'spoke to recruiter', '--req', 'G-78', '--next', '', '--resume', '/tmp/r.pdf']);
    expect(f.writes()[1]!.body).toEqual({ notes: 'spoke to recruiter', reqId: 'G-78', nextAction: null, resumePath: '/tmp/r.pdf' });
    expect(fields).toContain('notes: referral from J onsite is a take-home → spoke to recruiter'.replace('J onsite', 'J\nonsite'));
    expect(fields).toContain('next: send thank-you → (none)');
    expect(fields).toContain('req id: G-77 → G-78');
    expect(fields).toContain('resume: ');
    await runCollected(f.api, 'jobs', ['set', MANUAL.id, 'hidden', '--applied', '2026-10-01', '--next-at', '2026-12-01']);
    expect(f.writes()[2]!.body).toEqual({ state: 'hidden', appliedAt: '2026-10-01', nextActionAt: '2026-12-01' });
    expect(await runCollected(f.api, 'jobs', ['set', MANUAL.id, 'interviewing'])).toContain('(no change)');
    const n = f.writes().length;
    await expect(runCollected(f.api, 'jobs', ['set', MANUAL.id])).rejects.toThrow(/nothing to change/);
    await expect(runCollected(f.api, 'jobs', ['set'])).rejects.toThrow(/usage: jobs set/);
    await expect(runCollected(f.api, 'jobs', ['set', MANUAL.id, 'oa', 'extra'])).rejects.toThrow(/usage: jobs set/);
    await expect(runCollected(f.api, 'jobs', ['set', MANUAL.id, '--next-at', 'soon'])).rejects.toThrow(/--next-at must be YYYY-MM-DD/);
    await expect(runCollected(f.api, 'jobs', ['set', 'manual:nope', 'oa'])).rejects.toThrow(/404/);
    expect(f.writes()).toHaveLength(n);
  });

  it('removes manual entries only, and marks feed jobs seen', async () => {
    const f = jobsApi();
    expect(await runCollected(f.api, 'jobs', ['rm', MANUAL.id])).toBe(`removed: Gamma · Platform Intern · interviewing · req G-77 · ${MANUAL.id}`);
    expect(f.writes()).toEqual([{ method: 'DELETE', path: `/api/jobs/${encodeURIComponent(MANUAL.id)}`, body: undefined }]);
    await expect(runCollected(f.api, 'jobs', ['rm', FEED.id])).rejects.toThrow(new RegExp(`cannot be removed; \`collected jobs set ${FEED.id.replace(/:/g, ':')} hidden\``));
    await expect(runCollected(f.api, 'jobs', ['rm'])).rejects.toThrow(/usage: jobs rm/);
    expect(f.writes()).toHaveLength(1);

    expect(await runCollected(f.api, 'jobs', ['seen'])).toBe('marked 2 jobs seen');
    expect(f.writes()[1]).toEqual({ method: 'PATCH', path: '/api/jobs/seen', body: { ids: [FEED.id, UNSEEN.id] } });
    expect(await runCollected(f.api, 'jobs', ['seen', 'a', 'b', 'c'])).toBe('marked 3 jobs seen');
    expect(f.writes()[2]!.body).toEqual({ ids: ['a', 'b', 'c'] });
  });

  it('edits the stage list whole: add, rm, rename, move', async () => {
    const f = jobsApi();
    const list = await runCollected(f.api, 'jobs', ['stages']);
    expect(list).toMatch(/^Id\s+Label\s+Kind\s+Stamps applied/);
    expect(list).toContain('screen        Screen        open    yes');
    expect(list).toMatch(/rejected      Rejected      closed$/m);
    expect(list).toContain('feed markers, not stages');
    expect(JSON.parse(await runCollected(f.api, 'jobs', ['stages', '--json']))).toHaveLength(7);

    const ids = () => f.stages.map((s) => s.id);
    await runCollected(f.api, 'jobs', ['stages', 'add', 'OA', '--label', 'Online assessment', '--after', 'applied']);
    expect(f.writes().at(-1)).toMatchObject({ method: 'PUT', path: '/api/jobs/stages' });
    expect(ids()).toEqual(['applied', 'oa', 'screen', 'interviewing', 'offer', 'rejected', 'ghosted', 'withdrawn']);
    expect(f.stages[1]).toEqual({ id: 'oa', label: 'Online assessment', kind: 'open', appliedStage: false });
    await runCollected(f.api, 'jobs', ['stages', 'add', 'take', 'home', '--closed']);
    expect(f.stages.at(-1)).toEqual({ id: 'take home', label: 'Take home', kind: 'closed' });
    await expect(runCollected(f.api, 'jobs', ['stages', 'add', 'hidden'])).rejects.toThrow(/feed marker/);
    await expect(runCollected(f.api, 'jobs', ['stages', 'add', 'applied'])).rejects.toThrow(/already there/);
    await expect(runCollected(f.api, 'jobs', ['stages', 'add', 'x', '--after', 'nope'])).rejects.toThrow(/no stage "nope"/);
    await expect(runCollected(f.api, 'jobs', ['stages', 'add'])).rejects.toThrow(/usage: jobs stages add/);

    await runCollected(f.api, 'jobs', ['stages', 'rm', 'take home']);
    expect(ids()).not.toContain('take home');
    await expect(runCollected(f.api, 'jobs', ['stages', 'rm', 'nope'])).rejects.toThrow(/no stage "nope"/);

    expect(await runCollected(f.api, 'jobs', ['stages', 'rename', 'offer', 'Offer', 'received'])).toBe('stage offer: "Offer" → "Offer received"');
    expect(f.stages.find((s) => s.id === 'offer')).toEqual({ id: 'offer', label: 'Offer received', kind: 'open', appliedStage: true });
    await expect(runCollected(f.api, 'jobs', ['stages', 'rename', 'offer'])).rejects.toThrow(/usage: jobs stages rename/);

    await runCollected(f.api, 'jobs', ['stages', 'move', 'oa', '--after', 'offer']);
    expect(ids()).toEqual(['applied', 'screen', 'interviewing', 'offer', 'oa', 'rejected', 'ghosted', 'withdrawn']);
    await runCollected(f.api, 'jobs', ['stages', 'move', 'oa', '--first']);
    expect(ids()[0]).toBe('oa');
    await expect(runCollected(f.api, 'jobs', ['stages', 'move', 'oa'])).rejects.toThrow(/usage: jobs stages move/);
    await expect(runCollected(f.api, 'jobs', ['stages', 'move', 'oa', '--after', 'oa'])).rejects.toThrow(/after itself/);
    await expect(runCollected(f.api, 'jobs', ['stages', 'drop', 'oa'])).rejects.toThrow(/jobs stages add/);
    expect(f.writes().every((w) => w.method === 'PUT' && w.path === '/api/jobs/stages')).toBe(true);
  });
});
