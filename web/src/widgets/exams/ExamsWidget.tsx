import { useMemo } from 'react';
import { differenceInCalendarDays, format } from 'date-fns';
import type { EffectiveItem } from '@collected/shared';
import { WidgetHeader } from '@/dashboard/WidgetHeader';
import { useItems } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { safeColor } from '@/lib/color';
import { ItemPopover } from '@/widgets/ItemPopover';
import { EmptyState, ErrorState } from '@/widgets/Placeholder';
import { manualRaw } from '@/widgets/shared';
import type { WidgetProps } from '@/widgets/types';
import { useNow } from '@/widgets/useNow';

const EXAMISH = /\b(exam|midterm|final|quiz|test)\b/i;
/** "Final project", "Test case report", "Midterm essay": titled like an exam but not one. */
const NOT_EXAM = /\b(project|paper|report|cases?|essay)\b/i;
const HORIZON_DAYS = 120;

interface Row {
  item: EffectiveItem;
  when: Date;
  kind: 'exam' | 'quiz' | 'final';
  location: string | null;
}

const toneFor = (k: Row['kind']) => (k === 'quiz' ? 'var(--caution)' : 'var(--critical)');

/** Days-until in one word: "today", "tmrw", or the number; the label below says "days" (or the time, when near). */
function countdown(when: Date, allDay: boolean, now: Date): { big: string; small: string; urgent: boolean } {
  const d = differenceInCalendarDays(when, now);
  const time = allDay ? 'all day' : format(when, 'h:mm a');
  if (d <= 0) return { big: 'today', small: time, urgent: true };
  if (d === 1) return { big: 'tmrw', small: time, urgent: true };
  return { big: String(d), small: d === 1 ? 'day' : 'days', urgent: d <= 3 };
}

/** Same course, same day, same title once case and punctuation are ignored: a hand-entered exam and its Canvas twin. */
const dupKey = (r: Row) => `${r.item.courseId ?? ''}|${format(r.when, 'yyyy-MM-dd')}|${r.item.title.toLowerCase().replace(/[^a-z0-9]+/g, '')}`;

/** Exams, quizzes, and finals across every course: hand-entered dates plus assignments titled like one. */
export function ExamsWidget(_props: WidgetProps) {
  const win = useMemo(() => {
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setDate(to.getDate() + HORIZON_DAYS);
    return { from: from.toISOString(), to: to.toISOString() };
  }, []);
  const manual = useItems({ kind: ['event'], source: ['manual'], from: win.from, to: win.to, limit: 300 });
  const assignments = useItems({ kind: ['assignment'], from: win.from, to: win.to, includeDone: true, includeInformational: true, limit: 500 });
  const now = useNow(60_000);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const it of manual.data ?? []) {
      const r = manualRaw(it);
      if (!r || (r.eventKind !== 'exam' && r.eventKind !== 'quiz' && r.eventKind !== 'final') || !it.startsAt) continue;
      out.push({ item: it, when: new Date(it.startsAt), kind: r.eventKind, location: r.location });
    }
    // manual rows come first, so a Canvas assignment duplicating one is the one dropped
    const seen = new Set(out.map(dupKey));
    for (const it of assignments.data ?? []) {
      if (!it.dueAt || !EXAMISH.test(it.title) || NOT_EXAM.test(it.title) || it.informational) continue;
      const kind: Row['kind'] = /\bquiz\b/i.test(it.title) ? 'quiz' : /\bfinal\b/i.test(it.title) ? 'final' : 'exam';
      const row: Row = { item: it, when: new Date(it.dueAt), kind, location: null };
      if (seen.has(dupKey(row))) continue;
      seen.add(dupKey(row));
      out.push(row);
    }
    return out.sort((a, b) => a.when.getTime() - b.when.getTime());
  }, [manual.data, assignments.data]);

  const err = manual.error ?? assignments.error;
  if (err) return <ErrorState error={err} onRetry={() => { void manual.refetch(); void assignments.refetch(); }} />;
  // a timed exam stays listed six hours past its start, an all-day one until its day ends
  const shown = rows.filter((r) => (r.item.allDay ? r.when.getTime() + 24 * 3600e3 : r.when.getTime() + 6 * 3600e3) >= now.getTime());
  const soon = shown.filter((r) => differenceInCalendarDays(r.when, now) <= 7).length;

  return (
    <div className="flex h-full flex-col">
      <WidgetHeader>
        {shown.length > 0 && (
          soon > 0 ? (
            <span className="flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-[11px] text-[12.5px] font-semibold text-critical" style={{ background: 'color-mix(in srgb, var(--critical) 11%, var(--surface))' }}>
              <span className="size-1.5 rounded-full bg-critical" />{soon} this week
            </span>
          ) : (
            <span className="min-w-0 truncate text-[12.5px] text-sub">{shown.length} upcoming</span>
          )
        )}
      </WidgetHeader>
      {manual.isPending || assignments.isPending ? (
        <div className="m-3 h-16 animate-pulse rounded-xl bg-well" />
      ) : !shown.length ? (
        <EmptyState>No exams on the calendar. Add dates from a course's Dates tab.</EmptyState>
      ) : (
        <ul className="min-h-0 flex-1 overflow-auto p-1.5">
          {shown.map((r) => {
            const c = countdown(r.when, r.item.allDay, now);
            const tone = safeColor(r.item.course?.color) ?? toneFor(r.kind);
            return (
              <li key={r.item.id}>
                <ItemPopover item={r.item}>
                  <span className="flex items-center gap-3 rounded-xl px-2.5 py-2 transition-colors hover:bg-well">
                    <span className="grid w-[54px] shrink-0 place-items-center rounded-[14px] bg-well py-2 leading-none" style={c.urgent ? { color: toneFor(r.kind), background: `color-mix(in srgb, ${toneFor(r.kind)} 10%, var(--well))` } : undefined}>
                      <span className={cn('font-[560] tracking-[-0.03em]', c.big.length > 2 ? 'text-[14px]' : 'text-[22px]')}>{c.big}</span>
                      <span className="mt-1 text-[10.5px] font-medium opacity-75">{c.small}</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-[11.5px]">
                        <span className="size-1.5 shrink-0 rounded-full" style={{ background: tone }} />
                        {/* plain text: the row is already a button (the popover), and its details link to the course */}
                        {r.item.course && <span className="font-medium" style={{ color: tone }}>{r.item.course.code}</span>}
                        <span className="label !text-[10px] !text-ter">{r.kind}</span>
                      </span>
                      <span className="block truncate text-[13.5px] font-medium">{r.item.title}</span>
                      <span className="block truncate text-xs text-sub">{format(r.when, 'EEE MMM d')}{r.item.allDay ? '' : ` · ${format(r.when, 'h:mm a')}`}{r.location ? ` · ${r.location}` : ''}</span>
                    </span>
                  </span>
                </ItemPopover>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
