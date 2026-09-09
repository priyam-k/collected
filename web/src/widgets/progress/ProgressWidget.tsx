import { useMemo, useState } from 'react';
import { addMonths, addWeeks, endOfMonth, endOfWeek, format, isSameMonth, isSameWeek, startOfMonth, startOfWeek } from 'date-fns';
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
function Rings({ groups, done, total }: { groups: Group[]; done: number; total: number }) {
  const shown = groups.slice(0, 5);
  const n = Math.max(1, shown.length);
  const thick = Math.min(8, 24 / n);
  const gap = 1.6;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const big = n <= 2 ? 13 : 11;
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" className="h-full w-full" role="img" aria-label={`${pct}% done, ${done} of ${total}`}>
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
      {!shown.length && <circle cx="50" cy="50" r="42" fill="none" stroke="var(--well2)" strokeWidth="8" />}
      <text x="50" y="48" textAnchor="middle" dominantBaseline="central" fill="var(--ink)" fontSize={big} fontWeight={700} letterSpacing="-0.4">{total ? `${pct}%` : '–'}</text>
      <text x="50" y="59" textAnchor="middle" fill="var(--sub)" fontSize="5.5">{total ? `${done} of ${total}` : 'nothing due'}</text>
    </svg>
  );
}

/**
 * What's done of what was due this week or month, as nested rings per course, the way BetterCanvas draws it.
 * The header holds only navigation and the period; the range label and the legend sit in the ring's corners.
 */
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
  const isNow = period === 'week' ? isSameWeek(anchor, new Date(), { weekStartsOn: 0 }) : isSameMonth(anchor, new Date());
  const label = period === 'month' ? format(anchor, 'MMMM') : `${format(range.from, 'MMM d')} – ${format(range.to, isSameMonth(range.from, range.to) ? 'd' : 'MMM d')}`;

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const xs = size.tier === 'xs';
  const wide = size.aspect === 'wide' && size.width >= 380;

  const legendItem = (g: Group) => (
    <li key={g.id}>
      <button className="flex items-center gap-1.5 text-[12.5px] transition-colors hover:text-ink" title={`${g.label}: ${g.done} of ${g.total} done`} onMouseDown={(e) => e.stopPropagation()} onClick={() => g.courseId && open({ kind: 'course', courseId: g.courseId, tab: 'assignments' })}>
        <span className="size-2 rounded-full" style={{ background: g.color }} />
        <span className="font-medium">{g.label}</span>
        <span className="text-xs tabular-nums text-ter">{g.done}/{g.total}</span>
      </button>
    </li>
  );

  return (
    <div className="flex h-full flex-col">
      <WidgetHeader>
        <span className="seg !gap-0.5 !p-0.5">
          <button className="!grid !h-[26px] !w-[26px] !place-items-center !p-0" aria-label={`Previous ${period}`} title={`Previous ${period}`} onClick={() => shift(-1)}><ChevronLeft className="size-3.5" /></button>
          <button className={cn('!h-[26px] !min-w-[8.5rem] !px-2 !py-0 !text-center !font-semibold tabular-nums', isNow ? '!text-ink' : '!text-sub')} title={isNow ? `This ${period}` : `Back to this ${period}`} onClick={() => setAnchor(new Date())}>
            {label}{!isNow && <span className="ml-1 font-normal text-ter">↺</span>}
          </button>
          <button className="!grid !h-[26px] !w-[26px] !place-items-center !p-0" aria-label={`Next ${period}`} title={`Next ${period}`} onClick={() => shift(1)}><ChevronRight className="size-3.5" /></button>
        </span>
      </WidgetHeader>
      {q.isPending ? (
        <div className="m-3 h-24 animate-pulse rounded-xl bg-well" />
      ) : (
        <div className={cn('relative flex min-h-0 flex-1', wide ? 'flex-row items-stretch gap-4 px-3 py-2' : 'flex-col px-3 pb-2 pt-1')}>
          {!xs && (
            <span className="seg absolute right-2.5 top-2 z-10 !p-[2px]">
              {(['week', 'month'] as Period[]).map((p) => (
                <button key={p} className={cn('!px-2.5 !py-1 !text-[11.5px]', p === period && 'seg-on')} title={p === 'week' ? 'What was due this week' : 'What was due this month'} onMouseDown={(e) => e.stopPropagation()} onClick={() => setPeriod(p)}>
                  {p === 'week' ? 'Week' : 'Month'}
                </button>
              ))}
            </span>
          )}
          {total ? (
            <div className={cn('min-h-0', wide ? 'aspect-square h-full shrink-0 self-center' : cn('w-full flex-1', !xs && 'pt-7'))}>
              <Rings groups={groups} done={done} total={total} />
            </div>
          ) : (
            <EmptyState>Nothing due {period === 'week' ? 'this week' : 'this month'}.</EmptyState>
          )}
          {wide ? (
            <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5 overflow-auto pt-7">
              <ul className="space-y-1">
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
            </div>
          ) : (
            !xs && total > 0 && <ul className="flex shrink-0 flex-wrap justify-center gap-x-3 gap-y-0.5 pt-1.5">{groups.map(legendItem)}</ul>
          )}
        </div>
      )}
    </div>
  );
}
