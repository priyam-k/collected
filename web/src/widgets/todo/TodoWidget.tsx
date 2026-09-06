import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { SOURCE_LABELS, todoistPushConfigSchema, type EffectiveItem } from '@collected/shared';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { useCloseTodoistTask, useItems, useQuickAddTask, useSetOverride, useSettings, useSources } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { EmptyState, ErrorState } from '@/widgets/Placeholder';
import { CourseDot, DueLabel, StatusBadge, windowFromNow } from '@/widgets/shared';
import type { WidgetProps } from '@/widgets/types';

interface Section {
  key: string;
  label: string;
  items: EffectiveItem[];
}

/**
 * Sections come from the `todo.sections` label order. The homework section shows effective assignments
 * (whatever the source) plus Todoist tasks carrying the homework label. Other Todoist tasks land in the
 * first section whose label they carry, else "Other".
 */
function buildSections(items: EffectiveItem[], order: string[], homeworkLabel: string): Section[] {
  const labels = order.length ? order : [homeworkLabel];
  if (!labels.includes(homeworkLabel)) labels.unshift(homeworkLabel);
  const sections: Section[] = labels.map((l) => ({ key: l, label: l.charAt(0).toUpperCase() + l.slice(1), items: [] }));
  const other: Section = { key: '__other', label: 'Other', items: [] };
  for (const it of items) {
    if (it.kind === 'assignment') {
      sections.find((s) => s.key === homeworkLabel)!.items.push(it);
      continue;
    }
    const hit = sections.find((s) => it.labels.map((x) => x.toLowerCase()).includes(s.key.toLowerCase()));
    (hit ?? other).items.push(it);
  }
  const byDue = (a: EffectiveItem, b: EffectiveItem) => (a.dueAt ?? '9').localeCompare(b.dueAt ?? '9');
  for (const s of sections) s.items.sort(byDue);
  other.items.sort(byDue);
  return [...sections, ...(other.items.length ? [other] : [])];
}

export function TodoWidget({ size }: WidgetProps) {
  const settings = useSettings();
  const sources = useSources();
  const win = useMemo(() => windowFromNow(60), []);
  const q = useItems({ kind: ['assignment', 'task'], to: win.to, limit: 500 });
  const undated = useItems({ kind: ['task'], limit: 200 }); // tasks without dates aren't caught by the window
  const setOverride = useSetOverride();
  const closeTask = useCloseTodoistTask();
  const quickAdd = useQuickAddTask();
  const [text, setText] = useState('');
  const [tab, setTab] = useState<string | null>(null);

  const cfg = todoistPushConfigSchema.parse(settings.data?.['todoist.push'] ?? {});
  const order = (settings.data?.['todo.sections'] as string[] | undefined) ?? [];
  const todoist = sources.data?.find((s) => s.id === 'todoist');
  const todoistOn = !!todoist && todoist.status === 'connected';

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const merged = useMemo(() => {
    const seen = new Set<string>();
    const out: EffectiveItem[] = [];
    for (const it of [...(q.data ?? []), ...(undated.data ?? []).filter((t) => !t.dueAt)]) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      out.push(it);
    }
    return out;
  }, [q.data, undated.data]);
  const sections = buildSections(merged, order, cfg.commonLabel);
  const columns = size.tier === 'lg' || (size.tier === 'md' && size.aspect !== 'tall');
  const active = tab && sections.some((s) => s.key === tab) ? tab : sections[0]?.key;

  const complete = (it: EffectiveItem) => {
    if (it.source === 'todoist') {
      closeTask.mutate(it.externalId, { onError: (e) => toast.error(e.message) });
    } else {
      setOverride.mutate({ id: it.id, done: true }, { onError: (e) => toast.error(e.message) });
    }
  };
  const submitQuickAdd = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    quickAdd.mutate(text.trim(), {
      onSuccess: () => setText(''),
      onError: (err) => toast.error(err.message),
    });
  };

  const list = (s: Section) =>
    s.items.length ? (
      <ul className="space-y-0.5">
        {s.items.map((it) => (
          <li key={it.id} className="group flex items-start gap-2 rounded px-1 py-1 text-sm hover:bg-accent/60">
            <Checkbox
              className="mt-0.5"
              aria-label={`Complete ${it.title}`}
              title={it.source === 'todoist' ? 'Complete this task in Todoist' : 'Mark done here only. Canvas / Gradescope are never changed.'}
              checked={false}
              onCheckedChange={() => complete(it)}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                {it.course && <CourseDot color={it.course.color} />}
                {it.url ? (
                  <a href={it.url} target="_blank" rel="noreferrer" className="truncate hover:underline">{it.title}</a>
                ) : (
                  <span className="truncate">{it.title}</span>
                )}
                <StatusBadge item={it} />
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <DueLabel item={it} />
                {it.course && <span title="Course (the dot is the course color)">{it.course.code}</span>}
                {it.source === 'todoist' && (it.raw as { projectName?: string }).projectName && <span title="Todoist project">#{(it.raw as { projectName?: string }).projectName}</span>}
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
      {!columns && sections.length > 1 && (
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b px-1.5 py-1">
          {sections.map((s) => (
            <button
              key={s.key}
              className={cn('whitespace-nowrap rounded px-1.5 py-0.5 text-[11px]', active === s.key ? 'bg-secondary font-medium' : 'text-muted-foreground hover:bg-secondary/60')}
              onClick={() => setTab(s.key)}
            >
              {s.label} <span className="text-muted-foreground">{s.items.length}</span>
            </button>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto p-1.5">
        {q.isPending ? (
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
                  {s.label} <span className="font-normal">{s.items.length}</span>
                </h4>
                {list(s)}
              </section>
            ))}
          </div>
        ) : (
          list(sections.find((s) => s.key === active) ?? sections[0]!)
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
