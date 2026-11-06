import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { isReservedStage, stageIdFrom, stageLabel, type Course, type CourseGrades, type EffectiveItem, type Job, type JobStage, type Meeting, type Source } from '@collected/shared';
import type { RunOutcome } from '../ingest/runner.js';
import { ApiError, type CommandApi as Api } from './api.js';
import { defaultSelection, describeImport, enrollmentTable, importEnrollments, listEnrollments, pickEnrollments } from './enroll.js';
import { dayOf, describeSchedule, htmlToText, linkedFiles, localDate, parseDuration, parseMeetings, parseWhen, table, when } from './format.js';

/*
 * `collected <command>`: the dashboard from a terminal, for a person or an agent. Reads print a table, or JSON with
 * --json. Writes change one thing and say what it was before. Everything goes through collected's API; the Canvas
 * commands go through its read-only proxy (GET /api/canvas/raw), so no Canvas credential lives on this machine.
 */

export interface Out {
  json: unknown;
  text: string;
}

export const HELP = `collected: your classes, assignments and calendar from the terminal (add --json to any read)

  Look
    courses                                   every course: role, schedule, hotlinks
    courses import [--list | --all | --term 2026-fall | <rows or Canvas ids>]   turn Canvas enrollments into courses (default: the current term)
    course <course>                           one course: schedule, links, notes, grade, what's due, dates
    assignments [--course C] [--days 14] [--all]   what's due (open, plus overdue from the last 14 days); --all = everything
    agenda [--days 7]                         events, due dates and tasks by day
    todo                                      open tasks and open assignments
    grades [course]                           current grade per course, or one course's categories
    announcements [--course C] [--limit 5]
    dates [--course C]                        exams, quizzes, finals, cancelled or virtual sessions
    sources                                   sync status of Canvas, Gradescope, Google Calendar, Todoist, Google Tasks, jobs

  Jobs (the feed and the applications tracker; ids are printed in full)
    jobs [--state applied,screen] [--limit 20]    everything tracked, most recently touched first
    jobs feed [--all] [--limit 50] [--since YYYY-MM-DD]   the matched feed, newest first (--all: every listing, hidden and inactive too)
    jobs search "<text>" [--tracked | --feed] [--state a,b] [--limit N]   company, title, location, notes or an exact req id; every word must match
    jobs find <req-id | url>                  the job with that requisition id or posting URL (tracking parameters ignored), or "no match"
    jobs show <id>                            every field: notes, resume, req id, next action, timestamps
    jobs add "<company>" "<title>" [--url U] [--req R] [--location L]... [--state applied] [--applied YYYY-MM-DD] [--resume PATH] [--notes N] [--next "what" --next-at D] [--force]
                                              a job by hand; refused with the existing job when the URL or req id is already here (--force adds anyway)
    jobs set <id> [<state>] [--notes N] [--next "what" --next-at D] [--applied D] [--resume PATH] [--req R]   any stage id; a new one becomes a board column
    jobs rm <id>                              remove a hand-added job (a feed job is hidden instead: jobs set <id> hidden)
    jobs seen [<id>...]                       mark feed jobs seen (default: every unseen match)
    jobs stages                               the tracker's stages in order;  jobs stages add <id> [--label L] [--closed] [--after <id>]
    jobs stages rm <id> | rename <id> "<label>" | move <id> --after <other>

  Change
    task add "<text>" [--to todoist|gtasks] [--due YYYY-MM-DD]   a task in the default to-do app (Todoist parses "fri 5pm #School" itself)
    task done <task-id>                       close a Todoist or Google Tasks task (ids from "todo --json")
    done <item-id> [--undo]                   mark an assignment done on the dashboard only
    link add <course> <label> <url>           a course hotlink;  link rm <course> <label>
    schedule set <course> <kind> "<days> <start>-<end> [@ room]" [...]   e.g. schedule set enme480 lecture "mon,wed 14:00-14:50 @ CHE 2110"
    schedule rm <course> <kind>
    notes set <course> "<text>"               notes clear <course>
    date add <course> <exam|quiz|final|cancelled|virtual|other> "<title>" <YYYY-MM-DD> [--start HH:MM --end HH:MM --location L --note N --session lecture]
    date rm <id>
    event add "<title>" --at "<when>" [--for 1h30m | --end "<when>"] [--calendar <id or name>] [--location L] [--note N]   a Google Calendar event
    event add "<title>" --on YYYY-MM-DD [--until YYYY-MM-DD] [--calendar …]   an all-day event;  <when> is "2026-11-03 14:00", "today 14:00", "tomorrow 9:30" or "fri 17:00"
    event calendars                           the connected Google calendars, with the default
    resync [canvas|gradescope|gcal|gcal_ical|todoist|gtasks|jobs|all]   run a sync now and wait for it

  Canvas (read-only)
    canvas ls <course> [modules|files|pages|assignments|announcements]
    canvas show <course> syllabus | page <slug> | assignment <id> | announcement <id>    full text, not truncated; lists linked file ids
    canvas get "<api path>" [--all]           any Canvas API GET, e.g. "/api/v1/courses/123/quizzes"
    pull <canvas-file-id> --to <folder>       download one file (atomic, deduped, remembered by the file sync)

  A <course> is its code (enme480), the digits (480), or the full id.`;

const DONE = (i: EffectiveItem): string => (i.effectiveDone ? (i.status === 'open' ? 'done' : i.status) : i.status === 'open' && i.dueAt && new Date(i.dueAt) < new Date() ? 'overdue' : i.status);
const q = (params: Record<string, string | number | undefined>): string => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') u.set(k, String(v));
  return u.toString();
};
const addDays = (d: Date, n: number): Date => new Date(d.getTime() + n * 86_400_000);
const startOfToday = (): Date => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

export async function resolveCourse(api: Api, key: string | undefined): Promise<Course> {
  if (!key) throw new Error('which course? give its code, e.g. enme480');
  const all = await api.get<Course[]>('/api/courses');
  const k = key.toLowerCase();
  const digits = /^\d{3,}$/.test(k); // "480" means ENME480; a shorter or non-numeric suffix matches too much
  const hits = all.filter((c) => c.id === key || c.code.toLowerCase() === k || (digits && c.code.toLowerCase().endsWith(k)));
  const live = hits.filter((c) => !c.archived);
  const pick = live.length ? live : hits;
  if (pick.length === 1) return pick[0]!;
  throw new Error(pick.length ? `"${key}" matches ${pick.map((c) => c.code).join(', ')}; be more specific` : `no course "${key}". Courses: ${all.filter((c) => !c.archived).map((c) => c.code).join(', ')}`);
}

const itemRow = (i: EffectiveItem) => [when(i.dueAt ?? i.startsAt), i.course?.code ?? '', i.title, DONE(i), i.points ?? '', i.id];

/* ---------- reads ---------- */

async function courses(api: Api, args: string[]): Promise<Out> {
  if (args[0] === 'import') return coursesImport(api, args.slice(1));
  if (args.length) throw new Error('courses [--json] | courses import [--list | --all | --term <slug> | <row or Canvas id>...]');
  const all = (await api.get<Course[]>('/api/courses')).filter((c) => !c.archived);
  return { json: all, text: table(['Course', 'Role', 'Schedule', 'Links', 'Id'], all.map((c) => [c.code, c.role, describeSchedule(c.schedule), c.links.map((l) => l.label).join(', '), c.id]), 90) };
}

/**
 * `courses import`: what Canvas says you are enrolled in, and the import the dashboard's first-run card does. With
 * nothing else it imports the current term's enrollments that are not courses yet; `--all` every active one;
 * `--term 2026-fall` one term; row numbers or Canvas ids pick. `--list` only prints the list. After an import the
 * Canvas sync runs so the new courses fill (a server starts one of its own; this one waits for the lock or the run).
 */
async function coursesImport(api: Api, args: string[]): Promise<Out> {
  const { values, positionals } = parseArgs({ args, options: { list: { type: 'boolean' }, all: { type: 'boolean' }, term: { type: 'string' } }, allowPositionals: true });
  const list = await listEnrollments(api);
  if (values.list) return { json: list, text: `${enrollmentTable(list, new Set(defaultSelection(list).map((e) => e.canvasCourseId)))}\n* = what \`collected courses import\` takes by default (the current term, not yet here)` };
  const picks = positionals.length ? pickEnrollments(list, positionals) : values.all ? list : values.term ? list.filter((e) => e.suggested.term === values.term) : defaultSelection(list);
  const fresh = picks.filter((e) => !e.trackedAs);
  if (!fresh.length) return { json: { created: [], skipped: [] }, text: picks.length ? 'nothing to import: every course picked is already here' : `nothing to import${values.term ? ` for term ${values.term}` : ''}; \`collected courses import --list\` shows the enrollments` };
  const r = await importEnrollments(api, fresh);
  let text = describeImport(r);
  if (r.created.length) {
    const sync = await api.send<{ outcome: RunOutcome }>('POST', '/api/sources/canvas/sync').catch((e: Error) => ({ outcome: { ok: false as const, error: e.message, status: 'error' as const, ms: 0 } }));
    text += `\n${describeOutcome('canvas', sync.outcome)}`;
  }
  return { json: r, text };
}

/** One line for a sync outcome, as `resync` prints it. */
const describeOutcome = (id: string, o: RunOutcome): string => (o.ok ? `${id} synced: ${JSON.stringify(o.result.counts ?? {})}` : 'skipped' in o ? `${id} sync skipped: ${o.skipped}` : `${id} sync ${o.status}: ${o.error}`);

async function course(api: Api, args: string[]): Promise<Out> {
  const c = await resolveCourse(api, args[0]);
  const now = new Date();
  const [grades, upcoming, dates] = await Promise.all([
    api.get<Record<string, { current: number | null; canvasCurrent: number | null; graded: number; total: number }>>('/api/grades').catch(() => ({}) as Record<string, never>),
    api.get<EffectiveItem[]>(`/api/items?${q({ kind: 'assignment', course: c.id, from: addDays(now, -14).toISOString(), to: addDays(now, 21).toISOString(), includeInformational: 1 })}`),
    api.get<EffectiveItem[]>(`/api/items?${q({ source: 'manual', kind: 'event', course: c.id, includeDone: 1, limit: 200 })}`),
  ]);
  const g = grades[c.id];
  const text = [
    `${c.code}${c.name ? ` · ${c.name}` : ''} · ${c.role} · ${c.id}`,
    `Schedule: ${describeSchedule(c.schedule)}`,
    `Links:    ${c.links.map((l) => `${l.label} ${l.url}`).join(' · ') || '(none)'}`,
    `Grade:    ${g?.current != null ? `${g.current.toFixed(1)}% (${g.graded} of ${g.total} graded${g.canvasCurrent != null ? `, Canvas says ${g.canvasCurrent.toFixed(1)}%` : ''})` : 'nothing graded yet'}`,
    `Canvas:   ${c.canvasCourseId ?? '(not matched)'} · Gradescope: ${c.gradescopeCourseId ?? '(not matched)'} · submits via ${c.submitsVia}`,
    ...(c.notes ? [`Notes:    ${c.notes}`] : []),
    '',
    'Due (last 2 weeks → next 3):',
    table(['Due', 'Course', 'Assignment', 'Status', 'Pts', 'Id'], upcoming.map(itemRow)),
    '',
    'Dates:',
    table(['When', 'Kind', 'Title', 'Id'], dates.map((d) => [d.allDay ? dayOf(d.startsAt) : when(d.startsAt), String((d.raw as { eventKind?: string }).eventKind ?? ''), d.title, d.id])),
  ].join('\n');
  return { json: { course: c, grade: g ?? null, due: upcoming, dates }, text };
}

async function assignments(api: Api, args: string[]): Promise<Out> {
  const { values } = parseArgs({ args, options: { course: { type: 'string' }, days: { type: 'string', default: '14' }, all: { type: 'boolean' } }, allowPositionals: true });
  const c = values.course ? await resolveCourse(api, values.course) : null;
  const now = new Date();
  const params = values.all
    ? { kind: 'assignment', course: c?.id, includeDone: 1, limit: 1000 }
    : { kind: 'assignment', course: c?.id, from: addDays(now, -14).toISOString(), to: addDays(now, Number(values.days) || 14).toISOString() };
  const items = await api.get<EffectiveItem[]>(`/api/items?${q(params)}`);
  return { json: items, text: table(['Due', 'Course', 'Assignment', 'Status', 'Pts', 'Id'], items.map(itemRow)) };
}

async function agenda(api: Api, args: string[]): Promise<Out> {
  const { values } = parseArgs({ args, options: { days: { type: 'string', default: '7' } }, allowPositionals: true });
  const from = startOfToday();
  const items = await api.get<EffectiveItem[]>(`/api/items?${q({ kind: 'event,assignment,task', from: from.toISOString(), to: addDays(from, Number(values.days) || 7).toISOString() })}`);
  const byDay = new Map<string, EffectiveItem[]>();
  // An event happens when it starts; an assignment or task belongs to the day it is due (its start is an unlock date).
  const at = (i: EffectiveItem): string | null => (i.kind === 'event' ? (i.startsAt ?? i.dueAt) : (i.dueAt ?? i.startsAt));
  const today = localDate(from.toISOString());
  for (const i of items) {
    const t = at(i);
    if (!t || localDate(t) < today) continue;
    const k = localDate(t);
    byDay.set(k, [...(byDay.get(k) ?? []), i]);
  }
  const lines: string[] = [];
  for (const [k, list] of [...byDay].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(dayOf(`${k}T12:00:00`));
    for (const i of list.sort((a, b) => (at(a) ?? '').localeCompare(at(b) ?? ''))) {
      const t = i.allDay ? 'all day ' : new Date(at(i)!).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).padStart(8);
      lines.push(`  ${t}  ${i.kind === 'event' ? '' : i.kind === 'task' ? '[task] ' : '[due] '}${i.course ? `${i.course.code} ` : ''}${i.title}`);
    }
  }
  return { json: items, text: lines.join('\n') || '(nothing)' };
}

async function todo(api: Api): Promise<Out> {
  const now = new Date();
  const [tasks, due] = await Promise.all([
    api.get<EffectiveItem[]>(`/api/items?${q({ kind: 'task', limit: 500 })}`),
    api.get<EffectiveItem[]>(`/api/items?${q({ kind: 'assignment', from: addDays(now, -14).toISOString(), to: addDays(now, 14).toISOString() })}`),
  ]);
  const text = ['Assignments', table(['Due', 'Course', 'Assignment', 'Status', 'Pts', 'Id'], due.map(itemRow)), '', 'Tasks', table(['Due', 'Task', 'Labels', 'Id'], tasks.map((t) => [when(t.dueAt), t.title, t.labels.join(', '), t.id]))].join('\n');
  return { json: { assignments: due, tasks }, text };
}

async function grades(api: Api, args: string[]): Promise<Out> {
  if (args[0] && !args[0].startsWith('--')) {
    const c = await resolveCourse(api, args[0]);
    const g = await api.get<CourseGrades>(`/api/grades/${encodeURIComponent(c.id)}`);
    const text = [
      `${c.code}: ${g.current != null ? `${g.current.toFixed(1)}%` : 'nothing graded'} ${g.weighted ? '(weighted)' : '(by points)'}${g.canvas?.currentScore != null ? ` · Canvas ${g.canvas.currentScore}%` : ''}`,
      table(['Category', 'Weight', 'Earned', 'Possible', 'Percent', 'Graded'], g.categories.map((k) => [k.name, k.weight ?? '', k.earned, k.possible, k.percent != null ? `${k.percent.toFixed(1)}%` : '', `${k.graded}/${k.total}`])),
    ].join('\n');
    return { json: g, text };
  }
  const [all, cs] = await Promise.all([api.get<Record<string, { current: number | null; weighted: boolean; graded: number; total: number; canvasCurrent: number | null }>>('/api/grades'), api.get<Course[]>('/api/courses')]);
  const code = new Map(cs.map((c) => [c.id, c.code]));
  return { json: all, text: table(['Course', 'Current', 'Canvas', 'Graded'], Object.entries(all).map(([id, g]) => [code.get(id) ?? id, g.current != null ? `${g.current.toFixed(1)}%` : '', g.canvasCurrent != null ? `${g.canvasCurrent.toFixed(1)}%` : '', `${g.graded}/${g.total}`])) };
}

async function announcements(api: Api, args: string[]): Promise<Out> {
  const { values } = parseArgs({ args, options: { course: { type: 'string' }, limit: { type: 'string', default: '5' } }, allowPositionals: true });
  const c = values.course ? await resolveCourse(api, values.course) : null;
  const items = (await api.get<EffectiveItem[]>(`/api/items?${q({ kind: 'announcement', course: c?.id, limit: 200 })}`)).sort((a, b) => (b.startsAt ?? '').localeCompare(a.startsAt ?? '')).slice(0, Number(values.limit) || 5);
  return { json: items, text: items.map((a) => `${a.course?.code ?? ''} · ${when(a.startsAt)} · ${a.title}\n${(a.description ?? '').trim()}\n${a.url ?? ''}`).join('\n\n') || '(none)' };
}

async function dates(api: Api, args: string[]): Promise<Out> {
  const { values } = parseArgs({ args, options: { course: { type: 'string' } }, allowPositionals: true });
  const c = values.course ? await resolveCourse(api, values.course) : null;
  const items = await api.get<EffectiveItem[]>(`/api/items?${q({ source: 'manual', kind: 'event', course: c?.id, includeDone: 1, limit: 500 })}`);
  return { json: items, text: table(['When', 'Course', 'Kind', 'Title', 'Id'], items.map((d) => [d.allDay ? dayOf(d.startsAt) : when(d.startsAt), d.course?.code ?? '', String((d.raw as { eventKind?: string }).eventKind ?? ''), d.title, d.id])) };
}

async function sources(api: Api): Promise<Out> {
  const all = await api.get<Source[]>('/api/sources');
  return { json: all, text: table(['Source', 'Status', 'Last success', 'Error'], all.map((s) => [s.id, s.running ? `${s.status} (running)` : s.status, when(s.lastSuccessAt), s.lastError ?? ''])) };
}

/* ---------- jobs ---------- */

const JOBS_USAGE = 'jobs [--state a,b] [--limit N] | jobs feed | jobs search "<text>" | jobs find <req-id|url> | jobs show <id> | jobs add … | jobs set <id> [<state>] … | jobs rm <id> | jobs seen [<id>…] | jobs stages …';
const isoDay = (v: string | undefined, flag: string): string | undefined => {
  if (v !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`${flag} must be YYYY-MM-DD`);
  return v;
};
const nextOf = (j: Job): string => (j.nextAction ? `${j.nextAction}${j.nextActionAt ? ` (${j.nextActionAt})` : ''}` : '');
const jobLine = (j: Job): string => `${j.company} · ${j.title} · ${j.state}${j.reqId ? ` · req ${j.reqId}` : ''} · ${j.id}`;
const jobsTable = (list: Job[]): string => table(['Company', 'Title', 'State', 'Applied', 'Req', 'Next', 'Id'], list.map((j) => [j.company, j.title, j.state, j.appliedAt ?? '', j.reqId ?? '', nextOf(j), j.id]), 40, true);
const feedTable = (list: Job[]): string => table(['Posted', 'Company', 'Title', 'Locations', 'State', 'Req', 'Id'], list.map((j) => [j.postedAt?.slice(0, 10) ?? '', j.company, j.title, j.locations.join('; '), j.state, j.reqId ?? '', j.id]), 40, true);
const looksLikeUrl = (s: string): boolean => /^https?:\/\//i.test(s) || /^[a-z0-9.-]+\.[a-z]{2,}\//i.test(s);
/** `--state a,b` as the server wants it: lowercase ids, no blanks. */
const stateList = (v: string | undefined): string | undefined => v?.split(',').map((x) => stageIdFrom(x)).filter(Boolean).join(',') || undefined;

/** Everything about one job, for `jobs show` and the 409 on `jobs add`. The resume path is printed, never opened. */
function describeJob(j: Job, stages: readonly JobStage[]): string {
  const row = (k: string, v: string | null | undefined) => (v ? `  ${k.padEnd(11)}${v}` : null);
  const lines = [
    `${j.company} · ${j.title}`,
    row('id', j.id),
    row('source', j.source),
    row('state', `${j.state} (${stageLabel(stages, j.state)})`),
    row('url', j.url),
    row('req id', j.reqId),
    row('locations', j.locations.join('; ')),
    row('terms', j.terms.join(', ')),
    row('category', j.category),
    row('sponsor', j.sponsorship),
    row('applied', j.appliedAt),
    row('next', j.nextAction ? `${j.nextAction}${j.nextActionAt ? ` by ${j.nextActionAt}` : ''}` : null),
    row('resume', j.resumePath ? `${j.resumePath}${existsSync(j.resumePath.replace(/^~(?=$|\/)/, process.env.HOME ?? '~')) ? ' (exists)' : ''}` : null),
    row('posted', when(j.postedAt)),
    row('first seen', when(j.firstSeenAt)),
    row('seen', when(j.seenAt)),
    row('updated', when(j.stateUpdatedAt ?? j.updatedAt)),
    row('active', j.source === 'manual' ? null : j.active ? 'yes' : 'no'),
    j.notes ? `  notes:\n${j.notes.replace(/^/gm, '    ')}` : null,
  ];
  return lines.filter((l): l is string => l !== null).join('\n');
}

const getStages = async (api: Api): Promise<JobStage[]> => (await api.get<{ stages: JobStage[] }>('/api/jobs/stages')).stages;

async function jobs(api: Api, args: string[]): Promise<Out> {
  const sub = args[0];
  const rest = args.slice(1);
  switch (sub) {
    case 'feed': {
      const { values } = parseArgs({ args: rest, options: { all: { type: 'boolean' }, limit: { type: 'string', default: '50' }, since: { type: 'string' } }, allowPositionals: true });
      isoDay(values.since, '--since');
      const list = await api.get<Job[]>(`/api/jobs?${q({ limit: values.limit, since: values.since, ...(values.all ? { matchesOnly: 0, active: 0, includeHidden: 1 } : {}) })}`);
      return { json: list, text: feedTable(list) };
    }
    case 'search': {
      const { values, positionals } = parseArgs({ args: rest, options: { tracked: { type: 'boolean' }, feed: { type: 'boolean' }, state: { type: 'string' }, limit: { type: 'string', default: '50' } }, allowPositionals: true });
      const text = positionals.join(' ').trim();
      if (!text) throw new Error('usage: jobs search "<text>" [--tracked | --feed] [--state a,b] [--limit N]');
      if (values.tracked && values.feed) throw new Error('--tracked or --feed, not both (the default searches both)');
      const state = stateList(values.state);
      const tracked = values.feed ? [] : await api.get<Job[]>(`/api/jobs/tracked?${q({ query: text, state, limit: values.limit })}`);
      const feed = values.tracked ? [] : await api.get<Job[]>(`/api/jobs?${q({ query: text, state, limit: values.limit, matchesOnly: 0, active: 0, includeHidden: 1 })}`);
      const seen = new Set(tracked.map((j) => j.id));
      const list = [...tracked, ...feed.filter((j) => !seen.has(j.id))].slice(0, Number(values.limit) || 50);
      return { json: list, text: jobsTable(list) };
    }
    case 'find': {
      const key = rest.join(' ').trim();
      if (!key) throw new Error('usage: jobs find <req-id | url>');
      const list = await api.get<Job[]>(`/api/jobs/find?${q(looksLikeUrl(key) ? { url: key } : { req: key })}`);
      if (!list.length) return { json: [], text: 'no match' };
      const stages = await getStages(api);
      return { json: list, text: list.map((j) => describeJob(j, stages)).join('\n\n') };
    }
    case 'show': {
      const id = rest[0];
      if (!id) throw new Error('usage: jobs show <id>');
      const [j, stages] = await Promise.all([api.get<Job>(`/api/jobs/${encodeURIComponent(id)}`), getStages(api)]);
      return { json: j, text: describeJob(j, stages) };
    }
    case 'add':
      return jobsAdd(api, rest);
    case 'set':
      return jobsSet(api, rest);
    case 'rm': {
      const id = rest[0];
      if (!id) throw new Error('usage: jobs rm <id>   (a hand-added job; a feed job is hidden with `jobs set <id> hidden`)');
      if (!id.startsWith('manual:')) throw new Error(`${id} came from the feed and cannot be removed; \`collected jobs set ${id} hidden\` takes it out of the feed`);
      const j = await api.get<Job>(`/api/jobs/${encodeURIComponent(id)}`);
      await api.send('DELETE', `/api/jobs/${encodeURIComponent(id)}`);
      return { json: { removed: j }, text: `removed: ${jobLine(j)}` };
    }
    case 'seen': {
      const ids = rest.length ? rest : (await api.get<Job[]>('/api/jobs?limit=1000')).filter((j) => !j.seenAt).map((j) => j.id);
      if (!ids.length) return { json: { ids: [] }, text: 'nothing unseen' };
      await api.send('PATCH', '/api/jobs/seen', { ids });
      return { json: { ids }, text: `marked ${ids.length} job${ids.length === 1 ? '' : 's'} seen` };
    }
    case 'stages':
      return jobsStages(api, rest);
    default: {
      if (sub && !sub.startsWith('--')) throw new Error(`unknown: jobs ${sub}\n${JOBS_USAGE}`);
      const { values } = parseArgs({ args, options: { state: { type: 'string' }, limit: { type: 'string', default: '20' } }, allowPositionals: true });
      const list = await api.get<Job[]>(`/api/jobs/tracked?${q({ state: stateList(values.state), limit: values.limit })}`);
      return { json: list, text: jobsTable(list) };
    }
  }
}

/** The one-line body for `jobs add` and `jobs set`: only the flags that were given. */
function trackerFields(values: { notes?: string; next?: string; 'next-at'?: string; applied?: string; resume?: string; req?: string }): Record<string, string | null> {
  const body: Record<string, string | null> = {};
  if (values.notes !== undefined) body.notes = values.notes;
  if (values.next !== undefined) body.nextAction = values.next || null;
  if (values['next-at'] !== undefined) body.nextActionAt = isoDay(values['next-at'] || undefined, '--next-at') ?? null;
  if (values.applied !== undefined) body.appliedAt = isoDay(values.applied || undefined, '--applied') ?? null;
  if (values.resume !== undefined) body.resumePath = values.resume || null;
  if (values.req !== undefined) body.reqId = values.req.trim() || null;
  return body;
}

const TRACKER_OPTIONS = { notes: { type: 'string' }, next: { type: 'string' }, 'next-at': { type: 'string' }, applied: { type: 'string' }, resume: { type: 'string' }, req: { type: 'string' } } as const;

async function jobsAdd(api: Api, args: string[]): Promise<Out> {
  const { values, positionals } = parseArgs({ args, options: { ...TRACKER_OPTIONS, url: { type: 'string' }, location: { type: 'string', multiple: true }, state: { type: 'string' }, force: { type: 'boolean' } }, allowPositionals: true });
  const [company, title] = positionals;
  if (!company || !title || positionals.length > 2) throw new Error('usage: jobs add "<company>" "<title>" [--url U] [--req R] [--location L]... [--state S] [--applied YYYY-MM-DD] [--resume PATH] [--notes N] [--next "what" --next-at D] [--force]');
  const state = values.state ? stageIdFrom(values.state) : undefined;
  if (values.state && !state) throw new Error(`"${values.state}" is not usable as a stage id (lowercase letters, digits, spaces, _ / or -)`);
  const body = { company, title, ...(values.url ? { url: values.url } : {}), locations: values.location ?? [], ...(state ? { state } : {}), ...trackerFields(values) };
  try {
    const j = await api.send<Job>('POST', `/api/jobs${values.force ? '?force=1' : ''}`, body);
    return { json: j, text: `added: ${jobLine(j)}${j.appliedAt ? ` · applied ${j.appliedAt}` : ''}` };
  } catch (e) {
    const existing = e instanceof ApiError && e.status === 409 ? (e.body as { existing?: Job } | undefined)?.existing : undefined;
    if (!existing) throw e;
    const stages = await getStages(api).catch(() => [] as JobStage[]);
    throw new Error(`already here:\n${describeJob(existing, stages)}\n\nnothing added. \`collected jobs set ${existing.id} …\` edits it; \`collected jobs add … --force\` adds a second entry anyway.`);
  }
}

async function jobsSet(api: Api, args: string[]): Promise<Out> {
  const { values, positionals } = parseArgs({ args, options: TRACKER_OPTIONS, allowPositionals: true });
  const [id, rawState, extra] = positionals;
  if (!id || extra !== undefined) throw new Error('usage: jobs set <id> [<state>] [--notes N] [--next "what" --next-at D] [--applied D] [--resume PATH] [--req R]');
  const state = rawState !== undefined ? stageIdFrom(rawState) : undefined;
  if (rawState !== undefined && !state) throw new Error(`"${rawState}" is not usable as a stage id (lowercase letters, digits, spaces, _ / or -)`);
  const body = { ...(state ? { state } : {}), ...trackerFields(values) };
  if (!Object.keys(body).length) throw new Error('nothing to change: give a state or one of --notes --next --next-at --applied --resume --req');
  const before = await api.get<Job>(`/api/jobs/${encodeURIComponent(id)}`);
  const j = await api.send<Job>('PATCH', `/api/jobs/${encodeURIComponent(id)}/state`, body);
  const changed: string[] = [];
  if (state && before.state !== j.state) changed.push(`${before.state} → ${j.state}`);
  for (const [k, label] of [['notes', 'notes'], ['nextAction', 'next'], ['nextActionAt', 'next-at'], ['appliedAt', 'applied'], ['resumePath', 'resume'], ['reqId', 'req id']] as const) {
    if (k in body && before[k] !== j[k]) changed.push(`${label}: ${before[k] ?? '(none)'} → ${j[k] ?? '(none)'}`);
  }
  return { json: j, text: `${j.company} · ${j.title}: ${j.state}${j.nextAction ? ` · next: ${j.nextAction}${j.nextActionAt ? ` by ${j.nextActionAt}` : ''}` : ''}${changed.length ? `\n  ${changed.join('\n  ')}` : '\n  (no change)'}` };
}

/** The stage list is edited whole: read, change one thing, PUT it back. The server refuses to drop a stage with jobs in it. */
async function jobsStages(api: Api, args: string[]): Promise<Out> {
  const sub = args[0];
  const stagesTable = (stages: JobStage[]) => table(['Id', 'Label', 'Kind', 'Stamps applied'], stages.map((s) => [s.id, s.label, s.kind, s.appliedStage ? 'yes' : '']), 64, true);
  if (!sub) {
    const stages = await getStages(api);
    return { json: stages, text: `${stagesTable(stages)}\n(new, starred and hidden are feed markers, not stages)` };
  }
  const stages = await getStages(api);
  const put = async (next: JobStage[]) => (await api.send<{ stages: JobStage[] }>('PUT', '/api/jobs/stages', { stages: next })).stages;
  const place = (list: JobStage[], stage: JobStage, after: string | undefined): JobStage[] => {
    if (after === undefined) return [...list, stage];
    if (after === '' || after === 'first') return [stage, ...list];
    const i = list.findIndex((s) => s.id === after);
    if (i === -1) throw new Error(`no stage "${after}" to put it after. Stages: ${list.map((s) => s.id).join(', ')}`);
    return [...list.slice(0, i + 1), stage, ...list.slice(i + 1)];
  };
  if (sub === 'add') {
    const { values, positionals } = parseArgs({ args: args.slice(1), options: { label: { type: 'string' }, closed: { type: 'boolean' }, after: { type: 'string' } }, allowPositionals: true });
    const id = stageIdFrom(positionals.join(' '));
    if (!id) throw new Error('usage: jobs stages add <id> [--label L] [--closed] [--after <id>]');
    if (isReservedStage(id)) throw new Error(`"${id}" is a feed marker (new, starred, hidden), not a stage`);
    if (stages.some((s) => s.id === id)) throw new Error(`stage "${id}" is already there`);
    const stage: JobStage = { id, label: values.label?.trim() || stageLabel([], id), kind: values.closed ? 'closed' : 'open', ...(values.closed ? {} : { appliedStage: false }) };
    const next = await put(place(stages, stage, values.after));
    return { json: next, text: `added stage ${id} (${stage.label}, ${stage.kind})\n${stagesTable(next)}` };
  }
  if (sub === 'rm') {
    const id = args[1];
    if (!id || !stages.some((s) => s.id === id)) throw new Error(id ? `no stage "${id}". Stages: ${stages.map((s) => s.id).join(', ')}` : 'usage: jobs stages rm <id>');
    const next = await put(stages.filter((s) => s.id !== id));
    return { json: next, text: `removed stage ${id}\n${stagesTable(next)}` };
  }
  if (sub === 'rename') {
    const [id, ...labelWords] = args.slice(1);
    const label = labelWords.join(' ').trim();
    if (!id || !label) throw new Error('usage: jobs stages rename <id> "<label>"');
    const was = stages.find((s) => s.id === id);
    if (!was) throw new Error(`no stage "${id}". Stages: ${stages.map((s) => s.id).join(', ')}`);
    const next = await put(stages.map((s) => (s.id === id ? { ...s, label } : s)));
    return { json: next, text: `stage ${id}: "${was.label}" → "${label}"` };
  }
  if (sub === 'move') {
    const { values, positionals } = parseArgs({ args: args.slice(1), options: { after: { type: 'string' }, first: { type: 'boolean' } }, allowPositionals: true });
    const id = positionals[0];
    const stage = stages.find((s) => s.id === id);
    if (!id || !stage || (values.after === undefined && !values.first)) throw new Error(id && !stage ? `no stage "${id}". Stages: ${stages.map((s) => s.id).join(', ')}` : 'usage: jobs stages move <id> --after <other> | --first');
    if (values.after === id) throw new Error('a stage cannot go after itself');
    const next = await put(place(stages.filter((s) => s.id !== id), stage, values.first ? 'first' : values.after));
    return { json: next, text: stagesTable(next) };
  }
  throw new Error('jobs stages | jobs stages add <id> [--label L] [--closed] [--after <id>] | rm <id> | rename <id> "<label>" | move <id> --after <other>');
}

/* ---------- writes ---------- */

type TodoApp = 'todoist' | 'gtasks';

/** Where `task add` goes: `--to`, else the dashboard's default app (Settings → To-do sync), else Todoist. */
async function defaultTodoApp(api: Api): Promise<TodoApp> {
  try {
    const st = await api.get<{ defaultApp: TodoApp | null }>('/api/todo/status');
    return st.defaultApp ?? 'todoist';
  } catch {
    return 'todoist';
  }
}

async function task(api: Api, args: string[]): Promise<Out> {
  if (args[0] === 'add') {
    const { values, positionals } = parseArgs({ args: args.slice(1), options: { to: { type: 'string' }, due: { type: 'string' } }, allowPositionals: true });
    const text = positionals.join(' ').trim();
    if (!text) throw new Error('usage: task add "<text>" [--to todoist|gtasks] [--due YYYY-MM-DD]');
    if (values.to && values.to !== 'todoist' && values.to !== 'gtasks') throw new Error(`--to must be todoist or gtasks, not "${values.to}"`);
    if (values.due && !/^\d{4}-\d{2}-\d{2}$/.test(values.due)) throw new Error('--due must be YYYY-MM-DD');
    const app = (values.to as TodoApp | undefined) ?? (await defaultTodoApp(api));
    // Todoist parses dates out of the text itself; Google Tasks takes the title as written plus an optional date.
    const item =
      app === 'gtasks'
        ? await api.send<EffectiveItem>('POST', '/api/gtasks/tasks/quick', { content: text, ...(values.due ? { due: values.due } : {}) })
        : await api.send<EffectiveItem>('POST', '/api/todoist/tasks/quick', { text: values.due ? `${text} ${values.due}` : text });
    return { json: item, text: `added to ${app === 'gtasks' ? 'Google Tasks' : 'Todoist'}: ${item.title}${item.dueAt ? ` · due ${when(item.dueAt)}` : ''} · ${item.id}` };
  }
  if (args[0] === 'done' && args[1]) {
    // Ids come from `todo --json`: "todoist:<id>" or "gtasks:<listId>:<taskId>". A bare id is a Todoist id.
    const raw = args[1];
    const app: TodoApp = raw.startsWith('gtasks:') ? 'gtasks' : 'todoist';
    const id = raw.replace(/^(todoist|gtasks):/, '');
    await api.send('POST', `/api/${app}/tasks/${encodeURIComponent(id)}/close`);
    return { json: { ok: true, id: `${app}:${id}` }, text: `closed ${app}:${id}` };
  }
  throw new Error('usage: task add "<text>" [--to todoist|gtasks] [--due YYYY-MM-DD]  |  task done <task-id>');
}

async function done(api: Api, args: string[]): Promise<Out> {
  const { values, positionals } = parseArgs({ args, options: { undo: { type: 'boolean' } }, allowPositionals: true });
  const id = positionals[0];
  if (!id) throw new Error('usage: done <item-id> [--undo]');
  const ov = await api.send('POST', `/api/items/${encodeURIComponent(id)}/override`, { done: !values.undo });
  return { json: ov, text: `${id}: ${values.undo ? 'no longer marked done here' : 'marked done here (the source is not changed)'}` };
}

/** One field of one course: read it, change it, send only that field, and say what it was. */
async function patchCourse<K extends 'links' | 'schedule' | 'notes'>(api: Api, c: Course, field: K, next: Course[K], show: (v: Course[K]) => string): Promise<Out> {
  const updated = await api.send<Course>('PUT', `/api/courses/${encodeURIComponent(c.id)}`, { [field]: next });
  return { json: { course: updated.code, field, before: c[field], after: updated[field] }, text: `${c.code} ${field}:\n  was: ${show(c[field])}\n  now: ${show(updated[field])}` };
}

async function link(api: Api, args: string[]): Promise<Out> {
  const [op, courseKey, label, url] = args;
  const c = await resolveCourse(api, courseKey);
  const show = (v: Course['links']) => v.map((l) => `${l.label} → ${l.url}`).join(' · ') || '(none)';
  if (op === 'add' && label && url) return patchCourse(api, c, 'links', [...c.links.filter((l) => l.label.toLowerCase() !== label.toLowerCase()), { label, url }], show);
  if (op === 'rm' && label) {
    if (!c.links.some((l) => l.label.toLowerCase() === label.toLowerCase())) throw new Error(`${c.code} has no link "${label}". Links: ${c.links.map((l) => l.label).join(', ') || '(none)'}`);
    return patchCourse(api, c, 'links', c.links.filter((l) => l.label.toLowerCase() !== label.toLowerCase()), show);
  }
  throw new Error('usage: link add <course> <label> <url>  |  link rm <course> <label>');
}

async function schedule(api: Api, args: string[]): Promise<Out> {
  const [op, courseKey, kind, ...specs] = args;
  const c = await resolveCourse(api, courseKey);
  if (!kind || !/^[a-z][a-z0-9_]*$/.test(kind)) throw new Error('the session kind is lowercase, e.g. lecture, discussion, lab, office_hours');
  if (op === 'set' && specs.length) {
    const meetings: Meeting[] = specs.flatMap(parseMeetings);
    return patchCourse(api, c, 'schedule', { ...c.schedule, [kind]: meetings }, describeSchedule);
  }
  if (op === 'rm') {
    const { [kind]: _gone, ...rest } = c.schedule;
    return patchCourse(api, c, 'schedule', rest, describeSchedule);
  }
  throw new Error('usage: schedule set <course> <kind> "<days> <start>-<end> [@ room]" [...]  |  schedule rm <course> <kind>');
}

async function notes(api: Api, args: string[]): Promise<Out> {
  const [op, courseKey, ...text] = args;
  const c = await resolveCourse(api, courseKey);
  const show = (v: Course['notes']) => v ?? '(none)';
  if (op === 'set' && text.length) return patchCourse(api, c, 'notes', text.join(' '), show);
  if (op === 'clear') return patchCourse(api, c, 'notes', null, show);
  throw new Error('usage: notes set <course> "<text>"  |  notes clear <course>');
}

async function date(api: Api, args: string[]): Promise<Out> {
  if (args[0] === 'rm' && args[1]) {
    const id = args[1].replace(/^manual:/, '');
    await api.send('DELETE', `/api/items/manual/${encodeURIComponent(id)}`);
    return { json: { ok: true, id: `manual:${id}` }, text: `removed manual:${id}` };
  }
  if (args[0] === 'add') {
    const { values, positionals } = parseArgs({ args: args.slice(1), options: { start: { type: 'string' }, end: { type: 'string' }, location: { type: 'string' }, note: { type: 'string' }, session: { type: 'string' } }, allowPositionals: true });
    const [courseKey, kind, title, day] = positionals;
    if (!courseKey || !kind || !title || !day) throw new Error('usage: date add <course> <exam|quiz|final|cancelled|virtual|other> "<title>" <YYYY-MM-DD> [--start HH:MM --end HH:MM --location L --note N --session lecture]');
    const c = await resolveCourse(api, courseKey);
    const row = await api.send<{ id: string; title: string; startsAt: string | null; allDay: boolean }>('POST', '/api/items/manual', { courseId: c.id, kind, title, date: day, start: values.start ?? null, end: values.end ?? null, location: values.location ?? null, note: values.note ?? null, meetingKind: values.session ?? null });
    return { json: row, text: `added ${kind} "${row.title}" for ${c.code} on ${row.allDay ? dayOf(row.startsAt) : when(row.startsAt)} · ${row.id}` };
  }
  throw new Error('usage: date add …  |  date rm <id>');
}

interface GcalCalendar {
  id: string;
  summary: string;
  primary?: boolean;
}
interface GcalSourceMeta {
  calendars?: GcalCalendar[];
  defaultCalendarId?: string;
}

/** The Google Calendar source as `GET /api/sources` shows it: its calendars and the default, or nothing when it is not connected. */
export function gcalCalendars(all: Source[]): { connected: boolean; defaultCalendarId: string | null; calendars: GcalCalendar[] } {
  const src = all.find((s) => s.id === 'gcal');
  const meta = (src?.meta ?? {}) as GcalSourceMeta;
  const calendars = meta.calendars ?? [];
  return { connected: src?.status === 'connected' && calendars.length > 0, defaultCalendarId: meta.defaultCalendarId ?? calendars.find((c) => c.primary)?.id ?? null, calendars };
}

/** `--calendar <id or name>`: an id exactly, else a name case-insensitively; it has to be one calendar. */
export function resolveCalendar(calendars: GcalCalendar[], key: string): GcalCalendar {
  const byId = calendars.find((c) => c.id === key);
  if (byId) return byId;
  const k = key.trim().toLowerCase();
  const hits = calendars.filter((c) => c.summary.trim().toLowerCase() === k);
  if (hits.length === 1) return hits[0]!;
  const names = calendars.map((c) => `${c.summary} (${c.id})`).join(', ');
  throw new Error(hits.length ? `"${key}" matches ${hits.length} calendars; give the id instead. Calendars: ${names}` : `no calendar "${key}". Calendars: ${names || '(none)'}`);
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const nextDay = (ymd: string): string => {
  const d = new Date(`${ymd}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return localDate(d.toISOString());
};
const EVENT_USAGE = 'usage: event add "<title>" --at "<when>" [--for 1h30m | --end "<when>"] [--calendar <id or name>] [--location L] [--note N]  |  event add "<title>" --on YYYY-MM-DD [--until YYYY-MM-DD]  |  event calendars';

/** `event add` writes to the user's Google Calendar through the server (POST /api/calendar/events), which creates it in Google and keeps a copy locally. */
async function event(api: Api, args: string[]): Promise<Out> {
  if (args[0] === 'calendars') {
    const g = gcalCalendars(await api.get<Source[]>('/api/sources'));
    if (!g.connected) return { json: g, text: 'Google Calendar is not connected' };
    const marks = (c: GcalCalendar) => [c.id === g.defaultCalendarId ? 'default' : '', c.primary ? 'primary' : ''].filter(Boolean).join(', ');
    return { json: g, text: table(['Calendar', 'Id', ''], g.calendars.map((c) => [c.summary, c.id, marks(c)])) };
  }
  if (args[0] !== 'add') throw new Error(EVENT_USAGE);
  const { values, positionals } = parseArgs({ args: args.slice(1), options: { at: { type: 'string' }, for: { type: 'string' }, end: { type: 'string' }, on: { type: 'string' }, until: { type: 'string' }, calendar: { type: 'string' }, location: { type: 'string' }, note: { type: 'string' } }, allowPositionals: true });
  const title = positionals.join(' ').trim();
  if (!title) throw new Error(EVENT_USAGE);
  if (!!values.at === !!values.on) throw new Error(`give --at "<when>" for a timed event or --on YYYY-MM-DD for an all-day one\n${EVENT_USAGE}`);
  const body: Record<string, unknown> = { title, ...(values.location ? { location: values.location } : {}), ...(values.note ? { description: values.note } : {}) };
  if (values.at) {
    if (values.until) throw new Error('--until goes with --on; a timed event ends with --for or --end');
    if (values.for && values.end) throw new Error('give --for or --end, not both');
    const start = parseWhen(values.at);
    const end = values.for ? new Date(start.getTime() + parseDuration(values.for) * 60_000) : values.end ? parseWhen(values.end) : null;
    if (end && end <= start) throw new Error(`--end (${when(end.toISOString())}) must be after --at (${when(start.toISOString())})`);
    Object.assign(body, { allDay: false, start: start.toISOString(), ...(end ? { end: end.toISOString() } : {}) });
  } else {
    if (values.for || values.end) throw new Error('--for and --end go with --at; an all-day event spans --on to --until');
    if (!YMD.test(values.on!) || Number.isNaN(Date.parse(values.on!))) throw new Error('--on must be YYYY-MM-DD');
    if (values.until && (!YMD.test(values.until) || Number.isNaN(Date.parse(values.until)))) throw new Error('--until must be YYYY-MM-DD');
    if (values.until && values.until < values.on!) throw new Error('--until must not be before --on');
    // Google's all-day end is exclusive; --until is the last day the event is on.
    Object.assign(body, { allDay: true, start: values.on, ...(values.until ? { end: nextDay(values.until) } : {}) });
  }
  if (values.calendar) {
    const g = gcalCalendars(await api.get<Source[]>('/api/sources'));
    if (!g.connected) throw new Error('Google Calendar is not connected');
    body.calendarId = resolveCalendar(g.calendars, values.calendar).id;
  }
  const row = await api.send<EffectiveItem & { raw: { calendarId?: string; calendarName?: string | null } }>('POST', '/api/calendar/events', body);
  const span = row.allDay
    ? row.endsAt && localDate(row.endsAt) > nextDay(localDate(row.startsAt!))
      ? `${dayOf(row.startsAt)} – ${dayOf(new Date(new Date(row.endsAt).getTime() - 86_400_000).toISOString())}`
      : dayOf(row.startsAt)
    : `${when(row.startsAt)}${row.endsAt ? `–${new Date(row.endsAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : ''}`;
  return { json: row, text: `added: ${row.title} · ${span} · ${row.raw?.calendarName ?? row.raw?.calendarId ?? 'calendar'} · ${row.id}` };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** `resync [source|all]`, and the source half of bare `collected sync` in local mode (machine-sync.ts). */
export async function resync(api: Api, args: string[]): Promise<Out> {
  const which = args[0] ?? 'all';
  const since = new Date().toISOString();
  let ids: string[];
  if (which === 'all') ids = (await api.send<{ started: string[] }>('POST', '/api/sources/sync')).started;
  else {
    ids = [which];
    // A full Canvas sync can outlast the proxy's 100 s; the run continues on the server either way.
    await api.send('POST', `/api/sources/${encodeURIComponent(which)}/sync`).catch((e: Error) => {
      if (/\b(400|404)\b/.test(e.message)) throw e;
    });
  }
  let all: Source[] = [];
  for (let i = 0; i < 90; i++) {
    all = (await api.get<Source[]>('/api/sources')).filter((s) => ids.includes(s.id));
    if (all.every((s) => !s.running && (s.lastRunAt ?? '') >= since.slice(0, 19))) break;
    await sleep(4000);
  }
  return { json: all, text: table(['Source', 'Status', 'Last success', 'Error'], all.map((s) => [s.id, s.running ? `${s.status} (still running)` : s.status, when(s.lastSuccessAt), s.lastError ?? ''])) };
}

/* ---------- Canvas, read-only ---------- */

const raw = <T>(api: Api, path: string, all = false): Promise<T> => api.get<T>(`/api/canvas/raw?${q({ path, all: all ? 1 : undefined })}`);
const canvasId = (c: Course): string => {
  if (!c.canvasCourseId) throw new Error(`${c.code} is not matched to a Canvas course`);
  return c.canvasCourseId;
};

async function canvas(api: Api, args: string[]): Promise<Out> {
  const [op, ...rest] = args;
  if (op === 'get') {
    const { values, positionals } = parseArgs({ args: rest, options: { all: { type: 'boolean' } }, allowPositionals: true });
    if (!positionals[0]) throw new Error('usage: canvas get "<api path>" [--all]');
    const data = await raw<unknown>(api, positionals[0], values.all);
    return { json: data, text: JSON.stringify(data, null, 2) };
  }
  const c = await resolveCourse(api, rest[0]);
  const cid = canvasId(c);
  if (op === 'ls') {
    const what = rest[1] ?? 'modules';
    if (what === 'modules') {
      const mods = await raw<{ id: string; name: string; items?: { id: string; title: string; type: string; content_id?: string; page_url?: string; external_url?: string }[] }[]>(api, `/api/v1/courses/${cid}/modules?include[]=items`, true);
      const lines = mods.flatMap((m) => [`${m.name}  (module ${m.id})`, ...(m.items ?? []).map((i) => `  ${i.type.padEnd(12)} ${i.title}${i.type === 'File' ? `  [file ${i.content_id}]` : i.type === 'Page' ? `  [page ${i.page_url}]` : i.type === 'Assignment' || i.type === 'Quiz' ? `  [${i.type.toLowerCase()} ${i.content_id}]` : i.external_url ? `  ${i.external_url}` : ''}`)]);
      return { json: mods, text: lines.join('\n') || '(no modules)' };
    }
    if (what === 'files') {
      const files = await raw<{ id: string; display_name: string; size: number; updated_at: string; 'content-type': string }[]>(api, `/api/v1/courses/${cid}/files?sort=updated_at&order=desc`, true);
      return { json: files, text: table(['File id', 'Name', 'KB', 'Updated', 'Type'], files.map((f) => [f.id, f.display_name, Math.round((f.size ?? 0) / 1024), dayOf(f.updated_at), f['content-type']])) };
    }
    if (what === 'pages') {
      const pages = await raw<{ url: string; title: string; updated_at: string }[]>(api, `/api/v1/courses/${cid}/pages`, true);
      return { json: pages, text: table(['Slug', 'Title', 'Updated'], pages.map((p) => [p.url, p.title, dayOf(p.updated_at)])) };
    }
    if (what === 'assignments') {
      const list = await raw<{ id: string; name: string; due_at: string | null; points_possible: number | null; submission_types: string[]; rubric?: unknown[] }[]>(api, `/api/v1/courses/${cid}/assignments?order_by=due_at`, true);
      return { json: list, text: table(['Id', 'Assignment', 'Due', 'Pts', 'Submit via', 'Rubric'], list.map((a) => [a.id, a.name, when(a.due_at), a.points_possible ?? '', (a.submission_types ?? []).join(', '), a.rubric?.length ? 'yes' : ''])) };
    }
    if (what === 'announcements') {
      const list = await raw<{ id: string; title: string; posted_at: string }[]>(api, `/api/v1/announcements?context_codes[]=course_${cid}`, true);
      return { json: list, text: table(['Id', 'Announcement', 'Posted'], list.map((a) => [a.id, a.title, when(a.posted_at)])) };
    }
    throw new Error('canvas ls <course> [modules|files|pages|assignments|announcements]');
  }
  if (op === 'show') {
    const [, kind, id] = rest;
    const page = (title: string, meta: string[], html: string | null | undefined, extra: string[] = []): Out['text'] => {
      const files = linkedFiles(html);
      return [title, ...meta.filter(Boolean), '', htmlToText(html) || '(empty)', ...extra, ...(files.length ? ['', 'Linked files (collected pull <id> --to <folder>):', ...files.map((f) => `  ${f.fileId}  ${f.text}`)] : [])].join('\n');
    };
    if (kind === 'syllabus') {
      const d = await raw<{ name: string; syllabus_body: string | null }>(api, `/api/v1/courses/${cid}?include[]=syllabus_body`);
      return { json: d, text: page(`${c.code} syllabus`, [], d.syllabus_body) };
    }
    if (kind === 'page' && id) {
      const d = await raw<{ title: string; body: string | null; updated_at: string }>(api, `/api/v1/courses/${cid}/pages/${encodeURIComponent(id)}`);
      return { json: d, text: page(d.title, [`updated ${when(d.updated_at)}`], d.body) };
    }
    if (kind === 'assignment' && id) {
      const d = await raw<{ name: string; description: string | null; due_at: string | null; lock_at: string | null; points_possible: number | null; submission_types: string[]; html_url: string; rubric?: { description: string; long_description?: string; points: number; ratings?: { description: string; points: number }[] }[] }>(api, `/api/v1/courses/${cid}/assignments/${encodeURIComponent(id)}`);
      const rubric = d.rubric?.length ? ['', 'Rubric:', ...d.rubric.map((r) => `  ${r.points} pts  ${r.description}${r.long_description ? `: ${htmlToText(r.long_description)}` : ''}${r.ratings?.length ? `\n${r.ratings.map((x) => `      ${x.points}: ${x.description}`).join('\n')}` : ''}`)] : [];
      return { json: d, text: page(d.name, [`due ${when(d.due_at) || 'no due date'}${d.lock_at ? ` · locks ${when(d.lock_at)}` : ''} · ${d.points_possible ?? '?'} pts · ${(d.submission_types ?? []).join(', ')}`, d.html_url], d.description, rubric) };
    }
    if (kind === 'announcement' && id) {
      const d = await raw<{ title: string; message: string | null; posted_at: string; html_url: string }>(api, `/api/v1/courses/${cid}/discussion_topics/${encodeURIComponent(id)}`);
      return { json: d, text: page(d.title, [`posted ${when(d.posted_at)}`, d.html_url], d.message) };
    }
    throw new Error('canvas show <course> syllabus | page <slug> | assignment <id> | announcement <id>');
  }
  throw new Error('canvas ls … | canvas show … | canvas get "<api path>"');
}

/* ---------- dispatch ---------- */

const COMMANDS: Record<string, (api: Api, args: string[]) => Promise<Out>> = { courses, course, assignments, agenda, todo, grades, announcements, dates, sources, jobs, task, done, link, schedule, notes, date, event, resync, canvas };

export const isCollectedCommand = (cmd: string | undefined): cmd is string => !!cmd && cmd in COMMANDS;

/** Runs one command. `--json` anywhere in the arguments switches the output to JSON. */
export async function runCollected(api: Api, cmd: string, args: string[]): Promise<string> {
  const json = args.includes('--json');
  const out = await COMMANDS[cmd]!(api, args.filter((a) => a !== '--json'));
  return json ? JSON.stringify(out.json, null, 2) : out.text;
}
