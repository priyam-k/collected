import { useMemo, useState } from 'react';
import { addMonths, addWeeks, endOfMonth, endOfWeek, format, isSameMonth, startOfMonth, startOfWeek } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { EffectiveItem } from '@collected/shared';
import { WidgetHeader } from '@/dashboard/WidgetHeader';
import { useItems } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { usePane } from '@/panes/PaneContext';
import { EmptyState, ErrorState } from '@/widgets/Placeholder';
import type { WidgetProps } from '@/widgets/types';

type Period = 'week' | 'month';

interface Group {
  id: string;
  label: string;
  color: string;
  done: number;
  total: number;
  courseId: string | null;
}

/** Assignments by course, plus one "Tasks" bucket for Todoist items, for what's due in the window. */
function groupItems(items: EffectiveItem[]): Group[] {
  const map = new Map<string, Group>();
  for (const it of items) {
    if (it.informational) continue;
    const key = it.course?.id ?? (it.kind === 'task' ? 'tasks' : 'other');
    const g = map.get(key) ?? { id: key, label: it.course?.code ?? (key === 'tasks' ? 'Tasks' : 'Other'), color: it.course?.color ?? 'var(--ter)', done: 0, total: 0, courseId: it.course?.id ?? null };
    g.total++;
    if (it.effectiveDone) g.done++;
    map.set(key, g);
  }
  return [...map.values()].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}

/** Concentric rings, one per group, outermost first; the centre is the overall figure. */
function Rings({ groups, done, total, size }: { groups: Group[]; done: number; total: number; size: number }) {
  const shown = groups.slice(0, 5);
  const n = Math.max(1, shown.length);
  const thick = Math.min(9, 26 / n);
  const gap = 1.6;
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className="shrink-0" role="img" aria-label={`${pct}% done, ${done} of ${total}`}>
      {shown.map((g, i) => {
        const r = 47 - thick / 2 - i * (thick + gap);
        const c = 2 * Math.PI * r;
        const p = g.total ? g.done / g.total : 0;
        return (
          <g key={g.id}>
            <circle cx="50" cy="50" r={r} fill="none" stroke={g.color} strokeOpacity={0.22} strokeWidth={thick} />
            {p > 0 && (
              <circle cx="50" cy="50" r={r} fill="none" stroke={g.color} strokeWidth={thick} strokeLinecap="round" strokeDasharray={`${c * p} ${c}`} transform="rotate(-90 50 50)">
                <title>{`${g.label}: ${g.done} of ${g.total}`}</title>
              </circle>
            )}
          </g>
        );
      })}
      {!shown.length && <circle cx="50" cy="50" r="42" fill="none" stroke="var(--well2)" strokeWidth="9" />}
      <text x="50" y="50" textAnchor="middle" dominantBaseline="central" fill="var(--ink)" fontSize={n > 3 ? 13 : 16} fontWeight={700} letterSpacing="-0.5">{total ? `${pct}%` : '–'}</text>
      <text x="50" y={n > 3 ? 61 : 63} textAnchor="middle" fill="var(--sub)" fontSize={n > 3 ? 6 : 7}>{total ? `${done}/${total}` : 'nothing due'}</text>
    </svg>
  );
}

/** What's done of what was due this week or month, as nested rings per course, the way BetterCanvas draws it. */
export function ProgressWidget({ size }: WidgetProps) {
  const [period, setPeriod] = useState<Period>('week');
  const [anchor, setAnchor] = useState(() => new Date());
  const { open } = usePane();
  const range = useMemo(() => {
    const from = period === 'week' ? startOfWeek(anchor, { weekStartsOn: 0 }) : startOfMonth(anchor);
    const to = period === 'week' ? endOfWeek(anchor, { weekStartsOn: 0 }) : endOfMonth(anchor);
    return { from, to };
  }, [period, anchor]);
  const q = useItems({ kind: ['assignment', 'task'], from: range.from.toISOString(), to: range.to.toISOString(), includeDone: true, limit: 500 });
  const inWindow = useMemo(() => (q.data ?? []).filter((it) => it.dueAt && new Date(it.dueAt) >= range.from && new Date(it.dueAt) <= range.to), [q.data, range]);
  const groups = useMemo(() => groupItems(inWindow), [inWindow]);
  const done = groups.reduce((s, g) => s + g.done, 0);
  const total = groups.reduce((s, g) => s + g.total, 0);
  const shift = (dir: 1 | -1) => setAnchor((a) => (period === 'week' ? addWeeks(a, dir) : addMonths(a, dir)));
  const label = period === 'month' ? format(anchor, 'MMMM') : `${format(range.from, 'MMM d')} – ${format(range.to, isSameMonth(range.from, range.to) ? 'd' : 'MMM d')}`;

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const xs = size.tier === 'xs';
  const wide = size.aspect === 'wide' && size.width >= 380;
  const ring = Math.max(72, Math.min(wide ? size.height - 56 : size.height - (xs ? 20 : 74), wide ? 200 : size.width - 32, 220));

  return (
    <div className="flex h-full flex-col">
      <WidgetHeader>
        {!xs && <span className="text-[13px] font-semibold whitespace-nowrap">{label}</span>}
        <span className="seg !gap-0.5 !p-0.5">
          <button className="!grid !h-[26px] !w-[26px] !place-items-center !p-0" aria-label="Previous" onClick={() => shift(-1)}><ChevronLeft className="size-3.5" /></button>
          <button className="!h-[26px] !py-0 !text-ink" title="Back to now" onClick={() => setAnchor(new Date())}>Now</button>
          <button className="!grid !h-[26px] !w-[26px] !place-items-center !p-0" aria-label="Next" onClick={() => shift(1)}><ChevronRight className="size-3.5" /></button>
        </span>
        {!xs && (
          <span className="seg">
            {(['week', 'month'] as Period[]).map((p) => (
              <button key={p} className={cn(p === period && 'seg-on')} onClick={() => setPeriod(p)}>{p === 'week' ? 'Week' : 'Month'}</button>
            ))}
          </span>
        )}
      </WidgetHeader>
      {q.isPending ? (
        <div className="m-3 h-24 animate-pulse rounded-xl bg-well" />
      ) : !total ? (
        <EmptyState>Nothing due {period === 'week' ? 'this week' : 'this month'}.</EmptyState>
      ) : (
        <div className={cn('flex min-h-0 flex-1 items-center gap-4 p-3', wide ? 'flex-row' : 'flex-col justify-center')}>
          <Rings groups={groups} done={done} total={total} size={ring} />
          {!xs && (
            wide ? (
              <ul className="min-w-0 flex-1 space-y-1.5 self-center overflow-auto">
                {groups.map((g) => (
                  <li key={g.id}>
                    <button className="flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1 text-left text-[13px] transition-colors hover:bg-well" onMouseDown={(e) => e.stopPropagation()} onClick={() => g.courseId && open({ kind: 'course', courseId: g.courseId, tab: 'assignments' })}>
                      <span className="size-2 shrink-0 rounded-full" style={{ background: g.color }} />
                      <span className="w-20 shrink-0 truncate font-medium">{g.label}</span>
                      <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-well2"><span className="block h-full rounded-full" style={{ width: `${g.total ? (g.done / g.total) * 100 : 0}%`, background: g.color }} /></span>
                      <span className="w-10 shrink-0 text-right text-xs tabular-nums text-sub">{g.done}/{g.total}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <ul className="flex flex-wrap justify-center gap-x-3 gap-y-1">
                {groups.map((g) => (
                  <li key={g.id}>
                    <button className="flex items-center gap-1.5 text-[12.5px] transition-colors hover:text-ink" title={`${g.label}: ${g.done} of ${g.total} done`} onMouseDown={(e) => e.stopPropagation()} onClick={() => g.courseId && open({ kind: 'course', courseId: g.courseId, tab: 'assignments' })}>
                      <span className="size-2 rounded-full" style={{ background: g.color }} />
                      <span className="font-medium">{g.label}</span>
                      <span className="text-xs tabular-nums text-ter">{g.done}/{g.total}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          )}
        </div>
      )}
    </div>
  );
}
