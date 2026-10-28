import { useMemo, useState } from 'react';
import { addDays, addMonths, addWeeks, format, isSameDay, isSameMonth, startOfDay } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { WidgetHeader } from '@/dashboard/WidgetHeader';
import { useLiquid } from '@/lib/liquid';
import { useItems } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { ErrorState } from '@/widgets/Placeholder';
import type { WidgetProps } from '@/widgets/types';
import { useNow } from '@/widgets/useNow';
import { QuickAdd } from './QuickAdd';
import { Agenda, Month, NextUp, WeekGrid, WeekStrip } from './Views';
import { autoView, rangeFor, type CalView } from './utils';

const VIEW_LABEL: Record<CalView, string> = { next: 'Next', agenda: 'Agenda', strip: 'Days', week: 'Week', month: 'Month' };
/** Below this the view switcher would push the header past one row, so the view follows the widget's size. */
const VIEW_SEG_MIN_WIDTH = 640;

export function CalendarWidget({ size, instance }: WidgetProps) {
  const pinned = (instance.config as { view?: CalView }).view;
  const [override, setOverride] = useState<CalView | null>(null);
  const auto = pinned ?? autoView(size.width, size.height);
  const view: CalView = override ?? auto;
  const now = useNow(60_000);
  const todayMs = startOfDay(now).getTime();
  // null means "today": the anchor then follows the date past midnight, until the user navigates somewhere else
  const [picked, setPicked] = useState<Date | null>(null);
  const anchor = useMemo(() => picked ?? new Date(todayMs), [picked, todayMs]);
  const liquid = useLiquid();
  const range = useMemo(() => rangeFor(view, anchor), [view, anchor]);
  const q = useItems({ from: range.from.toISOString(), to: range.to.toISOString(), limit: 1000, includeDone: view === 'month' || view === 'week' });

  const moveTo = (d: Date) => setPicked(isSameDay(d, new Date(todayMs)) ? null : startOfDay(d));
  const shift = (dir: 1 | -1) => moveTo(view === 'month' ? addMonths(anchor, dir) : view === 'week' ? addWeeks(anchor, dir) : addDays(anchor, dir * 7));
  const goToday = () => setPicked(null);
  const pickDay = (d: Date) => {
    moveTo(d);
    setOverride('agenda');
  };
  const items = q.data ?? [];
  const compact = size.tier === 'xs';
  const showViews = size.width >= VIEW_SEG_MIN_WIDTH;
  const label = view === 'month' ? format(anchor, 'MMMM yyyy') : `${format(range.from, 'MMM d')} – ${format(range.to, isSameMonth(range.from, range.to) ? 'd' : 'MMM d')}`;

  return (
    <div className="flex h-full flex-col">
      {!compact && (
        <WidgetHeader>
          <span className="min-w-0 truncate text-[15px] font-semibold">{label}</span>
          <span className="seg shrink-0 !gap-0.5 !p-0.5">
            <button className="!grid !h-[26px] !w-[26px] !place-items-center !p-0" aria-label="Previous" title="Previous period" onClick={() => shift(-1)}><ChevronLeft className="size-3.5" /></button>
            <button className="!h-[26px] !py-0 !text-ink" title="Jump back to today" onClick={goToday}>Today</button>
            <button className="!grid !h-[26px] !w-[26px] !place-items-center !p-0" aria-label="Next" title="Next period" onClick={() => shift(1)}><ChevronRight className="size-3.5" /></button>
          </span>
          {showViews ? (
            <span className="seg shrink-0" ref={liquid}>
              {(['agenda', 'strip', 'week', 'month'] as CalView[]).map((v) => (
                <button key={v} className={cn(view === v && 'seg-on')} aria-pressed={view === v} title={`${VIEW_LABEL[v]} view (auto-picked from widget size unless you choose one)`} onMouseDown={(e) => e.stopPropagation()} onClick={() => setOverride(v === auto ? null : v)}>
                  {VIEW_LABEL[v]}
                </button>
              ))}
            </span>
          ) : (
            // no switcher at this width, but a day picked from the month needs a way back to it
            override && override !== auto && (
              <button className="chip !inline-flex !h-7 shrink-0 items-center gap-0.5 whitespace-nowrap" title={`Back to the ${VIEW_LABEL[auto].toLowerCase()} view`} onMouseDown={(e) => e.stopPropagation()} onClick={() => setOverride(null)}>
                <ChevronLeft className="-ml-1 size-3.5" />
                {VIEW_LABEL[auto]}
              </button>
            )
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
          <NextUp items={items} now={now} />
        ) : view === 'agenda' ? (
          <Agenda items={items} from={range.from} />
        ) : view === 'strip' ? (
          <WeekStrip items={items} from={range.from} />
        ) : view === 'week' ? (
          <WeekGrid items={items} from={range.from} now={now} />
        ) : (
          <Month items={items} from={range.from} to={range.to} anchor={anchor} onPickDay={pickDay} />
        )}
      </div>
    </div>
  );
}
