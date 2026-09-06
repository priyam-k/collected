import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { CornerDownRight, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { SOURCE_LABELS, todoistPushConfigSchema, type EffectiveItem } from '@collected/shared';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { useCloseTodoistTask, useItems, useQuickAddTask, useSetOverride, useSettings, useSources } from '@/lib/queries';
import { isPast } from '@/lib/time';
import { cn } from '@/lib/utils';
import { ItemPopover } from '@/widgets/ItemPopover';
import { EmptyState, ErrorState } from '@/widgets/Placeholder';
import { CourseDot, DueLabel, StatusBadge, windowFromNow } from '@/widgets/shared';
import type { WidgetProps } from '@/widgets/types';

interface Row {
  item: EffectiveItem;
  depth: number;
}

interface Section {
  key: string;
  label: string;
  rows: Row[];
}

const parentIdOf = (it: EffectiveItem): string | null => (it.source === 'todoist' ? ((it.raw as { parentId?: string | null }).parentId ?? null) : null);

/** Overdue first (most overdue first), then by due date, undated last. */
function byUrgency(a: EffectiveItem, b: EffectiveItem): number {
  const da = a.dueAt ? new Date(a.dueAt).getTime() : Infinity;
  const db = b.dueAt ? new Date(b.dueAt).getTime() : Infinity;
  return da - db;
}

/** Orders items so Todoist subtasks follow their parent (indented). Orphans (parent not shown) stay top-level. */
function nest(items: EffectiveItem[]): Row[] {
  const byTodoistId = new Map(items.filter((i) => i.source === 'todoist').map((i) => [i.externalId, i]));
  const children = new Map<string, EffectiveItem[]>();
  const top: EffectiveItem[] = [];
  for (const it of items) {
    const pid = parentIdOf(it);
    if (pid && byTodoistId.has(pid)) children.set(pid, [...(children.get(pid) ?? []), it]);
    else top.push(it);
  }
  top.sort(byUrgency);
  const out: Row[] = [];
  const walk = (it: EffectiveItem, depth: number) => {
    out.push({ item: it, depth });
    for (const c of (children.get(it.externalId) ?? []).sort(byUrgency)) if (it.source === 'todoist') walk(c, depth + 1);
  };
  for (const it of top) walk(it, 0);
  return out;
}

/**
 * Sections come from the `todo.sections` label order. Homework = effective assignments + Todoist tasks with the
 * homework label. Other Todoist tasks go to the first section whose label they carry, else "Other".
 * Subtasks inherit their parent's section.
 */
function buildSections(items: EffectiveItem[], order: string[], homeworkLabel: string): Section[] {
  const labels = order.length ? [...order] : [homeworkLabel];
  if (!labels.includes(homeworkLabel)) labels.unshift(homeworkLabel);
  const buckets = new Map<string, EffectiveItem[]>(labels.map((l) => [l, []]));
  const other: EffectiveItem[] = [];
  const byTodoistId = new Map(items.filter((i) => i.source === 'todoist').map((i) => [i.externalId, i]));
  const sectionOf = (it: EffectiveItem, seen = new Set<string>()): string => {
    if (it.kind === 'assignment') return homeworkLabel;
    const pid = parentIdOf(it);
    if (pid && byTodoistId.has(pid) && !seen.has(pid)) {
      seen.add(pid);
      return sectionOf(byTodoistId.get(pid)!, seen);
    }
    const hit = labels.find((l) => it.labels.map((x) => x.toLowerCase()).includes(l.toLowerCase()));
    return hit ?? '__other';
  };
  for (const it of items) {
    const key = sectionOf(it);
    if (key === '__other') other.push(it);
    else buckets.get(key)!.push(it);
  }
  const sections: Section[] = labels.map((l) => ({ key: l, label: l.charAt(0).toUpperCase() + l.slice(1), rows: nest(buckets.get(l)!) }));
  if (other.length) sections.push({ key: '__other', label: 'Other', rows: nest(other) });
  return sections;
}

export function TodoWidget({ size }: WidgetProps) {
  const settings = useSettings();
  const sources = useSources();
  const win = useMemo(() => windowFromNow(60), []);
  const dated = useItems({ kind: ['assignment', 'task'], to: win.to, limit: 500 });
  const undated = useItems({ kind: ['task'], limit: 200 });
  const setOverride = useSetOverride();
  const closeTask = useCloseTodoistTask();
  const quickAdd = useQuickAddTask();
  const [text, setText] = useState('');
  const [tab, setTab] = useState<string>('__all');
  const [flat, setFlat] = useState(false);

  const cfg = todoistPushConfigSchema.parse(settings.data?.['todoist.push'] ?? {});
  const order = (settings.data?.['todo.sections'] as string[] | undefined) ?? [];
  const todoist = sources.data?.find((s) => s.id === 'todoist');
  const todoistOn = !!todoist && todoist.status === 'connected';

  const merged = useMemo(() => {
    const seen = new Set<string>();
    const out: EffectiveItem[] = [];
    for (const it of [...(dated.data ?? []), ...(undated.data ?? []).filter((t) => !t.dueAt)]) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      out.push(it);
    }
    return out;
  }, [dated.data, undated.data]);

  const sections = useMemo(() => buildSections(merged, order, cfg.commonLabel), [merged, order, cfg.commonLabel]);
  const all: Section = useMemo(() => ({ key: '__all', label: 'All', rows: nest(merged) }), [merged]);
  const overdue = merged.filter((i) => i.dueAt && isPast(i.dueAt)).length;

  if (dated.isError) return <ErrorState error={dated.error} onRetry={() => dated.refetch()} />;

  const columns = !flat && (size.tier === 'lg' || (size.tier === 'md' && size.aspect !== 'tall'));
  const tabs = [all, ...sections];
  const active = tabs.find((s) => s.key === tab) ?? all;

  const complete = (it: EffectiveItem) => {
    if (it.source === 'todoist') closeTask.mutate(it.externalId, { onError: (e) => toast.error(e.message) });
    else setOverride.mutate({ id: it.id, done: true }, { onError: (e) => toast.error(e.message) });
  };
  const submitQuickAdd = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    quickAdd.mutate(text.trim(), { onSuccess: () => setText(''), onError: (err) => toast.error(err.message) });
  };

  const list = (s: Section, showSectionHints = false) =>
    s.rows.length ? (
      <ul className="space-y-0.5">
        {s.rows.map(({ item: it, depth }) => (
          <li key={it.id} className="group flex items-start gap-2 rounded px-1 py-1 text-sm hover:bg-accent/60" style={{ paddingLeft: 4 + depth * 18 }}>
            {depth > 0 && <CornerDownRight className="mt-1 size-3 shrink-0 text-muted-foreground/60" />}
            <Checkbox
              className="mt-0.5"
              aria-label={`Complete ${it.title}`}
              title={it.source === 'todoist' ? 'Complete this task in Todoist' : 'Mark done here only. Canvas / Gradescope are never changed.'}
              checked={false}
              onCheckedChange={() => complete(it)}
            />
            <div className="min-w-0 flex-1">
              <ItemPopover item={it}>
                <span className="flex items-center gap-1.5">
                  {it.course && <CourseDot color={it.course.color} title={it.course.code} />}
                  <span className="truncate">{it.title}</span>
                  <StatusBadge item={it} />
                </span>
              </ItemPopover>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <DueLabel item={it} />
                {it.course && <span title="Course">{it.course.code}</span>}
                {it.source === 'todoist' && (it.raw as { projectName?: string }).projectName && <span title="Todoist project">#{(it.raw as { projectName?: string }).projectName}</span>}
                {showSectionHints && it.labels.length > 0 && <span title="Labels">{it.labels.map((l) => `@${l}`).join(' ')}</span>}
                <span className="ml-auto rounded bg-secondary px-1 text-[10px] uppercase tracking-wide" title={`Pulled from ${SOURCE_LABELS[it.source]}${it.linkedIds.length ? ' (linked with the other source)' : ''}`}>
                  {it.source === 'canvas_ical' ? 'ical' : it.source}
                </span>
              </div>
            </div>
          </li>
        ))}
      </ul>
    ) : (
      <p className="px-1 py-1 text-xs text-muted-foreground/70">Nothing here.</p>
    );

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b px-1.5 py-1">
        {(!columns ? tabs : [all]).map((s) => (
          <button
            key={s.key}
            title={s.key === '__all' ? 'Everything, overdue first, then by due date' : `Tasks labelled @${s.key}`}
            className={cn('whitespace-nowrap rounded px-1.5 py-0.5 text-[11px]', (columns ? flat : active.key === s.key) ? 'bg-secondary font-medium' : 'text-muted-foreground hover:bg-secondary/60')}
            onClick={() => {
              if (columns || s.key === '__all') setFlat((v) => (columns ? true : s.key === '__all' ? v : false));
              setTab(s.key);
              if (s.key !== '__all') setFlat(false);
            }}
          >
            {s.label} <span className="text-muted-foreground">{s.rows.length}</span>
            {s.key === '__all' && overdue > 0 && <span className="ml-1 rounded bg-destructive/15 px-1 text-destructive">{overdue} overdue</span>}
          </button>
        ))}
        {(columns || flat) && size.tier !== 'sm' && size.tier !== 'xs' && (
          <button
            title={flat ? 'Back to sections' : 'One list, overdue first'}
            className={cn('ml-auto whitespace-nowrap rounded px-1.5 py-0.5 text-[11px]', flat ? 'bg-secondary font-medium' : 'text-muted-foreground hover:bg-secondary/60')}
            onClick={() => setFlat((v) => !v)}
          >
            {flat ? 'Sections' : 'List'}
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-1.5">
        {dated.isPending ? (
          <div className="h-16 animate-pulse rounded bg-muted/40" />
        ) : !merged.length ? (
          <EmptyState>
            Nothing to do. {!todoistOn && <Link to="/settings/sources" className="underline">Connect Todoist</Link>}
          </EmptyState>
        ) : columns ? (
          <div className="grid h-full gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(sections.length, size.tier === 'lg' ? 4 : 3)}, minmax(0, 1fr))` }}>
            {sections.map((s) => (
              <section key={s.key} className="min-w-0">
                <h4 className="mb-1 px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {s.label} <span className="font-normal">{s.rows.length}</span>
                </h4>
                {list(s)}
              </section>
            ))}
          </div>
        ) : (
          list(active, active.key === '__all')
        )}
      </div>
      {todoistOn && size.tier !== 'xs' && (
        <form onSubmit={submitQuickAdd} className="flex shrink-0 items-center gap-1 border-t p-1.5">
          <Input className="h-7 text-xs" placeholder="Add a task… (tomorrow 5pm @grocery #Home)" value={text} onChange={(e) => setText(e.target.value)} />
          <Button size="icon-xs" type="submit" variant="secondary" disabled={!text.trim() || quickAdd.isPending} aria-label="Add task" title="Add to Todoist using its natural-language parser (dates, @labels, #project)">
            <Plus className="size-3.5" />
          </Button>
        </form>
      )}
    </div>
  );
}
