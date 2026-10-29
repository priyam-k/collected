import { eq } from 'drizzle-orm';
import { gtasksPushConfigSchema, type EffectiveItem, type GtasksPushConfig } from '@collected/shared';
import type { AppContext } from '../context.js';
import { gtasksMap } from '../db/schema.js';
import { splitExternalId, type GTask, type GTasksApi, type NewGTask } from '../ingest/gtasks/api.js';
import { getSetting, getSettingParsed } from '../lib/settings.js';
import { executePlan, markerFor, markerIn, planPushWith, sha1, type MapStore, type PushBackend, type PushPlan as CorePlan, type PushResult as CoreResult, type PushTask } from './push-core.js';

/**
 * The Google Tasks side of the assignment push (DECISIONS 050). Same core as Todoist; what differs is the app:
 * a task list instead of a project, no labels (the course code becomes a title prefix), a date-only due (the
 * time goes in the notes), the marker in `notes`, and task ids of the form `<listId>:<taskId>`.
 */

export interface GtasksPushPlan extends CorePlan<NewGTask> {
  listId: string | null;
  listName: string;
}

export interface GtasksPushResult extends CoreResult<NewGTask> {
  plan: GtasksPushPlan;
  listId: string | null;
}

/** The calendar day and the wall-clock time of an instant in the user's timezone. */
export function duePartsFor(dueAt: string, tz: string, allDay: boolean): { day: string; time: string | null } {
  const d = new Date(dueAt);
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  // Newer ICU puts a narrow no-break space before AM/PM; a plain space reads the same and survives a copy-paste.
  const time = allDay ? null : new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(d).replace(/[\u202f\u00a0]/g, ' ');
  return { day, time };
}

export function titleFor(item: EffectiveItem, cfg: GtasksPushConfig): string {
  const prefix = cfg.titlePrefix === 'course' && item.course?.code ? `[${item.course.code}] ` : '';
  return `${prefix}${item.title}`;
}

function notesFor(item: EffectiveItem, time: string | null): string {
  const lines: string[] = [];
  if (item.url) lines.push(item.url);
  const facts = [item.course?.code, item.points != null ? `${item.points} pts` : null, time ? `due ${time}` : null].filter((x): x is string => !!x);
  if (facts.length) lines.push(facts.join(' · '));
  lines.push('', markerFor(item));
  return lines.join('\n');
}

export function bodyFor(item: EffectiveItem, cfg: GtasksPushConfig, tz: string): NewGTask {
  const parts = item.dueAt ? duePartsFor(item.dueAt, tz, item.allDay) : null;
  const body: NewGTask = { title: titleFor(item, cfg), notes: notesFor(item, parts?.time ?? null) };
  if (parts) body.due = `${parts.day}T00:00:00.000Z`;
  return body;
}

export function hashBody(body: NewGTask): string {
  return sha1([body.title, body.due ?? null, body.notes ?? '']);
}

const dayOf = (due: string | null | undefined): string | null => due?.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;

/** Title, due day, and notes (which carry the time) must all read as the body for the task to count as current. */
function taskMatchesBody(task: GTask, body: NewGTask): boolean {
  return (task.title ?? '') === body.title && dayOf(task.due) === dayOf(body.due) && (task.notes ?? '') === (body.notes ?? '');
}

function gtasksMapStore(ctx: AppContext): MapStore {
  return {
    all: async () => (await ctx.db.select().from(gtasksMap)).map((m) => ({ itemId: m.itemId, taskId: m.gtasksTaskId, lastPushedHash: m.lastPushedHash, closedByUs: m.closedByUs })),
    created: async (itemId, taskId, hash) => {
      await ctx.db
        .insert(gtasksMap)
        .values({ itemId, gtasksTaskId: taskId, lastPushedHash: hash })
        .onConflictDoUpdate({ target: gtasksMap.itemId, set: { gtasksTaskId: taskId, lastPushedHash: hash, closedByUs: false } });
    },
    pushed: async (itemId, taskId, hash) => {
      await ctx.db.insert(gtasksMap).values({ itemId, gtasksTaskId: taskId, lastPushedHash: hash }).onConflictDoUpdate({ target: gtasksMap.itemId, set: { lastPushedHash: hash } });
    },
    closed: async (itemId, taskId) => {
      await ctx.db.insert(gtasksMap).values({ itemId, gtasksTaskId: taskId, closedByUs: true }).onConflictDoUpdate({ target: gtasksMap.itemId, set: { closedByUs: true } });
    },
    remove: async (itemId) => {
      await ctx.db.delete(gtasksMap).where(eq(gtasksMap.itemId, itemId));
    },
    ensure: async (itemId, taskId) => {
      await ctx.db.insert(gtasksMap).values({ itemId, gtasksTaskId: taskId }).onConflictDoNothing();
    },
  };
}

function split(taskId: string): { listId: string; taskId: string } {
  const ids = splitExternalId(taskId);
  if (!ids) throw new Error(`bad Google Tasks mapping id: ${taskId}`);
  return ids;
}

function gtasksBackend(ctx: AppContext, api: GTasksApi, cfg: GtasksPushConfig, tz: string): PushBackend<NewGTask> {
  const store = gtasksMapStore(ctx);
  const tasks = new Map<string, GTask>();
  return {
    kind: 'gtasks',
    store,
    async findTarget() {
      const lists = await api.listTaskLists();
      const list = lists.find((l) => l.title.trim().toLowerCase() === cfg.listName.trim().toLowerCase()) ?? null;
      return { id: list?.id ?? null, name: list?.title ?? cfg.listName };
    },
    /**
     * Every task in the target list, plus the lists existing mappings point at (so a renamed list keeps its tasks
     * instead of getting a duplicate set). A list that hits the fetch cap is not a trustworthy answer: refuse to plan.
     */
    async listTasks(listId) {
      const listIds = new Set<string>();
      if (listId) listIds.add(listId);
      for (const m of await store.all()) {
        const ids = splitExternalId(m.taskId);
        if (ids) listIds.add(ids.listId);
      }
      tasks.clear();
      const out: PushTask[] = [];
      for (const id of listIds) {
        let fetched: { tasks: GTask[]; truncated: boolean };
        try {
          fetched = await api.listTasks(id);
        } catch (err) {
          // A mapped list that no longer exists reads as "its tasks are gone", which the core respects without recreating.
          if (id !== listId && /404/.test(err instanceof Error ? err.message : '')) continue;
          throw err;
        }
        if (fetched.truncated) throw new Error(`Google Tasks list ${id} has more than the push can read in one run; not planning`);
        for (const t of fetched.tasks) {
          if (t.deleted) continue;
          const key = `${id}:${t.id}`;
          tasks.set(key, t);
          out.push({ id: key, closed: t.status === 'completed', marker: markerIn(t.notes) });
        }
      }
      return out;
    },
    bodyFor: (item) => bodyFor(item, cfg, tz),
    hashBody,
    taskMatches: (task, body) => {
      const t = tasks.get(task.id);
      return !!t && taskMatchesBody(t, body);
    },
    async prepare(plan) {
      let listId = plan.targetId;
      if (!listId && plan.ops.some((o) => o.op === 'create')) {
        const l = await api.insertTaskList(cfg.listName);
        listId = l.id;
        ctx.log.info({ list: l.title, id: l.id }, 'created Google Tasks list');
      }
      return listId;
    },
    async create(body, listId) {
      if (!listId) throw new Error('no Google Tasks list to create in');
      const t = await api.insertTask(listId, body);
      return { id: `${listId}:${t.id}` };
    },
    async update(taskId, body) {
      const ids = split(taskId);
      await api.updateTask(ids.listId, ids.taskId, body);
    },
    async close(taskId) {
      const ids = split(taskId);
      await api.completeTask(ids.listId, ids.taskId);
    },
    async delete(taskId) {
      const ids = split(taskId);
      await api.deleteTask(ids.listId, ids.taskId);
    },
  };
}

async function timezoneOf(ctx: AppContext): Promise<string> {
  const tz = await getSetting<string>(ctx, 'timezone');
  return typeof tz === 'string' && tz ? tz : (ctx.env.TZ ?? 'America/New_York');
}

/** Computes what a push would do. Pure with respect to Google Tasks (reads only); the plan is executed by executeGtasksPush. */
export async function planGtasksPush(ctx: AppContext, api: GTasksApi, cfgIn?: GtasksPushConfig): Promise<GtasksPushPlan> {
  const cfg = cfgIn ?? (await getSettingParsed(ctx, 'gtasks.push', gtasksPushConfigSchema));
  const plan = await planPushWith(ctx, gtasksBackend(ctx, api, cfg, await timezoneOf(ctx)));
  return { ...plan, listId: plan.targetId, listName: plan.targetName };
}

export async function executeGtasksPush(ctx: AppContext, api: GTasksApi, plan: GtasksPushPlan, cfgIn?: GtasksPushConfig): Promise<GtasksPushResult> {
  const cfg = cfgIn ?? (await getSettingParsed(ctx, 'gtasks.push', gtasksPushConfigSchema));
  const result = await executePlan(ctx, gtasksBackend(ctx, api, cfg, await timezoneOf(ctx)), plan);
  return { ...result, plan, listId: result.targetId };
}
