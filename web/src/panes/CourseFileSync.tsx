import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FolderSync, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { FILE_SYNC_SKIP, FILE_SYNC_UNSORTED, type Course, type FileSyncConfig, type FileSyncFileView, type FileSyncRule, type FileSyncTarget } from '@collected/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useFileSyncCourse, useFileSyncDevices, useSaveCourse, useSetFileSyncTarget } from '@/lib/queries';
import { friendlyDate } from '@/lib/time';
import { cn } from '@/lib/utils';

/*
 * "Sync to laptop" in the course drawer's Files tab (DESIGN "File sync to a laptop"). The server knows target names,
 * rules, and decisions; the agent on the laptop knows paths. This panel edits the former and shows both.
 */

const DEFAULT_CONFIG: FileSyncConfig = {
  enabled: true,
  targets: [
    { name: 'slides', description: 'lecture slides, lecture notes, recordings' },
    { name: 'assignments', description: 'homework, problem sets, projects, handouts, rubrics' },
    { name: 'admin', description: 'syllabus, schedule, policies, exam logistics' },
  ],
  rules: [],
  fallback: 'model',
  threshold: 0.6,
  skipHint: 'duplicates, temporary or scratch files, starter code archives, and anything not worth keeping',
};

const selectCls = 'h-7 rounded-md border bg-background px-1.5 text-xs';

function ConfigEditor({ course, initial, onDone }: { course: Course; initial: FileSyncConfig; onDone(): void }) {
  const save = useSaveCourse();
  const [cfg, setCfg] = useState<FileSyncConfig>(initial);
  const setTarget = (i: number, patch: Partial<FileSyncTarget>) => setCfg({ ...cfg, targets: cfg.targets.map((t, j) => (j === i ? { ...t, ...patch } : t)) });
  const setRule = (i: number, patch: Partial<FileSyncRule>) => setCfg({ ...cfg, rules: cfg.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const names = cfg.targets.map((t) => t.name.trim().toLowerCase()).filter(Boolean);
  const submit = () => {
    const fileSync: FileSyncConfig = {
      ...cfg,
      targets: cfg.targets.map((t) => ({ name: t.name.trim().toLowerCase(), description: t.description.trim() })).filter((t) => t.name),
      rules: cfg.rules.map((r) => ({ target: r.target, folder: r.folder?.trim() || null, module: r.module?.trim() || null, name: r.name?.trim() || null })),
    };
    save.mutate({ id: course.id, fileSync }, { onSuccess: () => { toast.success('Sync settings saved'); onDone(); }, onError: (e) => toast.error(e.message) });
  };
  return (
    <div className="space-y-3 rounded-2xl bg-well p-3.5">
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs font-semibold text-sub">Folders</span>
          <Button size="xs" variant="ghost" onClick={() => setCfg({ ...cfg, targets: [...cfg.targets, { name: '', description: '' }] })}><Plus className="size-3" /> Folder</Button>
        </div>
        <p className="mb-2 text-xs text-ter">A name and one line saying what belongs there. The agent on your laptop maps each name to a real folder (<code className="font-mono">collected-agent link</code>). The description is what the model reads.</p>
        <div className="space-y-1.5">
          {cfg.targets.map((t, i) => (
            <div key={i} className="grid grid-cols-[7rem_1fr_auto] items-center gap-1.5">
              <Input className="h-7 font-mono text-xs" placeholder="slides" value={t.name} onChange={(e) => setTarget(i, { name: e.target.value })} />
              <Input className="h-7 text-xs" placeholder="lecture slides and notes" value={t.description} onChange={(e) => setTarget(i, { description: e.target.value })} />
              <Button size="icon-xs" variant="ghost" aria-label="Remove folder" onClick={() => setCfg({ ...cfg, targets: cfg.targets.filter((_, j) => j !== i) })}><Trash2 className="size-3" /></Button>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs font-semibold text-sub">Rules</span>
          <Button size="xs" variant="ghost" onClick={() => setCfg({ ...cfg, rules: [...cfg.rules, { target: names[0] ?? FILE_SYNC_SKIP, folder: '', module: null, name: null }] })}><Plus className="size-3" /> Rule</Button>
        </div>
        <p className="mb-2 text-xs text-ter">Checked first, in order. Regexes, case-insensitive; every filled field must match. Files no rule matches go to the fallback below.</p>
        <div className="space-y-1.5">
          {cfg.rules.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto_auto] items-center gap-1.5">
              <Input className="h-7 font-mono text-xs" placeholder="Canvas folder, e.g. ^/Lectures" value={r.folder ?? ''} onChange={(e) => setRule(i, { folder: e.target.value })} />
              <Input className="h-7 font-mono text-xs" placeholder="module, e.g. ^Week" value={r.module ?? ''} onChange={(e) => setRule(i, { module: e.target.value })} />
              <Input className="h-7 font-mono text-xs" placeholder="filename, e.g. \.zip$" value={r.name ?? ''} onChange={(e) => setRule(i, { name: e.target.value })} />
              <select className={selectCls} value={r.target} onChange={(e) => setRule(i, { target: e.target.value })} aria-label="Rule target">
                {names.map((n) => <option key={n} value={n}>→ {n}</option>)}
                <option value={FILE_SYNC_SKIP}>→ skip</option>
              </select>
              <Button size="icon-xs" variant="ghost" aria-label="Remove rule" onClick={() => setCfg({ ...cfg, rules: cfg.rules.filter((_, j) => j !== i) })}><Trash2 className="size-3" /></Button>
            </div>
          ))}
          {!cfg.rules.length && <p className="text-xs text-ter">No rules yet. Add one, or let the model sort everything and turn its answers into rules from the list below.</p>}
        </div>
      </div>

      <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-xs">
        <span className="text-sub">Unmatched files</span>
        <select className={cn(selectCls, 'w-fit')} value={cfg.fallback} onChange={(e) => setCfg({ ...cfg, fallback: e.target.value as FileSyncConfig['fallback'] })}>
          <option value="model">ask the model on the laptop</option>
          <option value="unsorted">put in “unsorted”</option>
          <option value="skip">skip</option>
        </select>
        {cfg.fallback === 'model' && (
          <>
            <span className="text-sub">Confidence needed</span>
            <span className="flex items-center gap-2">
              <Input className="h-7 w-16 text-xs" type="number" min={0} max={1} step={0.05} value={cfg.threshold} onChange={(e) => setCfg({ ...cfg, threshold: Math.min(1, Math.max(0, Number(e.target.value) || 0)) })} />
              <span className="text-ter">below this the file goes to “unsorted” for you to place</span>
            </span>
            <span className="text-sub">Skip when</span>
            <Input className="h-7 text-xs" value={cfg.skipHint} onChange={(e) => setCfg({ ...cfg, skipHint: e.target.value })} />
          </>
        )}
      </div>

      <div className="flex items-center justify-end gap-1">
        <Button size="xs" variant="ghost" onClick={onDone}>Cancel</Button>
        <Button size="xs" onClick={submit} disabled={save.isPending || !names.length}>Save</Button>
      </div>
    </div>
  );
}

const targetTone = (t: string): string => (t === FILE_SYNC_SKIP ? 'text-ter line-through' : t === FILE_SYNC_UNSORTED ? 'text-amber' : 'text-indigo');

function DecisionRow({ f, course, config, last }: { f: FileSyncFileView; course: Course; config: FileSyncConfig; last: boolean }) {
  const set = useSetFileSyncTarget();
  const save = useSaveCourse();
  const d = f.decision;
  const makeRule = () => {
    if (!d || !f.folderPath) return;
    const folder = `^${f.folderPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`;
    save.mutate({ id: course.id, fileSync: { ...config, rules: [...config.rules, { target: d.target, folder, module: null, name: null }] } }, { onSuccess: () => toast.success(`Rule added: ${f.folderPath} → ${d.target}`), onError: (e) => toast.error(e.message) });
  };
  const runnerUp = f.model?.probabilities
    ? Object.entries(f.model.probabilities).sort((a, b) => b[1] - a[1]).find(([k]) => k !== f.model!.target)
    : null;
  return (
    <div className={cn('group/row flex items-center gap-2 px-3.5 py-2 text-[13px]', !last && 'border-b border-line')}>
      <div className="min-w-0 flex-1">
        <div className="truncate">{f.title}</div>
        <div className="truncate text-[11px] text-ter">
          {[f.folderPath, f.moduleName].filter(Boolean).join(' · ') || 'no folder'}
          {d && <span> · {d.reason}{runnerUp && d.decidedBy === 'model' ? `, then ${runnerUp[0]} ${runnerUp[1].toFixed(2)}` : ''}</span>}
          {f.placed && <span> · on {f.placed.device}</span>}
        </div>
      </div>
      {d?.decidedBy === 'model' && f.folderPath && d.target !== FILE_SYNC_UNSORTED && (
        <button className="shrink-0 text-[11px] text-indigo opacity-0 hover:underline group-hover/row:opacity-100" onClick={makeRule} title={`Always send ${f.folderPath} to ${d.target}`}>make rule</button>
      )}
      <select
        className={cn(selectCls, 'shrink-0 font-medium', d ? targetTone(d.target) : 'text-ter', f.manualTarget && 'ring-1 ring-indigo/40')}
        value={f.manualTarget ?? ''}
        onChange={(e) => set.mutate({ courseId: course.id, fileId: f.fileId, target: e.target.value || null }, { onError: (err) => toast.error(err.message) })}
        aria-label={`Folder for ${f.title}`}
      >
        <option value="">{d ? `${d.target}${d.decidedBy === 'manual' ? '' : ' (auto)'}` : 'waiting for model'}</option>
        {config.targets.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
        <option value={FILE_SYNC_UNSORTED}>unsorted</option>
        <option value={FILE_SYNC_SKIP}>skip</option>
      </select>
    </div>
  );
}

type Filter = 'all' | 'unsorted' | 'pending' | 'skip';

/** Collapsed by default: the drawer is for the course, this is plumbing. The header line says the little that matters. */
export function CourseFileSync({ course }: { course: Course }) {
  const cfg = course.fileSync;
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const save = useSaveCourse();
  const viewQ = useFileSyncCourse(course.id, !!cfg);
  const devicesQ = useFileSyncDevices();
  const devices = useMemo(() => (devicesQ.data ?? []).filter((d) => d.targets[course.id]), [devicesQ.data, course.id]);

  const files = viewQ.data?.files ?? [];
  const counts = {
    unsorted: files.filter((f) => f.decision?.target === FILE_SYNC_UNSORTED).length,
    pending: files.filter((f) => !f.decision).length,
    skip: files.filter((f) => f.decision?.target === FILE_SYNC_SKIP).length,
  };
  const summary = !cfg
    ? 'not set up'
    : !cfg.enabled
      ? 'paused'
      : [`${files.length} files`, counts.unsorted && `${counts.unsorted} unsorted`, counts.pending && `${counts.pending} waiting for model`, devices[0] && `synced ${friendlyDate(devices[0].lastRunAt)}`].filter(Boolean).join(' · ');
  const attention = !!cfg?.enabled && (counts.unsorted > 0 || counts.pending > 0);

  const header = (
    <button type="button" className="flex w-full items-center gap-1.5 px-1.5 pb-2 text-left" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
      {open ? <ChevronDown className="size-3.5 shrink-0 text-ter" /> : <ChevronRight className="size-3.5 shrink-0 text-ter" />}
      <span className="text-[13px] font-semibold text-sub">Sync to laptop</span>
      <span className={cn('min-w-0 truncate text-[12px]', attention ? 'text-amber' : 'text-ter')}>· {summary}</span>
    </button>
  );
  if (!open) return <section>{header}</section>;

  if (!cfg) {
    return (
      <section>
        {header}
        <div className="rounded-2xl bg-well p-4 text-[13px]">
          <div className="mb-1 flex items-center gap-2 font-medium"><FolderSync className="size-4 text-indigo" /> Keep this course's files in folders on your laptop</div>
          <p className="mb-3 text-xs text-ter">New Canvas files land in named folders (slides, assignments, …) automatically, sorted by rules you write or by a decision model for the rest. Nothing is overwritten once you've edited it.</p>
          {editing ? <ConfigEditor course={course} initial={DEFAULT_CONFIG} onDone={() => setEditing(false)} /> : <Button size="xs" onClick={() => setEditing(true)}>Set up</Button>}
        </div>
      </section>
    );
  }

  const shown = files.filter((f) => (filter === 'all' ? true : filter === 'pending' ? !f.decision : f.decision?.target === filter));
  const toggle = (enabled: boolean) => save.mutate({ id: course.id, fileSync: { ...cfg, enabled } }, { onError: (e) => toast.error(e.message) });

  return (
    <section className="flex flex-col gap-2.5">
      {header}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-1 text-[13px]">
        <Switch size="sm" checked={cfg.enabled} onCheckedChange={toggle} aria-label="Sync this course's files" />
        <span className={cn('min-w-0 truncate', !cfg.enabled && 'text-ter')}>
          {cfg.enabled ? 'Syncing' : 'Paused'} · {cfg.targets.map((t) => t.name).join(', ')} · {cfg.rules.length} rule{cfg.rules.length === 1 ? '' : 's'} · unmatched: {cfg.fallback === 'model' ? `model ≥ ${cfg.threshold}` : cfg.fallback}
        </span>
        <span className="flex-1" />
        {!editing && <Button size="xs" variant="secondary" onClick={() => setEditing(true)}>Edit</Button>}
      </div>
      {editing && <ConfigEditor course={course} initial={cfg} onDone={() => setEditing(false)} />}

      <div className="px-1 text-[11.5px] text-ter">
        {devices.length ? (
          devices.map((d) => (
            <div key={d.device} className="truncate" title={Object.entries(d.targets[course.id] ?? {}).map(([n, p]) => `${n} → ${p}`).join('\n')}>
              <span className="font-medium text-sub">{d.device}</span> · synced {friendlyDate(d.lastRunAt)}{d.model ? ' · model on' : ''} ·{' '}
              {(() => {
                const paths = Object.values(d.targets[course.id] ?? {});
                const root = paths.length ? paths[0]!.replace(/\/[^/]+$/, '').replace(/^\/Users\/[^/]+/, '~') : null;
                return root ? `${root}/{${Object.keys(d.targets[course.id] ?? {}).join(',')}}` : 'no folders linked';
              })()}
              {d.errors.length > 0 && <span className="text-amber"> · {d.errors.length} error{d.errors.length === 1 ? '' : 's'}: {d.errors[0]!.message}</span>}
            </div>
          ))
        ) : (
          <span>No laptop has synced this course yet. On the laptop: <code className="font-mono">collected-agent link {course.id} ~/school/{course.code.toLowerCase()}</code> then <code className="font-mono">collected-agent sync --dry-run</code>.</span>
        )}
      </div>

      {files.length > 0 && (
        <div className="flex items-center gap-1.5 px-1">
          {(['all', 'unsorted', 'pending', 'skip'] as Filter[]).map((k) => {
            const n = k === 'all' ? files.length : counts[k];
            if (k !== 'all' && !n) return null;
            const label = k === 'pending' ? 'waiting for model' : k;
            return (
              <button key={k} type="button" className={cn('chip', filter === k && 'chip-on')} onClick={() => setFilter(k)}>
                {`${label} · ${n}`}
              </button>
            );
          })}
        </div>
      )}

      {viewQ.isPending ? (
        <div className="h-16 animate-pulse rounded-2xl bg-well" />
      ) : shown.length ? (
        <div className="overflow-hidden rounded-2xl bg-well">{shown.map((f, i) => <DecisionRow key={f.fileId} f={f} course={course} config={cfg} last={i === shown.length - 1} />)}</div>
      ) : (
        <div className="rounded-2xl bg-well p-4 text-center text-[13px] text-ter">{files.length ? 'Nothing here.' : 'No files synced from Canvas yet.'}</div>
      )}
    </section>
  );
}
