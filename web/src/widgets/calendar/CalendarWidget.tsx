import { useMemo, useState } from 'react';
import { addDays, addMonths, addWeeks, format, isSameMonth, startOfDay } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { WidgetHeader } from '@/dashboard/WidgetHeader';
import { useLiquid } from '@/lib/liquid';
import { useItems } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { ErrorState } from '@/widgets/Placeholder';
import type { WidgetProps } from '@/widgets/types';
import { QuickAdd } from './QuickAdd';
import { Agenda, Month, NextUp, WeekGrid, WeekStrip } from './Views';
import { autoView, rangeFor, type CalView } from './utils';

const VIEW_LABEL: Record<CalView, string> = { next: 'Next', agenda: 'Agenda', strip: 'Days', week: 'Week', month: 'Month' };

export function CalendarWidget({ size, instance }: WidgetProps) {
  const pinned = (instance.config as { view?: CalView }).view;
  const [override, setOverride] = useState<CalView | null>(null);
  const view: CalView = override ?? pinned ?? autoView(size.width, size.height);
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const liquid = useLiquid();
  const range = useMemo(() => rangeFor(view, anchor), [view, anchor]);
  const q = useItems({ from: range.from.toISOString(), to: range.to.toISOString(), limit: 1000, includeDone: view === 'month' || view === 'week' });

  const shift = (dir: 1 | -1) => {
    setAnchor((a) => (view === 'month' ? addMonths(a, dir) : view === 'week' ? addWeeks(a, dir) : addDays(a, dir * 7)));
  };
  const goToday = () => setAnchor(startOfDay(new Date()));
  const items = q.data ?? [];
  const compact = size.tier === 'xs';
  const label = view === 'month' ? format(anchor, 'MMMM yyyy') : `${format(range.from, 'MMM d')} – ${format(range.to, isSameMonth(range.from, range.to) ? 'd' : 'MMM d')}`;

  return (
    <div className="flex h-full flex-col">
      {!compact && (
        <WidgetHeader>
          <span className="text-[15px] font-semibold whitespace-nowrap">{label}</span>
          <span className="seg !gap-0.5 !p-0.5">
            <button className="!grid !h-[26px] !w-[26px] !place-items-center !p-0" aria-label="Previous" title="Previous period" onClick={() => shift(-1)}><ChevronLeft className="size-3.5" /></button>
            <button className="!h-[26px] !py-0 !text-ink" title="Jump back to today" onClick={goToday}>Today</button>
            <button className="!grid !h-[26px] !w-[26px] !place-items-center !p-0" aria-label="Next" title="Next period" onClick={() => shift(1)}><ChevronRight className="size-3.5" /></button>
          </span>
          {size.tier !== 'sm' && (
            <span className="seg" ref={liquid}>
              {(['agenda', 'strip', 'week', 'month'] as CalView[]).map((v) => (
                <button key={v} className={cn(view === v && 'seg-on')} aria-pressed={view === v} title={`${VIEW_LABEL[v]} view (auto-picked from widget size unless you choose one)`} onClick={() => setOverride(v === (pinned ?? autoView(size.width, size.height)) ? null : v)}>
                  {VIEW_LABEL[v]}
                </button>
              ))}
            </span>
          )}
          <QuickAdd defaultDate={anchor} />
        </WidgetHeader>
      )}
      <div className="min-h-0 flex-1">
        {q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : q.isPending ? (
          <div className="m-3 h-24 animate-pulse rounded-xl bg-well" />
        ) : view === 'next' ? (
          <NextUp items={items} />
        ) : view === 'agenda' ? (
          <Agenda items={items} from={range.from} />
        ) : view === 'strip' ? (
          <WeekStrip items={items} from={range.from} />
        ) : view === 'week' ? (
          <WeekGrid items={items} from={range.from} />
        ) : (
          <Month items={items} from={range.from} to={range.to} anchor={anchor} />
        )}
      </div>
    </div>
  );
}
