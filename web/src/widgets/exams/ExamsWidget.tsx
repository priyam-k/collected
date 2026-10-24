import { useMemo } from 'react';
import { differenceInCalendarDays, format } from 'date-fns';
import type { EffectiveItem } from '@collected/shared';
import { WidgetHeader } from '@/dashboard/WidgetHeader';
import { useItems } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { safeColor } from '@/lib/color';
import { usePane } from '@/panes/PaneContext';
import { ItemPopover } from '@/widgets/ItemPopover';
import { EmptyState, ErrorState } from '@/widgets/Placeholder';
import { manualRaw } from '@/widgets/shared';
import type { WidgetProps } from '@/widgets/types';

const EXAMISH = /\b(exam|midterm|final|quiz|test)\b/i;
const HORIZON_DAYS = 120;

interface Row {
  item: EffectiveItem;
  when: Date;
  kind: 'exam' | 'quiz' | 'final';
  location: string | null;
}

const toneFor = (k: Row['kind']) => (k === 'quiz' ? 'var(--amber)' : 'var(--coral)');

/** Days-until in one word: "today", "tmrw", or the number; the label below says "days". */
function countdown(when: Date): { big: string; small: string; urgent: boolean } {
  const d = differenceInCalendarDays(when, new Date());
  if (d <= 0) return { big: 'today', small: format(when, 'h:mm a'), urgent: true };
  if (d === 1) return { big: 'tmrw', small: format(when, 'h:mm a'), urgent: true };
  return { big: String(d), small: d === 1 ? 'day' : 'days', urgent: d <= 3 };
}

/** Exams, quizzes, and finals across every course: hand-entered dates plus assignments titled like one. */
export function ExamsWidget({ size }: WidgetProps) {
  const win = useMemo(() => {
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setDate(to.getDate() + HORIZON_DAYS);
    return { from: from.toISOString(), to: to.toISOString() };
  }, []);
  const manual = useItems({ kind: ['event'], source: ['manual'], from: win.from, to: win.to, limit: 300 });
  const assignments = useItems({ kind: ['assignment'], from: win.from, to: win.to, includeDone: true, includeInformational: true, limit: 500 });
  const { open } = usePane();

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const it of manual.data ?? []) {
      const r = manualRaw(it);
      if (!r || (r.eventKind !== 'exam' && r.eventKind !== 'quiz' && r.eventKind !== 'final') || !it.startsAt) continue;
      out.push({ item: it, when: new Date(it.startsAt), kind: r.eventKind, location: r.location });
    }
    for (const it of assignments.data ?? []) {
      if (!it.dueAt || !EXAMISH.test(it.title) || it.informational) continue;
      const kind: Row['kind'] = /\bquiz\b/i.test(it.title) ? 'quiz' : /\bfinal\b/i.test(it.title) ? 'final' : 'exam';
      out.push({ item: it, when: new Date(it.dueAt), kind, location: null });
    }
    const now = Date.now() - 6 * 3600e3;
    return out.filter((r) => r.when.getTime() >= now).sort((a, b) => a.when.getTime() - b.when.getTime());
  }, [manual.data, assignments.data]);

  if (manual.isError) return <ErrorState error={manual.error} onRetry={() => manual.refetch()} />;
  const xs = size.tier === 'xs';
  const limit = xs ? 1 : Math.max(2, Math.floor((size.height - 8) / 58));
  const soon = rows.filter((r) => differenceInCalendarDays(r.when, new Date()) <= 7).length;

  return (
    <div className="flex h-full flex-col">
      <WidgetHeader>
        {rows.length > 0 && (
          soon > 0 ? (
            <span className="flex h-7 items-center gap-1.5 rounded-full px-[11px] text-[12.5px] font-semibold text-coral" style={{ background: 'color-mix(in oklab, var(--coral) 18%, var(--card))' }}>
              <span className="size-1.5 rounded-full bg-coral" />{soon} this week
            </span>
          ) : (
            <span className="text-[12.5px] text-sub">{rows.length} upcoming</span>
          )
        )}
      </WidgetHeader>
      {manual.isPending || assignments.isPending ? (
        <div className="m-3 h-16 animate-pulse rounded-xl bg-well" />
      ) : !rows.length ? (
        <EmptyState>No exams on the calendar. Add dates from a course's Dates tab.</EmptyState>
      ) : (
        <ul className="min-h-0 flex-1 overflow-auto p-1.5">
          {rows.slice(0, limit).map((r) => {
            const c = countdown(r.when);
            const tone = safeColor(r.item.course?.color) ?? toneFor(r.kind);
            return (
              <li key={r.item.id}>
                <ItemPopover item={r.item}>
                  <span className="flex items-center gap-3 rounded-xl px-2.5 py-2 transition-colors hover:bg-well">
                    <span className={cn('grid w-[52px] shrink-0 place-items-center rounded-[12px] py-1.5 leading-none', c.urgent ? 'text-white' : 'text-ink')} style={{ background: c.urgent ? toneFor(r.kind) : 'var(--well)' }}>
                      <span className={cn('font-bold tracking-[-0.03em]', c.big.length > 2 ? 'text-[13px]' : 'text-xl')}>{c.big}</span>
                      <span className={cn('mt-0.5 text-[10px]', c.urgent ? 'text-white/80' : 'text-ter')}>{c.small}</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-[11.5px]">
                        <span className="size-1.5 shrink-0 rounded-full" style={{ background: tone }} />
                        {r.item.course && <button className="font-medium hover:underline" style={{ color: tone }} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); open({ kind: 'course', courseId: r.item.course!.id, tab: 'dates' }); }}>{r.item.course.code}</button>}
                        <span className="uppercase tracking-wide text-ter">{r.kind}</span>
                      </span>
                      <span className="block truncate text-[13.5px] font-medium">{r.item.title}</span>
                      <span className="block truncate text-xs text-sub">{format(r.when, 'EEE MMM d')}{r.item.allDay ? '' : ` · ${format(r.when, 'h:mm a')}`}{r.location ? ` · ${r.location}` : ''}</span>
                    </span>
                  </span>
                </ItemPopover>
              </li>
            );
          })}
          {rows.length > limit && <li className="px-3 py-1 text-xs text-ter">+{rows.length - limit} more</li>}
        </ul>
      )}
    </div>
  );
}
