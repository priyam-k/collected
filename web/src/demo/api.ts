import { DEFAULT_JOB_STAGES, isClosedStage, isReservedStage, isTrackedState, labelFromStageId, type CourseGrades, type EffectiveItem, type GradedAssignment, type Job, type JobStage, type Layouts, type WidgetInstance } from '@collected/shared';
import { ApiError } from '@/lib/api';
import type { GradesSummary } from '@/lib/queries';
import { makeDemoState, type DemoState } from './data';

/**
 * An in-browser stand-in for the server, used by the live demo on the landing page and at /demo. It answers the
 * dashboard's reads from the demo semester and applies its writes (checking things off, moving cards, starring jobs)
 * to that in-memory copy, which resets on reload. Requests under /auth still go to the real server.
 */

let state: DemoState = makeDemoState();
let stages: JobStage[] = DEFAULT_JOB_STAGES.map((s) => ({ ...s }));

export function resetDemo(): void {
  state = makeDemoState();
  stages = DEFAULT_JOB_STAGES.map((s) => ({ ...s }));
}

/** The server appends a stage it hasn't seen as open; the demo does the same. */
function noteStage(id: string | undefined) {
  if (id && !isReservedStage(id) && !stages.some((s) => s.id === id)) stages.push({ id, label: labelFromStageId(id), kind: 'open' });
}

const json = (body: unknown) => (typeof body === 'string' ? (JSON.parse(body) as unknown) : body);
const csv = (v: string | null) => (v ? v.split(',').filter(Boolean) : null);

function filterItems(q: URLSearchParams): EffectiveItem[] {
  const from = q.get('from');
  const to = q.get('to');
  const kinds = csv(q.get('kind'));
  const sources = csv(q.get('source'));
  const course = q.get('course');
  const includeDone = q.get('includeDone') === '1' || q.get('includeDone') === 'true';
  const includeInformational = q.get('includeInformational') === '1' || q.get('includeInformational') === 'true';
  const limit = Number(q.get('limit')) || 2000;
  // Same rules as the server: an item is in range when its due, start or end falls inside [from, to].
  const out = state.items.filter((it) => {
    if (kinds && !kinds.includes(it.kind)) return false;
    if (sources && !sources.includes(it.source)) return false;
    if (course && it.courseId !== course) return false;
    if (from && !([it.dueAt, it.endsAt, it.startsAt].some((t) => t && t >= from))) return false;
    if (to && !([it.dueAt, it.startsAt].some((t) => t && t <= to))) return false;
    if (it.informational && !includeInformational) return false;
    if (it.effectiveDone && !includeDone) return false;
    if (it.effectiveHidden) return false;
    return true;
  });
  out.sort((a, b) => (a.dueAt ?? a.startsAt ?? '9').localeCompare(b.dueAt ?? b.startsAt ?? '9'));
  return out.slice(0, limit);
}

function graded(courseId: string): GradedAssignment[] {
  return state.items
    .filter((it) => it.courseId === courseId && it.kind === 'assignment' && it.score != null)
    .map((it) => ({ id: it.id, title: it.title, source: it.source, dueAt: it.dueAt, status: it.status, score: it.score, points: it.points, excused: false, omitFromFinal: false, dropped: false, url: it.url }));
}

function courseGrades(courseId: string): CourseGrades {
  const list = graded(courseId);
  const earned = list.reduce((s, a) => s + (a.score ?? 0), 0);
  const possible = list.reduce((s, a) => s + (a.points ?? 0), 0);
  const current = possible ? (earned / possible) * 100 : null;
  const total = state.items.filter((it) => it.courseId === courseId && it.kind === 'assignment').length;
  return { courseId, mode: 'auto', weighted: false, current, unweighted: current, canvas: null, categories: [], uncategorized: list, graded: list.length, total };
}

function gradesSummary(): GradesSummary {
  const out: GradesSummary = {};
  for (const c of state.courses) {
    if (c.role === 'ta') continue;
    const g = courseGrades(c.id);
    out[c.id] = { current: g.current, weighted: false, graded: g.graded, total: g.total, canvasCurrent: null };
  }
  return out;
}

/** The server's `?query=`: every word in the company, title, locations, req id or notes. */
function matchesQuery(j: Job, q: URLSearchParams): boolean {
  const hay = [j.company, j.title, ...j.locations, j.reqId ?? '', j.notes ?? ''].join(' ').toLowerCase();
  return (q.get('query') ?? '').toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

function filterJobs(q: URLSearchParams): Job[] {
  const states = csv(q.get('state'));
  const includeHidden = q.get('includeHidden') === '1' || q.get('includeHidden') === 'true';
  const limit = Number(q.get('limit')) || 200;
  return state.jobs
    .filter((j) => j.source !== 'manual')
    .filter((j) => (states ? states.includes(j.state) : includeHidden || j.state !== 'hidden'))
    .filter((j) => matchesQuery(j, q))
    .sort((a, b) => (b.postedAt ?? '').localeCompare(a.postedAt ?? ''))
    .slice(0, limit);
}

function setDone(it: EffectiveItem, done: boolean) {
  it.effectiveDone = done;
  it.override = { itemId: it.id, hidden: false, done, snoozedUntil: null, note: null, updatedAt: new Date().toISOString() };
}

function addTask(source: 'todoist' | 'gtasks', text: string): EffectiveItem {
  const now = new Date().toISOString();
  const externalId = `demo-quick-${Date.now()}`;
  const it: EffectiveItem = {
    id: `${source}:${externalId}`,
    source,
    externalId,
    kind: 'task',
    courseId: null,
    title: text.replace(/\s+(@\w+|#\w+)/g, '').trim() || text,
    description: null,
    url: null,
    startsAt: null,
    endsAt: null,
    dueAt: null,
    allDay: false,
    status: 'open',
    points: null,
    score: null,
    labels: [...text.matchAll(/@(\w+)/g)].map((m) => m[1]!),
    raw: { projectName: text.match(/#(\w+)/)?.[1] ?? 'Inbox' },
    firstSeenAt: now,
    updatedAt: now,
    deletedAt: null,
    effectiveDone: false,
    effectiveHidden: false,
    informational: false,
    linkedIds: [],
    override: null,
    course: null,
  };
  state.items.push(it);
  return it;
}

/**
 * Answers a request the way the server would, or returns undefined to let it through to the network. Answers are
 * copies, as JSON off the wire would be: handing out the live objects let a write change data a query already held,
 * so React Query saw nothing new and memoised views (the tracker's columns) kept the old grouping.
 */
export async function demoApi(path: string, init: RequestInit & { json?: unknown } = {}): Promise<unknown> {
  const answer = await answerDemo(path, init);
  return answer === undefined ? undefined : structuredClone(answer);
}

async function answerDemo(path: string, init: RequestInit & { json?: unknown }): Promise<unknown> {
  const url = new URL(path, 'http://demo');
  const p = url.pathname;
  const q = url.searchParams;
  const method = (init.method ?? 'GET').toUpperCase();
  const body = init.json !== undefined ? init.json : init.body ? json(init.body) : undefined;
  if (p.startsWith('/auth')) return undefined;
  // A little latency so loading states and optimistic updates behave as they do against a real server.
  await new Promise((r) => setTimeout(r, method === 'GET' ? 120 : 180));

  if (method === 'GET') {
    if (p === '/health') return { ok: true };
    if (p === '/sources') return state.sources;
    if (p === '/courses') return state.courses;
    if (p === '/layout') return state.layout;
    if (p === '/widgets') return state.widgets;
    if (p === '/settings') return state.settings;
    if (p === '/items') return filterItems(q);
    if (p === '/grades') return gradesSummary();
    if (p.startsWith('/grades/')) return courseGrades(decodeURIComponent(p.slice('/grades/'.length)));
    if (/^\/courses\/[^/]+\/content$/.test(p)) return [];
    if (/^\/courses\/[^/]+\/links$/.test(p)) return { canvas: [], gradescope: [], links: [] };
    if (p === '/file-sync/devices') return [];
    if (p === '/jobs') return filterJobs(q);
    if (p === '/jobs/tracked') return state.jobs.filter((j) => isTrackedState(j.state) && matchesQuery(j, q));
    if (p === '/jobs/stages') return { stages };
    if (p === '/jobs/find') {
      const url = q.get('url');
      const req = q.get('req');
      const j = state.jobs.find((x) => (url && x.url === url) || (req && x.reqId?.toLowerCase() === req.toLowerCase()));
      if (j) return j;
      throw new ApiError(404, 'No such job');
    }
    if (p === '/jobs/stats') {
      const active = state.jobs.filter((j) => j.active).length;
      return { total: state.jobs.length + 4_980, active: active + 4_920, matched: state.jobs.length + 731, unseen: state.jobs.filter((j) => !j.seenAt).length, tracked: state.jobs.filter((j) => isTrackedState(j.state) && !isClosedStage(stages, j.state)).length };
    }
    if (p.startsWith('/jobs/')) {
      const j = state.jobs.find((x) => x.id === decodeURIComponent(p.slice('/jobs/'.length)));
      if (j) return j;
    }
    if (p === '/todo/status') {
      const s = (id: 'todoist' | 'gtasks') => ({ connected: true, enabled: true, pushEnabled: id === 'todoist', lastPushAt: new Date(Date.now() - 5 * 60_000).toISOString() });
      return { todoist: s('todoist'), gtasks: s('gtasks'), defaultApp: 'todoist' };
    }
    throw new ApiError(404, 'Not in the demo');
  }

  // Writes change the in-memory copy only.
  if (p === '/layout' && method === 'PUT') {
    state.layout = body as Layouts;
    return { ok: true };
  }
  if (p === '/layout' && method === 'DELETE') {
    state.layout = makeDemoState().layout;
    return { ok: true };
  }
  if (p.startsWith('/widgets/') && method === 'PUT') {
    const id = decodeURIComponent(p.slice('/widgets/'.length));
    const b = body as Partial<WidgetInstance>;
    const existing = state.widgets.find((w) => w.id === id);
    if (existing) Object.assign(existing, Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)));
    else state.widgets.push({ id, type: b.type ?? id, config: b.config ?? {}, hidden: !!b.hidden, createdAt: new Date().toISOString() });
    return state.widgets.find((w) => w.id === id);
  }
  const override = p.match(/^\/items\/(.+)\/override$/);
  if (override && method === 'POST') {
    const it = state.items.find((x) => x.id === decodeURIComponent(override[1]!));
    const b = body as { done?: boolean; hidden?: boolean };
    if (it && b.done !== undefined) setDone(it, b.done);
    if (it && b.hidden !== undefined) it.effectiveHidden = b.hidden;
    return { ok: true };
  }
  const close = p.match(/^\/(todoist|gtasks)\/tasks\/(.+)\/close$/);
  if (close) {
    const it = state.items.find((x) => x.source === close[1] && x.externalId === decodeURIComponent(close[2]!));
    if (it) {
      it.status = 'done';
      setDone(it, true);
    }
    return { ok: true };
  }
  if (p === '/todoist/tasks/quick') return addTask('todoist', String((body as { text?: string }).text ?? ''));
  if (p === '/gtasks/tasks/quick') return addTask('gtasks', String((body as { content?: string }).content ?? ''));
  if (p === '/jobs/seen') {
    const ids = (body as { ids?: string[] }).ids ?? [];
    for (const j of state.jobs) if (ids.includes(j.id)) j.seenAt = new Date().toISOString();
    return { ok: true };
  }
  const jobState = p.match(/^\/jobs\/(.+)\/state$/);
  if (jobState) {
    const j = state.jobs.find((x) => x.id === decodeURIComponent(jobState[1]!));
    noteStage((body as Partial<Job>).state);
    if (j) Object.assign(j, body as Partial<Job>, { stateUpdatedAt: new Date().toISOString() });
    return j;
  }
  if (p === '/jobs/stages' && method === 'PUT') {
    stages = ((body as { stages?: JobStage[] }).stages ?? []).map((s) => ({ ...s }));
    return { stages };
  }
  if (p === '/jobs' && method === 'POST') {
    const b = body as Partial<Job>;
    const existing = state.jobs.find((x) => (b.url && x.url === b.url) || (b.reqId && x.reqId === b.reqId));
    if (existing && url.searchParams.get('force') !== '1') throw new ApiError(409, 'Already stored', { error: 'Already stored', existing });
    const now = new Date().toISOString();
    const id = `manual:demo-${Date.now()}`;
    const job: Job = {
      id, source: 'manual', externalId: id, company: b.company ?? '', title: b.title ?? '', locations: b.locations ?? [], url: b.url ?? '',
      terms: [], sponsorship: null, degrees: [], category: null, postedAt: now, active: true, visible: true, matchesFilter: false, score: null,
      firstSeenAt: now, updatedAt: now, reqId: b.reqId ?? null, state: b.state ?? 'applied', notes: b.notes ?? null, seenAt: now,
      appliedAt: b.appliedAt ?? null, nextAction: null, nextActionAt: null, resumePath: null, stateUpdatedAt: now,
    };
    noteStage(job.state);
    state.jobs.push(job);
    return job;
  }
  if (p === '/sources/sync') return { started: [], skipped: state.sources.filter((s) => s.enabled).map((s) => ({ id: s.id, reason: 'running' })) };
  const sync = p.match(/^\/sources\/([^/]+)\/sync$/);
  if (sync) {
    const s = state.sources.find((x) => x.id === sync[1]);
    if (s) s.lastSuccessAt = s.lastRunAt = new Date().toISOString();
    return { outcome: { ok: true }, source: s };
  }
  if (p.startsWith('/settings/') && method === 'PUT') {
    state.settings[decodeURIComponent(p.slice('/settings/'.length))] = body;
    return body;
  }
  return { ok: true };
}
