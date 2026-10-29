import { eq, isNotNull } from 'drizzle-orm';
import { todoistPushConfigSchema, type EffectiveItem, type TodoistPushConfig } from '@collected/shared';
import type { AppContext } from '../context.js';
import { courses, todoistMap } from '../db/schema.js';
import { getSettingParsed } from '../lib/settings.js';
import { addDays } from '../lib/time.js';
import { isClosed, type NewTaskBody, type TTask, type TodoistApi } from '../ingest/todoist/api.js';
import { executePlan, markerFor, markerIn, planPushWith, sha1, type MapStore, type PushBackend, type PushPlan as CorePlan, type PushResult as CoreResult, type PushTask } from './push-core.js';

export { MARKER_PREFIX, MAX_DELETE_FLOOR, MAX_DELETE_SHARE, PUSH_FUTURE_DAYS, PUSH_PAST_DAYS, markerFor, markerIn } from './push-core.js';
export type { PushOp, PushOpKind } from './push-core.js';

/** The Todoist plan: the core's, with the project under its own name (the settings page and the CLI read these). */
export interface PushPlan extends CorePlan<NewTaskBody> {
  projectId: string | null;
  projectName: string;
}

export interface PushResult extends CoreResult<NewTaskBody> {
  plan: PushPlan;
  projectId: string | null;
}

function description(item: EffectiveItem): string {
  const lines: string[] = [];
  if (item.url) lines.push(item.url);
  if (item.course?.code) lines.push(`${item.course.code}${item.points != null ? ` · ${item.points} pts` : ''}`);
  lines.push('', markerFor(item));
  return lines.join('\n');
}

function labelsFor(item: EffectiveItem, cfg: TodoistPushConfig): string[] {
  const labels = [cfg.commonLabel];
  if (cfg.courseLabels && item.course?.code) labels.push(item.course.code.toLowerCase());
  return labels;
}

export function bodyFor(item: EffectiveItem, cfg: TodoistPushConfig, projectId: string | null): NewTaskBody {
  const body: NewTaskBody = { content: item.title, description: description(item), labels: labelsFor(item, cfg) };
  if (projectId) body.project_id = projectId;
  if (item.dueAt) body.due_datetime = new Date(item.dueAt).toISOString();
  return body;
}

export function hashBody(body: NewTaskBody): string {
  return sha1([body.content, body.due_datetime ?? body.due_date ?? null, body.labels ?? [], body.description ?? '']);
}

function taskMatchesBody(task: TTask, body: NewTaskBody): boolean {
  const rawDue = task.due?.datetime || task.due?.date || null;
  const parsed = rawDue && !/^\d{4}-\d{2}-\d{2}$/.test(rawDue) ? new Date(rawDue) : null;
  const taskDue = parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : rawDue;
  const wantDue = body.due_datetime ?? body.due_date ?? null;
  const sameLabels = [...(task.labels ?? [])].sort().join(',') === [...(body.labels ?? [])].sort().join(',');
  return task.content === body.content && taskDue === wantDue && sameLabels;
}

function todoistMapStore(ctx: AppContext): MapStore {
  return {
    all: async () => (await ctx.db.select().from(todoistMap)).map((m) => ({ itemId: m.itemId, taskId: m.todoistTaskId, lastPushedHash: m.lastPushedHash, closedByUs: m.closedByUs })),
    created: async (itemId, taskId, hash) => {
      await ctx.db
        .insert(todoistMap)
        .values({ itemId, todoistTaskId: taskId, lastPushedHash: hash })
        .onConflictDoUpdate({ target: todoistMap.itemId, set: { todoistTaskId: taskId, lastPushedHash: hash, closedByUs: false } });
    },
    pushed: async (itemId, taskId, hash) => {
      await ctx.db.insert(todoistMap).values({ itemId, todoistTaskId: taskId, lastPushedHash: hash }).onConflictDoUpdate({ target: todoistMap.itemId, set: { lastPushedHash: hash } });
    },
    closed: async (itemId, taskId) => {
      await ctx.db.insert(todoistMap).values({ itemId, todoistTaskId: taskId, closedByUs: true }).onConflictDoUpdate({ target: todoistMap.itemId, set: { closedByUs: true } });
    },
    remove: async (itemId) => {
      await ctx.db.delete(todoistMap).where(eq(todoistMap.itemId, itemId));
    },
    ensure: async (itemId, taskId) => {
      await ctx.db.insert(todoistMap).values({ itemId, todoistTaskId: taskId }).onConflictDoNothing();
    },
  };
}

/** The Todoist side of the push: project = target, labels, due with time, marker in the description. */
function todoistBackend(ctx: AppContext, api: TodoistApi, cfg: TodoistPushConfig): PushBackend<NewTaskBody> {
  const tasks = new Map<string, TTask>();
  const asPushTask = (t: TTask): PushTask => ({ id: t.id, closed: isClosed(t), marker: markerIn(t.description) });
  return {
    kind: 'todoist',
    store: todoistMapStore(ctx),
    async findTarget() {
      const projects = await api.listProjects();
      const project = (cfg.projectId && projects.find((p) => p.id === cfg.projectId)) || projects.find((p) => p.name.toLowerCase() === cfg.projectName.toLowerCase()) || null;
      return { id: project?.id ?? null, name: project?.name ?? cfg.projectName };
    },
    // Open tasks in the project (or anywhere if no project yet) + recently completed, for closed-state.
    async listTasks(projectId) {
      const now = new Date();
      const openTasks = await api.listTasks(projectId ? { projectId } : undefined);
      const completed = await api.listCompleted(addDays(now, -90).toISOString(), now.toISOString());
      tasks.clear();
      for (const t of [...completed, ...openTasks]) tasks.set(t.id, t); // an open copy wins over a stale completed one
      const seen = new Set<string>();
      const out: PushTask[] = [];
      for (const t of [...openTasks, ...completed]) {
        if (seen.has(t.id)) continue;
        seen.add(t.id);
        out.push(asPushTask(tasks.get(t.id)!));
      }
      return out;
    },
    bodyFor: (item, projectId) => bodyFor(item, cfg, projectId),
    hashBody,
    taskMatches: (task, body) => {
      const t = tasks.get(task.id);
      return !!t && taskMatchesBody(t, body);
    },
    async prepare(plan) {
      let projectId = plan.targetId;
      if (!projectId && plan.ops.some((o) => o.op === 'create')) {
        const p = await api.createProject(cfg.projectName);
        projectId = p.id;
        ctx.log.info({ project: p.name, id: p.id }, 'created Todoist project');
      }
      // Make sure labels exist (Todoist creates unknown labels on the fly for most accounts, but be explicit).
      const wanted = new Set(plan.ops.flatMap((o) => o.body?.labels ?? []));
      if (wanted.size) {
        const have = new Set((await api.listLabels()).map((l) => l.name.toLowerCase()));
        for (const name of wanted) if (!have.has(name.toLowerCase())) await api.createLabel(name).catch(() => undefined);
      }
      return projectId;
    },
    async create(body, projectId) {
      const t = await api.createTask({ ...body, project_id: projectId ?? body.project_id });
      return { id: t.id };
    },
    async update(taskId, body) {
      const { project_id: _p, ...rest } = body;
      await api.updateTask(taskId, rest);
    },
    close: (taskId) => api.closeTask(taskId),
    delete: (taskId) => api.deleteTask(taskId),
  };
}

/**
 * Computes what a push would do. Pure with respect to Todoist (reads only); the plan is executed by executePush.
 * The rules live in push-core.ts.
 */
export async function planPush(ctx: AppContext, api: TodoistApi, cfgIn?: TodoistPushConfig): Promise<PushPlan> {
  const cfg = cfgIn ?? (await getSettingParsed(ctx, 'todoist.push', todoistPushConfigSchema));
  const plan = await planPushWith(ctx, todoistBackend(ctx, api, cfg));
  return { ...plan, projectId: plan.targetId, projectName: plan.targetName };
}

export async function executePush(ctx: AppContext, api: TodoistApi, plan: PushPlan, cfgIn?: TodoistPushConfig): Promise<PushResult> {
  const cfg = cfgIn ?? (await getSettingParsed(ctx, 'todoist.push', todoistPushConfigSchema));
  const result = await executePlan(ctx, todoistBackend(ctx, api, cfg), plan);
  return { ...result, plan, projectId: result.targetId };
}

/** Course labels we might need, for the settings preview. */
export async function courseLabelNames(ctx: AppContext): Promise<string[]> {
  const rows = await ctx.db.select({ code: courses.code }).from(courses).where(isNotNull(courses.code));
  return rows.map((r) => r.code.toLowerCase());
}
