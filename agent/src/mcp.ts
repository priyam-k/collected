import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ApiError, type CollectedApi } from './api.js';
import { HELP, isCollectedCommand, runCollected } from './collected.js';
import { isLocal, maxAgeMinutes, type AgentConfig } from './config.js';
import { READ_SOURCES, ensureFresh } from './freshness.js';
import { cliVersion } from './version.js';

/*
 * `collected mcp`: the dashboard as an MCP server on stdio, for Claude Code, Cursor, Claude Desktop and anything else
 * that speaks the Model Context Protocol. Every tool is one `collected` command with `--json`: the table below turns
 * typed arguments into the argv the CLI already parses, and the answer is the same JSON `--json` prints. Nothing is
 * decided here that the CLI does not decide; a scoped token (shared/src/tokens.ts) limits the tools the same way it
 * limits the commands, and a refusal comes back as the server's message ("this token has no write access to jobs").
 *
 * Reads are marked read-only for the client; `jobs_rm` is the one destructive tool (it removes a hand-added job).
 * Setup (`init`, `login`, `connect`), the file sync and `pull` stay in the terminal: they touch this machine, not
 * the dashboard.
 *
 * stdout is the protocol stream, so the command never prints there (cli.ts routes console.log to stderr first).
 */

type Shape = z.ZodRawShape;

export interface ToolSpec<S extends Shape = Shape> {
  name: string;
  title: string;
  description: string;
  args: S;
  /** The `collected` command and the argv for it, from the parsed arguments. */
  cmd: string;
  argv: (a: z.infer<z.ZodObject<S>>) => string[];
  readOnly: boolean;
  destructive?: boolean;
}

const flag = (name: string, v: string | number | boolean | undefined): string[] => (v === undefined || v === '' || v === false ? [] : v === true ? [`--${name}`] : [`--${name}`, String(v)]);
const course = z.string().describe('A course by code (enme480), the digits (480) or the full id.');
const tool = <S extends Shape>(spec: ToolSpec<S>): ToolSpec => spec as unknown as ToolSpec;

/** Every tool, in the order the CLI help lists the commands. */
export const TOOLS: ToolSpec[] = [
  // --- Look
  tool({ name: 'courses', title: 'List courses', description: 'Every course: role, schedule, hotlinks.', args: {}, cmd: 'courses', argv: () => [], readOnly: true }),
  tool({ name: 'course', title: 'Show a course', description: 'One course: schedule, links, notes, grade, what is due, dates.', args: { course }, cmd: 'course', argv: (a) => [a.course], readOnly: true }),
  tool({
    name: 'assignments',
    title: 'Assignments due',
    description: 'What is due: open assignments plus overdue ones from the last `days` days. `all` lists everything, done included.',
    args: { course: course.optional(), days: z.number().int().min(1).max(365).optional().describe('Default 14.'), all: z.boolean().optional() },
    cmd: 'assignments',
    argv: (a) => [...flag('course', a.course), ...flag('days', a.days), ...flag('all', a.all)],
    readOnly: true,
  }),
  tool({ name: 'agenda', title: 'Agenda', description: 'Events, due dates and tasks by day, starting today.', args: { days: z.number().int().min(1).max(90).optional().describe('Default 7.') }, cmd: 'agenda', argv: (a) => flag('days', a.days), readOnly: true }),
  tool({ name: 'todo', title: 'Open tasks', description: 'Open to-do tasks (Todoist or Google Tasks) and open assignments.', args: {}, cmd: 'todo', argv: () => [], readOnly: true }),
  tool({ name: 'grades', title: 'Grades', description: 'The current grade per course, or one course by category.', args: { course: course.optional() }, cmd: 'grades', argv: (a) => (a.course ? [a.course] : []), readOnly: true }),
  tool({
    name: 'announcements',
    title: 'Announcements',
    description: 'Recent Canvas announcements.',
    args: { course: course.optional(), limit: z.number().int().min(1).max(100).optional().describe('Default 5.') },
    cmd: 'announcements',
    argv: (a) => [...flag('course', a.course), ...flag('limit', a.limit)],
    readOnly: true,
  }),
  tool({ name: 'dates', title: 'Important dates', description: 'Exams, quizzes, finals, cancelled or virtual sessions.', args: { course: course.optional() }, cmd: 'dates', argv: (a) => flag('course', a.course), readOnly: true }),
  tool({ name: 'sources', title: 'Sync status', description: 'Sync status of Canvas, Gradescope, Google Calendar, Todoist, Google Tasks and the job feed.', args: {}, cmd: 'sources', argv: () => [], readOnly: true }),

  // --- Jobs
  tool({
    name: 'jobs_tracked',
    title: 'Tracked jobs',
    description: 'Everything in the applications tracker, most recently touched first.',
    args: { state: z.string().optional().describe('Comma-separated stage ids, e.g. "applied,screen".'), limit: z.number().int().min(1).max(500).optional().describe('Default 20.') },
    cmd: 'jobs',
    argv: (a) => [...flag('state', a.state), ...flag('limit', a.limit)],
    readOnly: true,
  }),
  tool({
    name: 'jobs_feed',
    title: 'Job feed',
    description: 'The matched job feed, newest first. `all` includes hidden and inactive listings.',
    args: { all: z.boolean().optional(), limit: z.number().int().min(1).max(500).optional().describe('Default 50.'), since: z.string().optional().describe('YYYY-MM-DD') },
    cmd: 'jobs',
    argv: (a) => ['feed', ...flag('all', a.all), ...flag('limit', a.limit), ...flag('since', a.since)],
    readOnly: true,
  }),
  tool({
    name: 'jobs_search',
    title: 'Search jobs',
    description: 'Search company, title, location, notes or an exact requisition id across the tracker and the feed; every word must match.',
    args: {
      query: z.string().min(1),
      tracked: z.boolean().optional().describe('Only the tracker.'),
      feed: z.boolean().optional().describe('Only the feed.'),
      state: z.string().optional().describe('Comma-separated stage ids.'),
      limit: z.number().int().min(1).max(500).optional(),
    },
    cmd: 'jobs',
    argv: (a) => ['search', a.query, ...flag('tracked', a.tracked), ...flag('feed', a.feed), ...flag('state', a.state), ...flag('limit', a.limit)],
    readOnly: true,
  }),
  tool({ name: 'jobs_find', title: 'Find a job', description: 'The job with that requisition id or posting URL (tracking parameters ignored); an empty list when there is none.', args: { ref: z.string().min(1).describe('A requisition id or a posting URL.') }, cmd: 'jobs', argv: (a) => ['find', a.ref], readOnly: true }),
  tool({ name: 'jobs_show', title: 'Show a job', description: 'Every field of one job: notes, resume, req id, next action, timestamps.', args: { id: z.string().min(1) }, cmd: 'jobs', argv: (a) => ['show', a.id], readOnly: true }),
  tool({ name: 'jobs_stages', title: 'Tracker stages', description: 'The tracker stages in order, with which are open, closed and count as applied.', args: {}, cmd: 'jobs', argv: () => ['stages'], readOnly: true }),
  tool({
    name: 'jobs_add',
    title: 'Add a job',
    description: 'Add a job by hand. Refused with the existing job when the URL or req id is already tracked; `force` adds anyway.',
    args: {
      company: z.string().min(1),
      title: z.string().min(1),
      url: z.string().optional(),
      req: z.string().optional().describe('Requisition id.'),
      location: z.string().optional(),
      state: z.string().optional().describe('A stage id; default applied. A new id becomes a board column.'),
      applied: z.string().optional().describe('YYYY-MM-DD'),
      resume: z.string().optional().describe('Path to the resume used, stored as given.'),
      notes: z.string().optional(),
      next: z.string().optional().describe('The next action.'),
      nextAt: z.string().optional().describe('When the next action is due, YYYY-MM-DD.'),
      force: z.boolean().optional(),
    },
    cmd: 'jobs',
    argv: (a) => ['add', a.company, a.title, ...flag('url', a.url), ...flag('req', a.req), ...flag('location', a.location), ...flag('state', a.state), ...flag('applied', a.applied), ...flag('resume', a.resume), ...flag('notes', a.notes), ...flag('next', a.next), ...flag('next-at', a.nextAt), ...flag('force', a.force)],
    readOnly: false,
  }),
  tool({
    name: 'jobs_set',
    title: 'Update a job',
    description: 'Move a job to a stage and/or edit its fields. Any stage id works; a new one becomes a board column. Fields without a value are left alone.',
    args: {
      id: z.string().min(1),
      state: z.string().optional().describe('A stage id, e.g. applied, screen, oa, interviewing, offer, rejected, hidden.'),
      notes: z.string().optional(),
      next: z.string().optional(),
      nextAt: z.string().optional().describe('YYYY-MM-DD'),
      applied: z.string().optional().describe('YYYY-MM-DD'),
      resume: z.string().optional(),
      req: z.string().optional(),
    },
    cmd: 'jobs',
    argv: (a) => ['set', a.id, ...(a.state ? [a.state] : []), ...flag('notes', a.notes), ...flag('next', a.next), ...flag('next-at', a.nextAt), ...flag('applied', a.applied), ...flag('resume', a.resume), ...flag('req', a.req)],
    readOnly: false,
  }),
  tool({ name: 'jobs_rm', title: 'Remove a job', description: 'Remove a hand-added job. A feed job cannot be removed; set its state to hidden instead.', args: { id: z.string().min(1) }, cmd: 'jobs', argv: (a) => ['rm', a.id], readOnly: false, destructive: true }),
  tool({ name: 'jobs_seen', title: 'Mark feed jobs seen', description: 'Mark feed jobs seen; with no ids, every unseen match.', args: { ids: z.array(z.string().min(1)).optional() }, cmd: 'jobs', argv: (a) => ['seen', ...(a.ids ?? [])], readOnly: false }),
  tool({
    name: 'jobs_stage_add',
    title: 'Add a stage',
    description: 'Add a tracker stage (a board column).',
    args: { id: z.string().min(1).describe('Lowercase id, e.g. "oa" or "take home".'), label: z.string().optional(), closed: z.boolean().optional().describe('A closed stage (rejected, withdrawn) rather than an open one.'), after: z.string().optional().describe('Place it after this stage id.') },
    cmd: 'jobs',
    argv: (a) => ['stages', 'add', a.id, ...flag('label', a.label), ...flag('closed', a.closed), ...flag('after', a.after)],
    readOnly: false,
  }),
  tool({ name: 'jobs_stage_rm', title: 'Remove a stage', description: 'Remove a tracker stage; jobs in it keep their stage id until moved.', args: { id: z.string().min(1) }, cmd: 'jobs', argv: (a) => ['stages', 'rm', a.id], readOnly: false }),
  tool({ name: 'jobs_stage_rename', title: 'Rename a stage', description: 'Change a stage label (the id stays).', args: { id: z.string().min(1), label: z.string().min(1) }, cmd: 'jobs', argv: (a) => ['stages', 'rename', a.id, a.label], readOnly: false }),
  tool({ name: 'jobs_stage_move', title: 'Move a stage', description: 'Reorder a stage: after another, or first.', args: { id: z.string().min(1), after: z.string().optional(), first: z.boolean().optional() }, cmd: 'jobs', argv: (a) => ['stages', 'move', a.id, ...flag('after', a.after), ...flag('first', a.first)], readOnly: false }),

  // --- Change
  tool({
    name: 'task_add',
    title: 'Add a task',
    description: 'A task in the default to-do app. Todoist parses natural language in the text ("fri 5pm #School") itself.',
    args: { text: z.string().min(1), to: z.enum(['todoist', 'gtasks']).optional(), due: z.string().optional().describe('YYYY-MM-DD') },
    cmd: 'task',
    argv: (a) => ['add', a.text, ...flag('to', a.to), ...flag('due', a.due)],
    readOnly: false,
  }),
  tool({ name: 'task_done', title: 'Close a task', description: 'Close a Todoist or Google Tasks task (ids come from `todo`).', args: { id: z.string().min(1) }, cmd: 'task', argv: (a) => ['done', a.id], readOnly: false }),
  tool({ name: 'assignment_done', title: 'Mark an assignment done', description: 'Mark an assignment done on the dashboard only (Canvas is never written). `undo` clears it.', args: { id: z.string().min(1), undo: z.boolean().optional() }, cmd: 'done', argv: (a) => [a.id, ...flag('undo', a.undo)], readOnly: false }),
  tool({ name: 'link_add', title: 'Add a course link', description: 'A hotlink on a course.', args: { course, label: z.string().min(1), url: z.string().min(1) }, cmd: 'link', argv: (a) => ['add', a.course, a.label, a.url], readOnly: false }),
  tool({ name: 'link_rm', title: 'Remove a course link', description: 'Remove a hotlink from a course.', args: { course, label: z.string().min(1) }, cmd: 'link', argv: (a) => ['rm', a.course, a.label], readOnly: false }),
  tool({
    name: 'schedule_set',
    title: 'Set a course schedule',
    description: 'Replace the meetings of one session kind, e.g. lecture: ["mon,wed 14:00-14:50 @ CHE 2110"].',
    args: { course, kind: z.string().min(1).describe('lecture, discussion, lab, office_hours or any other kind.'), meetings: z.array(z.string().min(1)).min(1).describe('"<days> <start>-<end> [@ room]" each.') },
    cmd: 'schedule',
    argv: (a) => ['set', a.course, a.kind, ...a.meetings],
    readOnly: false,
  }),
  tool({ name: 'schedule_rm', title: 'Remove a course schedule', description: 'Remove every meeting of one session kind.', args: { course, kind: z.string().min(1) }, cmd: 'schedule', argv: (a) => ['rm', a.course, a.kind], readOnly: false }),
  tool({ name: 'notes_set', title: 'Set course notes', description: 'Replace the notes on a course.', args: { course, text: z.string() }, cmd: 'notes', argv: (a) => ['set', a.course, a.text], readOnly: false }),
  tool({ name: 'notes_clear', title: 'Clear course notes', description: 'Remove the notes on a course.', args: { course }, cmd: 'notes', argv: (a) => ['clear', a.course], readOnly: false }),
  tool({
    name: 'date_add',
    title: 'Add a date',
    description: 'An exam, quiz, final, cancelled or virtual session, or another dated note on a course.',
    args: {
      course,
      kind: z.enum(['exam', 'quiz', 'final', 'cancelled', 'virtual', 'other']),
      title: z.string().min(1),
      date: z.string().describe('YYYY-MM-DD'),
      start: z.string().optional().describe('HH:MM'),
      end: z.string().optional().describe('HH:MM'),
      location: z.string().optional(),
      note: z.string().optional(),
      session: z.string().optional().describe('The session kind a cancelled or virtual entry refers to, e.g. lecture.'),
    },
    cmd: 'date',
    argv: (a) => ['add', a.course, a.kind, a.title, a.date, ...flag('start', a.start), ...flag('end', a.end), ...flag('location', a.location), ...flag('note', a.note), ...flag('session', a.session)],
    readOnly: false,
  }),
  tool({ name: 'date_rm', title: 'Remove a date', description: 'Remove a hand-added date by its item id.', args: { id: z.string().min(1) }, cmd: 'date', argv: (a) => ['rm', a.id], readOnly: false }),
  tool({
    name: 'event_add',
    title: 'Add a calendar event',
    description: 'A Google Calendar event: timed (`at`, with `for` or `end`) or all-day (`on`, optionally `until`). `at`/`end` accept "2026-11-03 14:00", "today 14:00", "tomorrow 9:30" or "fri 17:00".',
    args: {
      title: z.string().min(1),
      at: z.string().optional(),
      for: z.string().optional().describe('A duration such as 1h30m; default 1h.'),
      end: z.string().optional(),
      on: z.string().optional().describe('YYYY-MM-DD for an all-day event.'),
      until: z.string().optional().describe('YYYY-MM-DD, the last day of a multi-day event.'),
      calendar: z.string().optional().describe('A calendar id or name; default the default calendar.'),
      location: z.string().optional(),
      note: z.string().optional(),
    },
    cmd: 'event',
    argv: (a) => ['add', a.title, ...flag('at', a.at), ...flag('for', a.for), ...flag('end', a.end), ...flag('on', a.on), ...flag('until', a.until), ...flag('calendar', a.calendar), ...flag('location', a.location), ...flag('note', a.note)],
    readOnly: false,
  }),
  tool({ name: 'event_calendars', title: 'List calendars', description: 'The connected Google calendars, with the default.', args: {}, cmd: 'event', argv: () => ['calendars'], readOnly: true }),
  tool({
    name: 'resync',
    title: 'Sync now',
    description: 'Run a source sync now and wait for it.',
    args: { source: z.enum(['canvas', 'gradescope', 'gcal', 'gcal_ical', 'todoist', 'gtasks', 'jobs', 'all']).optional().describe('Default all.') },
    cmd: 'resync',
    argv: (a) => (a.source ? [a.source] : []),
    readOnly: false,
  }),

  // --- Canvas, read-only through the server's proxy
  tool({
    name: 'canvas_ls',
    title: 'Browse Canvas',
    description: 'List a course\'s modules, files, pages, assignments or announcements straight from Canvas.',
    args: { course, what: z.enum(['modules', 'files', 'pages', 'assignments', 'announcements']).optional().describe('Default modules.') },
    cmd: 'canvas',
    argv: (a) => ['ls', a.course, ...(a.what ? [a.what] : [])],
    readOnly: true,
  }),
  tool({
    name: 'canvas_show',
    title: 'Read a Canvas page',
    description: 'The full text of a syllabus, page, assignment or announcement, with the ids of linked files.',
    args: { course, kind: z.enum(['syllabus', 'page', 'assignment', 'announcement']), id: z.string().optional().describe('The page slug or the assignment/announcement id; not needed for the syllabus.') },
    cmd: 'canvas',
    argv: (a) => ['show', a.course, a.kind, ...(a.id ? [a.id] : [])],
    readOnly: true,
  }),
  tool({ name: 'canvas_get', title: 'Canvas API GET', description: 'Any Canvas API GET through the read-only proxy, e.g. "/api/v1/courses/123/quizzes". `all` follows pagination.', args: { path: z.string().min(1), all: z.boolean().optional() }, cmd: 'canvas', argv: (a) => ['get', a.path, ...flag('all', a.all)], readOnly: true }),
];

export interface McpDeps {
  api: CollectedApi;
  cfg: Pick<AgentConfig, 'server' | 'freshness'>;
  /** Freshness notes in local mode; stderr by default. */
  warn?: (line: string) => void;
}

/** Runs one tool: a local-mode read syncs first when stale (freshness.ts), then the command with --json. */
export async function callTool(deps: McpDeps, spec: ToolSpec, args: Record<string, unknown>): Promise<{ text: string; isError?: boolean }> {
  const parsed = z.object(spec.args).parse(args);
  const argv = spec.argv(parsed);
  try {
    if (isLocal(deps.cfg) && spec.cmd in READ_SOURCES) {
      await ensureFresh(deps.api, spec.cmd, { maxAgeMinutes: maxAgeMinutes(deps.cfg), flags: {}, warn: deps.warn ?? ((l) => console.error(l)) });
    }
    return { text: await runCollected(deps.api, spec.cmd, [...argv, '--json']) };
  } catch (err) {
    if (err instanceof ApiError) {
      const detail = err.body && typeof err.body === 'object' && Object.keys(err.body as object).some((k) => k !== 'error') ? `\n${JSON.stringify(err.body, null, 2)}` : '';
      return { text: `${err.message}${detail}`, isError: true };
    }
    return { text: (err as Error).message, isError: true };
  }
}

export function buildServer(deps: McpDeps): McpServer {
  const server = new McpServer({ name: 'collected', version: cliVersion() }, { instructions: INSTRUCTIONS });
  for (const spec of TOOLS) {
    server.registerTool(
      spec.name,
      {
        title: spec.title,
        description: spec.description,
        inputSchema: spec.args,
        annotations: { readOnlyHint: spec.readOnly, destructiveHint: !!spec.destructive, idempotentHint: spec.readOnly, openWorldHint: false },
      },
      async (args: Record<string, unknown>) => {
        const r = await callTool(deps, spec, args ?? {});
        return { content: [{ type: 'text' as const, text: r.text }], ...(r.isError ? { isError: true } : {}) };
      },
    );
  }
  server.registerResource('help', 'collected://help', { title: 'collected CLI help', description: 'The command reference the tools mirror.', mimeType: 'text/plain' }, async (uri) => ({
    contents: [{ uri: uri.href, text: HELP }],
  }));
  return server;
}

/** What a client shows its model about this server. */
export const INSTRUCTIONS = `collected is a student's dashboard: courses, assignments, grades, calendar, to-dos and a job tracker.
Reads (courses, agenda, assignments, grades, jobs_*, canvas_*) are safe to call freely. Writes change one thing and say what it was before.
Ids come from the reads: assignment ids from assignments/agenda, task ids from todo, job ids from jobs_tracked/jobs_search.
A job stage can be any id (applied, screen, oa, interviewing, offer, rejected, hidden); a new one becomes a board column.
If a tool answers "this token has no … access", the token this server runs with is scoped; say so rather than retrying.`;

/** `collected mcp`: serve on stdio until the client goes away. */
export async function serveMcp(deps: McpDeps): Promise<void> {
  const server = buildServer(deps);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  await new Promise<void>((resolve) => {
    transport.onclose = () => resolve();
  });
}

// Every tool names a real command; checked once at load so a typo cannot ship.
for (const t of TOOLS) if (!isCollectedCommand(t.cmd)) throw new Error(`mcp tool ${t.name} names no command: ${t.cmd}`);
