import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { SOURCE_LABELS, TODO_APPS, resolveTodoApp, todoistPushConfigSchema, type TodoApp, type TodoistPushConfig } from '@collected/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useLiquid } from '@/lib/liquid';
import { relative } from '@/lib/time';
import { cn } from '@/lib/utils';
import {
  GTASKS_PUSH_DEFAULTS,
  useGtasksConfig,
  useGtasksPush,
  useSaveGtasksConfig,
  useSaveSetting,
  useSettings,
  useSources,
  useTodoStatus,
  useTodoistPush,
  type GtasksPushConfig,
  type PushPlan,
  type PushResult,
  type TodoAppStatus,
} from '@/lib/queries';
import { Field, PageTitle, Section, StatusTag } from './ui';

const OP_VARIANT = { create: 'default', update: 'secondary', close: 'outline', delete: 'destructive' } as const;

type AppState = TodoAppStatus & { hasConfig: boolean; known: boolean };

/**
 * Connection and push state per app. `/api/todo/status` is the source of truth; until the server has it, fall back to
 * the sources list (connected, enabled) and leave push state unknown.
 */
function useAppStates(): Record<TodoApp, AppState> {
  const status = useTodoStatus();
  const sources = useSources();
  return Object.fromEntries(
    TODO_APPS.map((a) => {
      const src = sources.data?.find((s) => s.id === a);
      const st = status.data?.[a];
      return [
        a,
        {
          connected: st?.connected ?? src?.status === 'connected',
          enabled: st?.enabled ?? src?.enabled ?? false,
          pushEnabled: st?.pushEnabled ?? false,
          lastPushAt: st?.lastPushAt ?? null,
          hasConfig: src?.hasConfig ?? false,
          known: !!st,
        },
      ];
    }),
  ) as Record<TodoApp, AppState>;
}

export function TodoSyncPage() {
  const apps = useAppStates();
  return (
    <div className="space-y-10">
      <PageTitle sub="One-way: assignments become tasks in your to-do apps and get closed when the source says done. Nothing you do in Todoist or Google Tasks ever changes Canvas or Gradescope.">
        To-do sync
      </PageTitle>
      <AppsSection apps={apps} />
      <AppSection app="todoist" state={apps.todoist}>
        <TodoistSettings hasConfig={apps.todoist.hasConfig} />
      </AppSection>
      <AppSection app="gtasks" state={apps.gtasks}>
        <GtasksSettings hasConfig={apps.gtasks.hasConfig} />
      </AppSection>
    </div>
  );
}

/* ---------- Apps overview ---------- */

function ConnectedTag({ connected }: { connected: boolean }) {
  return <StatusTag tone={connected ? 'ok' : 'off'}>{connected ? 'connected' : 'not connected'}</StatusTag>;
}

function AppsSection({ apps }: { apps: Record<TodoApp, AppState> }) {
  return (
    <Section title="Apps">
      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
        {TODO_APPS.map((a) => {
          const s = apps[a];
          const facts = [s.enabled ? 'enabled' : 'disabled', ...(s.known ? [s.pushEnabled ? 'push on' : 'push off', s.lastPushAt ? `last push ${relative(s.lastPushAt)}` : 'never pushed'] : [])];
          return (
            <li key={a} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[15px] font-medium">{SOURCE_LABELS[a]}</span>
                  <ConnectedTag connected={s.connected} />
                </div>
                {s.connected && <p className="mt-1 text-xs text-ink-muted">{facts.join(' · ')}</p>}
              </div>
              {s.connected ? (
                <a href={`#todo-${a}`} className="text-[13px] text-sub underline-offset-4 hover:text-ink hover:underline">
                  Push settings
                </a>
              ) : (
                <Link to="/settings/sources" className="text-[13px] font-medium text-ink underline underline-offset-4 hover:text-sub">
                  Connect under Sources
                </Link>
              )}
            </li>
          );
        })}
      </ul>
      <ToDoApps connected={{ todoist: apps.todoist.connected, gtasks: apps.gtasks.connected }} />
    </Section>
  );
}

/** Which app the to-do widget's add-task box sends to. Only connected apps can be picked. */
function ToDoApps({ connected }: { connected: Record<TodoApp, boolean> }) {
  const settings = useSettings();
  const save = useSaveSetting();
  const liquid = useLiquid();
  const current = resolveTodoApp(settings.data?.['todo.defaultApp'], connected);
  const pick = (app: TodoApp) => save.mutate({ key: 'todo.defaultApp', value: app }, { onError: (e) => toast.error(e.message) });
  const missing = TODO_APPS.filter((a) => !connected[a]);
  return (
    <div className="space-y-2 pt-2">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span>Add new tasks to:</span>
        <div className="seg" role="group" aria-label="Add new tasks to" ref={liquid}>
          {TODO_APPS.map((a) => (
            <button
              key={a}
              className={cn('min-w-[6rem] disabled:cursor-not-allowed disabled:opacity-40', current === a && 'seg-on')}
              aria-pressed={current === a}
              disabled={!connected[a] || save.isPending}
              title={connected[a] ? undefined : `Connect ${SOURCE_LABELS[a]} under Sources first`}
              onClick={() => pick(a)}
            >
              {SOURCE_LABELS[a]}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Tasks from every connected app show in the to-do widget and close in the app they came from.
        {missing.length > 0 && ` ${missing.map((a) => SOURCE_LABELS[a]).join(' and ')} can be picked once connected.`}
      </p>
    </div>
  );
}

/* ---------- Per-app section shell ---------- */

/** A per-app block: header with the status tag; dimmed with a notice while the app isn't connected (inputs stay usable). */
function AppSection({ app, state, children }: { app: TodoApp; state: AppState; children: ReactNode }) {
  const label = SOURCE_LABELS[app];
  return (
    <section id={`todo-${app}`} aria-labelledby={`todo-${app}-title`} className="scroll-mt-6 space-y-5 border-t border-line pt-8">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={`todo-${app}-title`} className="text-base font-semibold tracking-[-0.01em]">{label}</h3>
        <ConnectedTag connected={state.connected} />
      </div>
      {!state.connected && (
        <p className="rounded-2xl bg-[color-mix(in_srgb,var(--caution)_10%,var(--surface))] p-4 text-sm">
          Settings here do nothing until {label} is connected.{' '}
          <Link className="underline underline-offset-4" to="/settings/sources">Connect it under Sources</Link>.
        </p>
      )}
      <div className={cn('space-y-6 motion-safe:transition-opacity motion-safe:duration-200', !state.connected && 'opacity-55 focus-within:opacity-100 hover:opacity-90')}>{children}</div>
    </section>
  );
}

/* ---------- Preview + push, shared by both apps ---------- */

/** The rows a push would apply. */
export function PushPreview({ plan, appLabel }: { plan: PushPlan; appLabel: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-line">
      {plan.ops.length === 0 ? (
        <p className="p-3 text-sm text-muted-foreground">Nothing to do. {appLabel} already matches.</p>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {plan.ops.map((o) => (
              <tr key={o.itemId + o.op} className="border-b border-line last:border-0">
                <td className="w-20 px-3 py-1.5 align-top"><Badge variant={OP_VARIANT[o.op]}>{o.op}</Badge></td>
                <td className="px-3 py-1.5">
                  {o.title}
                  <span className="block text-xs text-muted-foreground sm:hidden">{o.reason}</span>
                </td>
                <td className="hidden px-3 py-1.5 text-xs text-muted-foreground sm:table-cell">{o.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {plan.skipped.length > 0 && <p className="border-t border-line px-3 py-1.5 text-xs text-muted-foreground">{plan.skipped.length} skipped (done, or already closed in {appLabel}).</p>}
    </div>
  );
}

interface PushMutation {
  mutate: (v: { dryRun?: boolean; force?: boolean }, o: { onSuccess: (r: PushResult) => void; onError: (e: Error) => void }) => void;
  isPending: boolean;
}

/** "Preview what would change" then "Push now". Push stays off until a preview shows something to do. */
function PushActions({ push, ready, appLabel, containerWord }: { push: PushMutation; ready: boolean; appLabel: string; containerWord: string }) {
  const [plan, setPlan] = useState<PushPlan | null>(null);
  const preview = () => push.mutate({ dryRun: true }, { onSuccess: (r) => setPlan(r.plan), onError: (e) => toast.error(e.message) });
  const runNow = () =>
    push.mutate(
      { force: true },
      {
        onSuccess: (r) => {
          toast.success(`Pushed: ${Object.entries(r.done ?? {}).map(([k, v]) => `${v} ${k}`).join(', ')}${r.errors?.length ? ` · ${r.errors.length} errors` : ''}`);
          setPlan(null);
        },
        onError: (e) => toast.error(e.message),
      },
    );
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={preview} disabled={push.isPending || !ready}>Preview what would change</Button>
        <Button onClick={runNow} disabled={push.isPending || !ready || !plan || plan.ops.length === 0}>Push now</Button>
        {plan && (
          <span className="text-xs text-muted-foreground">
            {plan.candidates} candidate assignments · {plan.mapped} already mapped{plan.rebuilt ? ` (${plan.rebuilt} rebuilt from markers)` : ''} · {containerWord} “{plan.projectName}”
          </span>
        )}
      </div>
      {plan && <PushPreview plan={plan} appLabel={appLabel} />}
    </div>
  );
}

/* ---------- Todoist ---------- */

function TodoistSettings({ hasConfig }: { hasConfig: boolean }) {
  const settings = useSettings();
  const sources = useSources();
  const save = useSaveSetting();
  const push = useTodoistPush();
  const [cfg, setCfg] = useState<TodoistPushConfig | null>(null);
  const [sectionsText, setSectionsText] = useState('');

  useEffect(() => {
    if (settings.data && !cfg) {
      setCfg(todoistPushConfigSchema.parse(settings.data['todoist.push'] ?? {}));
      setSectionsText(((settings.data['todo.sections'] as string[] | undefined) ?? []).join(', '));
    }
  }, [settings.data, cfg]);

  const todoist = sources.data?.find((s) => s.id === 'todoist');
  const meta = (todoist?.meta ?? {}) as { projects?: { id: string; name: string }[]; labels?: string[] };
  if (!cfg) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const saveAll = (next: TodoistPushConfig) => {
    setCfg(next);
    save.mutate({ key: 'todoist.push', value: next }, { onError: (e) => toast.error(e.message) });
  };
  const saveSections = () => {
    const list = sectionsText.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    save.mutate({ key: 'todo.sections', value: list }, { onSuccess: () => toast.success('Sections saved') });
  };

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Project" hint="Tasks are created here. Created for you if it doesn't exist.">
          {meta.projects?.length ? (
            <select
              className="h-9 w-full rounded-[10px] border border-line2 bg-well px-2 text-sm"
              value={cfg.projectId ?? ''}
              onChange={(e) => {
                const p = meta.projects!.find((x) => x.id === e.target.value);
                saveAll({ ...cfg, projectId: p?.id ?? null, projectName: p?.name ?? cfg.projectName });
              }}
            >
              <option value="">{cfg.projectName} (by name)</option>
              {meta.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          ) : (
            <Input value={cfg.projectName} onChange={(e) => setCfg({ ...cfg, projectName: e.target.value })} onBlur={() => saveAll(cfg)} />
          )}
        </Field>
        <Field label="Label on every pushed task">
          <Input value={cfg.commonLabel} onChange={(e) => setCfg({ ...cfg, commonLabel: e.target.value.trim().toLowerCase() })} onBlur={() => saveAll(cfg)} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={cfg.courseLabels} onCheckedChange={(v) => saveAll({ ...cfg, courseLabels: v })} /> Also add a per-course label (cmsc422, math423, …)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={cfg.enabled} onCheckedChange={(v) => saveAll({ ...cfg, enabled: v })} disabled={!hasConfig} />
          <span>
            <span className="font-medium">Push after every Canvas / Gradescope sync</span>
            <span className="block text-xs text-muted-foreground">Preview first. Once on, new assignments show up in Todoist within a sync cycle.</span>
          </span>
        </label>
      </div>

      <PushActions push={push} ready={hasConfig} appLabel="Todoist" containerWord="project" />

      <div className="space-y-2">
        <Field label="To-do widget sections" hint="Comma-separated Todoist labels, in display order. The homework section is always first.">
          <div className="flex gap-2">
            <Input value={sectionsText} onChange={(e) => setSectionsText(e.target.value)} placeholder="homework, grocery, cleaning, errands" />
            <Button variant="secondary" onClick={saveSections}>Save</Button>
          </div>
        </Field>
        {meta.labels?.length ? <p className="text-xs text-muted-foreground">Your labels: {meta.labels.join(', ')}</p> : null}
      </div>
    </>
  );
}

/* ---------- Google Tasks ---------- */

function readGtasksConfig(raw: unknown): GtasksPushConfig {
  const o = raw && typeof raw === 'object' ? (raw as Partial<GtasksPushConfig>) : {};
  return {
    enabled: typeof o.enabled === 'boolean' ? o.enabled : GTASKS_PUSH_DEFAULTS.enabled,
    listName: typeof o.listName === 'string' && o.listName.trim() ? o.listName : GTASKS_PUSH_DEFAULTS.listName,
    titlePrefix: o.titlePrefix === 'none' ? 'none' : 'course',
  };
}

const PREFIX_OPTIONS = [
  { value: 'course', label: 'Course code' },
  { value: 'none', label: 'None' },
] as const;

function GtasksSettings({ hasConfig }: { hasConfig: boolean }) {
  const config = useGtasksConfig();
  const settings = useSettings();
  const save = useSaveGtasksConfig();
  const push = useGtasksPush();
  const liquid = useLiquid();
  const [cfg, setCfg] = useState<GtasksPushConfig | null>(null);

  useEffect(() => {
    if (cfg || config.isPending || settings.isPending) return;
    // The config route is the contract; the raw setting covers a server that doesn't serve it yet.
    setCfg(readGtasksConfig(config.data ?? settings.data?.['gtasks.push']));
  }, [cfg, config.isPending, config.data, settings.isPending, settings.data]);

  if (!cfg) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const saveAll = (next: GtasksPushConfig) => {
    setCfg(next);
    save.mutate(next, { onError: (e) => toast.error(e.message) });
  };

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="List name" hint="Tasks are created in this list. Created for you if it doesn't exist.">
          <Input
            value={cfg.listName}
            maxLength={100}
            onChange={(e) => setCfg({ ...cfg, listName: e.target.value })}
            onBlur={() => saveAll({ ...cfg, listName: cfg.listName.trim() || GTASKS_PUSH_DEFAULTS.listName })}
          />
        </Field>
        <div className="space-y-1.5">
          <span id="gtasks-prefix-label" className="block text-[13px] font-medium text-sub">Title prefix</span>
          <div className="seg" role="group" aria-labelledby="gtasks-prefix-label" ref={liquid}>
            {PREFIX_OPTIONS.map((o) => (
              <button key={o.value} type="button" className={cn('min-w-[6rem]', cfg.titlePrefix === o.value && 'seg-on')} aria-pressed={cfg.titlePrefix === o.value} onClick={() => saveAll({ ...cfg, titlePrefix: o.value })}>
                {o.label}
              </button>
            ))}
          </div>
          <span className="block text-xs text-muted-foreground">Google Tasks has no labels, so the course code can lead the title instead.</span>
        </div>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <Switch checked={cfg.enabled} onCheckedChange={(v) => saveAll({ ...cfg, enabled: v })} disabled={!hasConfig} />
          <span>
            <span className="font-medium">Push after every Canvas / Gradescope sync</span>
            <span className="block text-xs text-muted-foreground">Preview first. Once on, new assignments show up in Google Tasks within a sync cycle.</span>
          </span>
        </label>
      </div>

      <PushActions push={push} ready={hasConfig} appLabel="Google Tasks" containerWord="list" />
    </>
  );
}
