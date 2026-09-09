import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Check, CornerDownRight, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { SOURCE_LABELS, todoistPushConfigSchema, type EffectiveItem } from '@collected/shared';
import { WidgetHeader } from '@/dashboard/WidgetHeader';
import { useCloseTodoistTask, useItems, useQuickAddTask, useSetOverride, useSettings, useSources } from '@/lib/queries';
import { friendlyDate, isPast } from '@/lib/time';
import { cn } from '@/lib/utils';
import { ItemPopover } from '@/widgets/ItemPopover';
import { EmptyState, ErrorState } from '@/widgets/Placeholder';
import { windowFromNow } from '@/widgets/shared';
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

const sourceTag = (it: EffectiveItem) => (it.source === 'canvas_ical' ? 'Canvas' : SOURCE_LABELS[it.source]);

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

  const list = (s: Section) =>
    s.rows.length ? (
      <ul className="flex flex-col">
        {s.rows.map(({ item: it, depth }) => {
          const late = !!it.dueAt && isPast(it.dueAt);
          const raw = it.raw as { projectName?: string };
          return (
            <li key={it.id} className="group/row flex items-start gap-3 rounded-[14px] px-2.5 py-[9px] transition-colors hover:bg-well" style={{ paddingLeft: 10 + depth * 18 }}>
              {depth > 0 && <CornerDownRight className="mt-1 size-3 shrink-0 text-ter/60" />}
              <button
                type="button"
                aria-label={`Complete ${it.title}`}
                title={it.source === 'todoist' ? 'Complete this task in Todoist' : 'Mark done here only. Canvas / Gradescope are never changed.'}
                onClick={() => complete(it)}
                onMouseDown={(e) => e.stopPropagation()}
                className={cn('mt-[1px] grid size-5 shrink-0 place-items-center rounded-full border-[1.5px] text-bg transition-colors', late ? 'border-coral hover:bg-coral' : it.course ? 'hover:bg-[var(--c)]' : 'border-ter hover:bg-ink')}
                style={it.course && !late ? ({ borderColor: it.course.color ?? 'var(--ter)', '--c': it.course.color ?? 'var(--ink)' } as React.CSSProperties) : undefined}
              >
                <Check className="size-3 opacity-0 transition-opacity group-hover/row:opacity-100" />
              </button>
              <div className="min-w-0 flex-1">
                <ItemPopover item={it}>
                  <span className="block truncate text-[13.5px] font-medium leading-[1.35]">{it.title}</span>
                </ItemPopover>
                <div className="mt-1 flex items-center gap-2 text-[11.5px]">
                  {it.dueAt ? <span className={cn('font-medium', late ? 'text-coral' : 'text-sub')}>{friendlyDate(it.dueAt, { withTime: true, allDay: it.allDay })}</span> : <span className="text-ter">no date</span>}
                  {it.course && <span className="font-medium" style={{ color: it.course.color ?? 'var(--sub)' }}>{it.course.code}</span>}
                  {it.source === 'todoist' && raw.projectName && <span className="text-ter">{raw.projectName}</span>}
                  <span className="flex-1" />
                  <span className="text-ter" title={`Pulled from ${SOURCE_LABELS[it.source]}${it.linkedIds.length ? ' (linked with the other source)' : ''}`}>{sourceTag(it)}</span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    ) : (
      <p className="px-3 py-2 text-xs text-ter">Nothing here.</p>
    );

  return (
    <div className="flex h-full flex-col">
      <WidgetHeader>
        {overdue > 0 && (
          <span className="flex h-7 items-center gap-1.5 rounded-full px-[11px] text-[12.5px] font-semibold text-coral" style={{ background: 'color-mix(in oklab, var(--coral) 18%, var(--card))' }}>
            <span className="size-1.5 rounded-full bg-coral ring-glow" style={{ '--glow-color': 'var(--coral)' } as React.CSSProperties} />
            {overdue} overdue
          </span>
        )}
        <span className="grid h-7 place-items-center rounded-full border border-line bg-card px-[11px] text-[12.5px] font-medium text-sub">{merged.length} open</span>
      </WidgetHeader>
      <div className="flex shrink-0 flex-wrap gap-1.5 px-3 pb-1.5 pt-2.5">
        {(!columns ? tabs : [all]).map((s) => (
          <button
            key={s.key}
            type="button"
            title={s.key === '__all' ? 'Everything, overdue first, then by due date' : `Tasks labelled @${s.key}`}
            className={cn('chip', (columns ? flat : active.key === s.key) && 'chip-on')}
            onClick={() => {
              if (columns || s.key === '__all') setFlat((v) => (columns ? true : s.key === '__all' ? v : false));
              setTab(s.key);
              if (s.key !== '__all') setFlat(false);
            }}
          >
            {s.label}{s.key !== '__all' && s.rows.length > 0 ? ` · ${s.rows.length}` : ''}
          </button>
        ))}
        {(columns || flat) && size.tier !== 'sm' && size.tier !== 'xs' && (
          <button type="button" title={flat ? 'Back to sections' : 'One list, overdue first'} className={cn('chip ml-auto', flat && 'chip-on')} onClick={() => setFlat((v) => !v)}>
            {flat ? 'Sections' : 'List'}
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-1.5">
        {dated.isPending ? (
          <div className="m-2 h-16 animate-pulse rounded-xl bg-well" />
        ) : !merged.length ? (
          <EmptyState>
            Nothing to do. {!todoistOn && <Link to="/settings/sources" className="underline">Connect Todoist</Link>}
          </EmptyState>
        ) : columns ? (
          <div className="grid h-full gap-3 px-1.5" style={{ gridTemplateColumns: `repeat(${Math.min(sections.length, size.tier === 'lg' ? 4 : 3)}, minmax(0, 1fr))` }}>
            {sections.map((s) => (
              <section key={s.key} className="min-w-0">
                <h4 className="mb-1 px-2.5 text-[11px] font-semibold uppercase tracking-wide text-ter">
                  {s.label} <span className="font-normal">{s.rows.length}</span>
                </h4>
                {list(s)}
              </section>
            ))}
          </div>
        ) : (
          list(active)
        )}
      </div>
      {todoistOn && size.tier !== 'xs' && (
        <form onSubmit={submitQuickAdd} className="mx-2.5 mb-2.5 mt-1.5 flex h-[38px] shrink-0 items-center gap-2.5 rounded-full border border-line bg-well pl-3.5 pr-1">
          <input className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ter" placeholder="Add a task… tomorrow 5pm @grocery #Home" value={text} onChange={(e) => setText(e.target.value)} />
          <button type="submit" disabled={!text.trim() || quickAdd.isPending} aria-label="Add task" title="Add to Todoist using its natural-language parser (dates, @labels, #project)" className="grid size-[30px] place-items-center rounded-full bg-ink text-bg transition-opacity disabled:opacity-40">
            <Plus className="size-4" />
          </button>
        </form>
      )}
    </div>
  );
}
