import { useMemo, useState } from 'react';
import { addDays, addMonths, addWeeks, format, startOfDay } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
  const range = useMemo(() => rangeFor(view, anchor), [view, anchor]);
  const q = useItems({ from: range.from.toISOString(), to: range.to.toISOString(), limit: 1000, includeDone: view === 'month' || view === 'week' });

  const shift = (dir: 1 | -1) => {
    setAnchor((a) => (view === 'month' ? addMonths(a, dir) : view === 'week' ? addWeeks(a, dir) : addDays(a, dir * (view === 'next' ? 7 : 7))));
  };
  const goToday = () => setAnchor(startOfDay(new Date()));
  const items = q.data ?? [];
  const compact = size.tier === 'xs';

  return (
    <div className="flex h-full flex-col">
      {!compact && (
        <div className="flex shrink-0 items-center gap-1 border-b px-1.5 py-1">
          <Button size="icon-xs" variant="ghost" aria-label="Previous" title="Previous period" onClick={() => shift(-1)}>
            <ChevronLeft className="size-3.5" />
          </Button>
          <Button size="xs" variant="ghost" title="Jump back to today" onClick={goToday}>Today</Button>
          <Button size="icon-xs" variant="ghost" aria-label="Next" title="Next period" onClick={() => shift(1)}>
            <ChevronRight className="size-3.5" />
          </Button>
          <span className="ml-1 truncate text-xs font-medium">
            {view === 'month' ? format(anchor, 'MMMM yyyy') : `${format(range.from, 'MMM d')} – ${format(range.to, 'MMM d')}`}
          </span>
          <span className="ml-auto flex items-center gap-0.5">
            {size.tier !== 'sm' &&
              (['agenda', 'strip', 'week', 'month'] as CalView[]).map((v) => (
                <button
                  key={v}
                  title={`${VIEW_LABEL[v]} view (auto-picked from widget size unless you choose one)`}
                  className={cn('rounded px-1.5 py-0.5 text-[11px]', view === v ? 'bg-secondary font-medium' : 'text-muted-foreground hover:bg-secondary/60')}
                  onClick={() => setOverride(v === (pinned ?? autoView(size.width, size.height)) ? null : v)}
                >
                  {VIEW_LABEL[v]}
                </button>
              ))}
            <QuickAdd defaultDate={anchor} />
          </span>
        </div>
      )}
      <div className="min-h-0 flex-1">
        {q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : q.isPending ? (
          <div className="m-2 h-24 animate-pulse rounded bg-muted/40" />
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
