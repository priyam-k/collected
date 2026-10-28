import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { SOURCE_LABELS, TODO_APPS, resolveTodoApp, todoistPushConfigSchema, type TodoApp, type TodoistPushConfig } from '@collected/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useLiquid } from '@/lib/liquid';
import { cn } from '@/lib/utils';
import { useSaveSetting, useSettings, useSources, useTodoistPush, type PushPlan } from '@/lib/queries';
import { Field, PageTitle } from './ui';

const OP_VARIANT = { create: 'default', update: 'secondary', close: 'outline', delete: 'destructive' } as const;

export function TodoistPage() {
  const settings = useSettings();
  const sources = useSources();
  const save = useSaveSetting();
  const push = useTodoistPush();
  const [cfg, setCfg] = useState<TodoistPushConfig | null>(null);
  const [sectionsText, setSectionsText] = useState('');
  const [plan, setPlan] = useState<PushPlan | null>(null);

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
  const preview = () =>
    push.mutate({ dryRun: true }, { onSuccess: (r) => setPlan(r.plan), onError: (e) => toast.error(e.message) });
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
    <div className="space-y-6">
      <PageTitle sub="One-way: assignments become Todoist tasks and get closed when the source says done. Nothing you do in Todoist ever changes Canvas or Gradescope.">Todoist sync</PageTitle>
      {!todoist?.hasConfig && (
        <p className="rounded-2xl bg-[color-mix(in_srgb,var(--caution)_10%,var(--surface))] p-4 text-sm">
          Add your Todoist API token under <Link className="underline" to="/settings/sources">Sources</Link> first.
        </p>
      )}

      <section className="grid gap-4 sm:grid-cols-2">
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
          <Switch checked={cfg.enabled} onCheckedChange={(v) => saveAll({ ...cfg, enabled: v })} disabled={!todoist?.hasConfig} />
          <span>
            <span className="font-medium">Push after every Canvas / Gradescope sync</span>
            <span className="block text-xs text-muted-foreground">Preview first. Once on, new assignments show up in Todoist within a sync cycle.</span>
          </span>
        </label>
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={preview} disabled={push.isPending || !todoist?.hasConfig}>Preview what would change</Button>
          <Button onClick={runNow} disabled={push.isPending || !todoist?.hasConfig || !plan || plan.ops.length === 0}>Push now</Button>
          {plan && (
            <span className="text-xs text-muted-foreground">
              {plan.candidates} candidate assignments · {plan.mapped} already mapped{plan.rebuilt ? ` (${plan.rebuilt} rebuilt from markers)` : ''} · project “{plan.projectName}”
            </span>
          )}
        </div>
        {plan && (
          <div className="overflow-hidden rounded-xl border border-line">
            {plan.ops.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">Nothing to do. Todoist already matches.</p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {plan.ops.map((o) => (
                    <tr key={o.itemId + o.op} className="border-b last:border-0">
                      <td className="w-20 px-3 py-1.5"><Badge variant={OP_VARIANT[o.op]}>{o.op}</Badge></td>
                      <td className="px-3 py-1.5">{o.title}</td>
                      <td className="px-3 py-1.5 text-xs text-muted-foreground">{o.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {plan.skipped.length > 0 && <p className="border-t px-3 py-1.5 text-xs text-muted-foreground">{plan.skipped.length} skipped (done, or already closed in Todoist).</p>}
          </div>
        )}
      </section>

      <ToDoApps />

      <section className="space-y-2">
        <Field label="To-do widget sections" hint="Comma-separated Todoist labels, in display order. The homework section is always first.">
          <div className="flex gap-2">
            <Input value={sectionsText} onChange={(e) => setSectionsText(e.target.value)} placeholder="homework, grocery, cleaning, errands" />
            <Button variant="secondary" onClick={saveSections}>Save</Button>
          </div>
        </Field>
        {meta.labels?.length ? <p className="text-xs text-muted-foreground">Your labels: {meta.labels.join(', ')}</p> : null}
      </section>
    </div>
  );
}

/** Which app the to-do widget's add-task box sends to. Only connected apps can be picked. */
function ToDoApps() {
  const settings = useSettings();
  const sources = useSources();
  const save = useSaveSetting();
  const liquid = useLiquid();
  const connected = Object.fromEntries(TODO_APPS.map((a) => [a, sources.data?.find((s) => s.id === a)?.status === 'connected'])) as Record<TodoApp, boolean>;
  const current = resolveTodoApp(settings.data?.['todo.defaultApp'], connected);
  const pick = (app: TodoApp) => save.mutate({ key: 'todo.defaultApp', value: app }, { onError: (e) => toast.error(e.message) });
  return (
    <section className="space-y-2">
      <h3 className="label">To-do apps</h3>
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
        Tasks from every connected app show in the to-do widget and close in the app they came from. Assignments are pushed to Todoist only.
      </p>
    </section>
  );
}
