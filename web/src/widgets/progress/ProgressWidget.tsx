import { useMemo, useState } from 'react';
import { addMonths, addWeeks, endOfMonth, endOfWeek, format, isSameMonth, isSameWeek, startOfMonth, startOfWeek } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { EffectiveItem } from '@collected/shared';
import { WidgetHeader } from '@/dashboard/WidgetHeader';
import { useLiquid } from '@/lib/liquid';
import { useItems } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { safeColor } from '@/lib/color';
import { usePane } from '@/panes/PaneContext';
import { Meter, TickArc } from '@/widgets/instruments';
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
    const g = map.get(key) ?? { id: key, label: it.course?.code ?? (key === 'tasks' ? 'Tasks' : 'Other'), color: safeColor(it.course?.color) ?? 'var(--ink-muted)', done: 0, total: 0, courseId: it.course?.id ?? null };
    g.total++;
    if (it.effectiveDone) g.done++;
    map.set(key, g);
  }
  return [...map.values()].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}

/** Radial room for the rings: from the outer edge (48) in to where the centre figure needs its space. */
const RING_BAND = 36;

/**
 * Concentric rings of ticks, one per group, outermost first; the centre is the overall figure. Every group gets a
 * ring, so the rings always agree with the legend: past five, ticks, gaps and strokes shrink to fit the same band.
 */
function Rings({ groups, done, total }: { groups: Group[]; done: number; total: number }) {
  const n = Math.max(1, groups.length);
  const crowded = n > 5;
  const pitch = RING_BAND / n;
  const len = crowded ? pitch * 0.6 : Math.min(6.5, 20 / n);
  const gap = crowded ? pitch * 0.4 : 3.2;
  const stroke = crowded ? Math.min(1.6, pitch * 0.32) : 1.6;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const big = n <= 2 ? 14 : crowded ? 11 : 12;
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" className="h-full w-full" role="img" aria-label={`${pct}% done, ${done} of ${total}`}>
      {groups.map((g, i) => (
        <g key={g.id}>
          <title>{`${g.label}: ${g.done} of ${g.total}`}</title>
          <TickArc cx={50} cy={50} r={48 - i * (len + gap)} len={len} value={g.total ? g.done / g.total : 0} color={g.color} width={stroke} />
        </g>
      ))}
      {!groups.length && <TickArc cx={50} cy={50} r={48} len={7} value={0} color="var(--brand)" width={1.25} />}
      <text x="50" y="48" textAnchor="middle" dominantBaseline="central" fill="var(--ink)" fontSize={big} fontWeight={560} letterSpacing="-0.5">{total ? `${pct}%` : '–'}</text>
      <text x="50" y="60" textAnchor="middle" fill="var(--sub)" fontSize="5.2" fontWeight={450}>{total ? `${done} of ${total}` : 'nothing due'}</text>
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
  const liquid = useLiquid();
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
  const xs = size.tier === 'xs';
  // at xs the full range ("Oct 25 – 31", ~196px of seg) would be clipped, so the week shows by its first day
  const label = period === 'month' ? format(anchor, xs ? 'MMM' : 'MMMM') : xs ? format(range.from, 'MMM d') : `${format(range.from, 'MMM d')} – ${format(range.to, isSameMonth(range.from, range.to) ? 'd' : 'MMM d')}`;

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const wide = size.aspect === 'wide' && size.width >= 380;

  // a course row opens that course; "Tasks" and "Other" have nowhere to go, so they're plain text, not buttons
  const openCourse = (g: Group) => (g.courseId ? () => open({ kind: 'course', courseId: g.courseId!, tab: 'assignments' }) : undefined);
  const legendItem = (g: Group) => {
    const inner = (
      <>
        <span className="size-2 rounded-full" style={{ background: g.color }} />
        <span className="font-medium">{g.label}</span>
        <span className="text-xs text-ter">{g.done}/{g.total}</span>
      </>
    );
    const title = `${g.label}: ${g.done} of ${g.total} done`;
    const onClick = openCourse(g);
    return (
      <li key={g.id}>
        {onClick ? (
          <button className="flex items-center gap-1.5 text-[12.5px] transition-colors hover:text-ink" title={title} onMouseDown={(e) => e.stopPropagation()} onClick={onClick}>{inner}</button>
        ) : (
          <span className="flex items-center gap-1.5 text-[12.5px]" title={title}>{inner}</span>
        )}
      </li>
    );
  };
  const wideRow = (g: Group) => {
    const inner = (
      <>
        <span className="size-2 shrink-0 rounded-full" style={{ background: g.color }} />
        <span className="w-20 shrink-0 truncate font-medium">{g.label}</span>
        <Meter className="min-w-0 flex-1" value={g.total ? (g.done / g.total) * 100 : 0} color={g.color} height={12} />
        <span className="w-10 shrink-0 text-right text-xs text-sub">{g.done}/{g.total}</span>
      </>
    );
    const onClick = openCourse(g);
    const cls = 'flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1 text-left text-[13px]';
    return (
      <li key={g.id}>
        {onClick ? (
          <button className={cn(cls, 'transition-colors hover:bg-well')} onMouseDown={(e) => e.stopPropagation()} onClick={onClick}>{inner}</button>
        ) : (
          <div className={cls}>{inner}</div>
        )}
      </li>
    );
  };

  return (
    <div className="flex h-full flex-col">
      <WidgetHeader>
        <span className="seg shrink-0 !gap-0.5 !p-0.5">
          <button className="!grid !h-[26px] !w-[26px] !place-items-center !p-0" aria-label={`Previous ${period}`} title={`Previous ${period}`} onClick={() => shift(-1)}><ChevronLeft className="size-3.5" /></button>
          <button className={cn('!h-[26px] !px-2 !py-0 !text-center !font-semibold whitespace-nowrap tabular-nums', !xs && '!min-w-[8.5rem]', isNow ? '!text-ink' : '!text-sub')} title={isNow ? `This ${period}` : `Back to this ${period}`} onClick={() => setAnchor(new Date())}>
            {label}{!isNow && <span className="ml-1 font-normal text-ter">↺</span>}
          </button>
          <button className="!grid !h-[26px] !w-[26px] !place-items-center !p-0" aria-label={`Next ${period}`} title={`Next ${period}`} onClick={() => shift(1)}><ChevronRight className="size-3.5" /></button>
        </span>
      </WidgetHeader>
      {q.isPending ? (
        <div className="m-3 h-24 animate-pulse rounded-2xl bg-well" />
      ) : (
        <div className={cn('relative flex min-h-0 flex-1', wide ? 'flex-row items-stretch gap-4 px-3 py-2' : 'flex-col px-3 pb-2 pt-1')}>
          {!xs && (
            <span className="seg absolute right-2.5 top-2 z-10 !p-[2px]" ref={liquid}>
              {(['week', 'month'] as Period[]).map((p) => (
                <button key={p} className={cn('!px-2.5 !py-1 !text-[11.5px]', p === period && 'seg-on')} aria-pressed={p === period} title={p === 'week' ? 'What was due this week' : 'What was due this month'} onMouseDown={(e) => e.stopPropagation()} onClick={() => setPeriod(p)}>
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
                {groups.map(wideRow)}
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
