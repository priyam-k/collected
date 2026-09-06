import { sourceConfigSchemas } from '@collected/shared';
import type { AppContext } from '../../context.js';
import type { NewItemRow } from '../../db/schema.js';
import { upsertItems } from '../../lib/items.js';
import { getSourceConfig } from '../../lib/sources.js';
import { addDays, isoOrNull } from '../../lib/time.js';
import { markerIn } from '../../sync/todoist-push.js';
import { wallClockToIso } from '../gradescope/parse.js';
import { NotConfiguredError, type Ingester } from '../types.js';
import { isClosed, type TLabel, type TProject, type TSection, type TTask, type TodoistApi } from './api.js';
import { TodoistHttpApi } from './client.js';

/**
 * Todoist due → ISO. In API v1 `due.date` is either `YYYY-MM-DD` (all-day) or a floating `YYYY-MM-DDTHH:MM:SS`
 * (with `due.timezone` when one was set); older payloads carry `due.datetime` (RFC3339). Never throws.
 */
export function dueToIso(due: TTask['due']): { dueAt: string | null; allDay: boolean } {
  if (!due) return { dueAt: null, allDay: false };
  const raw = due.datetime || due.date || '';
  if (!raw) return { dueAt: null, allDay: false };
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { dueAt: isoOrNull(`${raw}T23:59:00`), allDay: true };
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw)) return { dueAt: isoOrNull(raw), allDay: false };
  const local = raw.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2})?/);
  if (local) return { dueAt: due.timezone ? wallClockToIso(`${local[1]}T${local[2]}`, due.timezone) : isoOrNull(raw), allDay: false };
  return { dueAt: isoOrNull(raw), allDay: false };
}

export function taskToRow(t: TTask, ctx: { projects: Map<string, TProject>; sections: Map<string, TSection> }): NewItemRow {
  const mirrorOf = markerIn(t.description);
  const { dueAt, allDay } = dueToIso(t.due);
  const closed = isClosed(t);
  return {
    id: `todoist:${t.id}`,
    source: 'todoist',
    externalId: t.id,
    kind: 'task',
    courseId: null,
    title: t.content,
    description: t.description?.trim() ? t.description.slice(0, 2000) : null,
    url: `https://app.todoist.com/app/task/${t.id}`,
    dueAt,
    startsAt: null,
    endsAt: null,
    allDay,
    status: closed ? 'done' : 'open',
    points: null,
    score: null,
    labels: t.labels ?? [],
    raw: {
      projectId: t.project_id,
      projectName: ctx.projects.get(t.project_id)?.name ?? null,
      sectionId: t.section_id ?? null,
      sectionName: t.section_id ? (ctx.sections.get(t.section_id)?.name ?? null) : null,
      priority: t.priority ?? 1,
      recurring: !!t.due?.is_recurring,
      dueString: t.due?.string ?? null,
      completedAt: t.completed_at ?? null,
      mirror: !!mirrorOf,
      mirrorOf,
    },
  };
}

export async function syncTodoist(ctx: AppContext, api: TodoistApi): Promise<Record<string, number>> {
  const [projects, sections, labels, open] = await Promise.all([api.listProjects(), api.listSections(), api.listLabels(), api.listTasks()]);
  const now = new Date();
  const completed = await api.listCompleted(addDays(now, -30).toISOString(), now.toISOString());
  const maps = { projects: new Map(projects.map((p) => [p.id, p])), sections: new Map(sections.map((s) => [s.id, s])) };
  const rows = [...open, ...completed].map((t) => taskToRow(t, maps));
  // Open tasks are authoritative: anything open we no longer see was completed or deleted; completed rows age out.
  const r = await upsertItems(ctx, 'todoist', rows, []);
  return { projects: projects.length, sections: sections.length, labels: labels.length, open: open.length, completed: completed.length, upserted: r.upserted, created: r.created, deleted: r.deleted };
}

export async function todoistApiForCtx(ctx: AppContext): Promise<TodoistHttpApi> {
  const config = await getSourceConfig<{ token: string }>(ctx, 'todoist');
  if (!config?.token) throw new NotConfiguredError('Todoist API token not set');
  const { token } = sourceConfigSchemas.todoist.parse(config);
  return new TodoistHttpApi(token);
}

export const todoistIngester: Ingester = {
  id: 'todoist',
  intervalMinutes: 5,
  timeoutMs: 120_000,
  async run(ctx) {
    const api = await todoistApiForCtx(ctx);
    const counts = await syncTodoist(ctx, api);
    const [projects, labels] = await Promise.all([api.listProjects(), api.listLabels()]);
    return { counts, meta: { projects: projects.map((p) => ({ id: p.id, name: p.name })), labels: labels.map((l) => l.name) } };
  },
};

export type { TLabel };
