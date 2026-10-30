import { useCallback, useLayoutEffect, useRef } from 'react';
import { addDays, endOfDay, format, getHours, getMinutes, isSameMonth } from 'date-fns';
import type { EffectiveItem } from '@collected/shared';
import { cn } from '@/lib/utils';
import { ItemPopover } from '@/widgets/ItemPopover';
import { useScrollEdges } from '@/widgets/shared';
import { GRID_MINUTES, MIN_EVENT_PX, PX_PER_HOUR, SCROLL_TO_HOUR, dayKey, daysBetween, groupByDay, isToday, itemColor, itemEnd, itemTime, placeDay, sortItems, timeLabel } from './utils';

const tint = (color: string | null, pct: number) => `color-mix(in srgb, ${color ?? 'var(--ink)'} ${pct}%, var(--surface))`;

/** A one-line pill: dot, optional time, title. Done items dim and strike through. */
function Chip({ item, dense }: { item: EffectiveItem; dense?: boolean }) {
  const color = itemColor(item);
  const done = item.effectiveDone;
  const isDue = item.kind !== 'event';
  return (
    <ItemPopover item={item}>
      <span
        className={cn('flex min-w-0 items-center gap-1.5 rounded-[8px] px-[7px] py-[3px] text-[11.5px] leading-tight transition-[filter] hover:brightness-[1.04]', done && 'text-ter line-through')}
        style={{ background: done ? 'var(--well)' : color ? tint(color, 13) : 'var(--well)' }}
        title={`${item.title}${item.course ? ` · ${item.course.code}` : ''}`}
      >
        <span className={cn('inline-block size-[5px] shrink-0 rounded-full', isDue && 'rounded-[1px]')} style={{ background: done ? 'var(--ter)' : (color ?? 'var(--ink)') }} />
        {!dense && !item.allDay && <span className="shrink-0 tabular-nums text-sub">{format(itemTime(item)!, 'h:mma').toLowerCase().replace(':00', '')}</span>}
        <span className="truncate">{item.title}</span>
      </span>
    </ItemPopover>
  );
}

function Row({ item }: { item: EffectiveItem }) {
  const color = itemColor(item);
  return (
    <ItemPopover item={item}>
      <span className="flex items-center gap-3 rounded-xl px-2.5 py-1.5 text-[13.5px] hover:bg-well">
        <span className="w-[5.5rem] shrink-0 text-xs tabular-nums text-ter">{timeLabel(item)}</span>
        <span className="inline-block size-2 shrink-0 rounded-full" style={{ background: color ?? 'var(--ter)' }} />
        <span className={cn('min-w-0 flex-1 truncate font-medium', item.effectiveDone && 'text-ter line-through')}>{item.title}</span>
        {item.course && <span className="shrink-0 text-xs font-medium" style={{ color: color ?? 'var(--sub)' }}>{item.course.code}</span>}
        {/* by the widget's width (the body is a size container), not the viewport's; never more than 40% of the row */}
        {item.kind === 'event' && (item.raw as { location?: string | null }).location && <span className="hidden min-w-0 max-w-[40%] truncate text-xs text-ter @sm:inline">{(item.raw as { location?: string }).location}</span>}
      </span>
    </ItemPopover>
  );
}

/* ---------- xs: what's next ---------- */
/** "2:30 PM" today, "Wed 2:30 PM" later; all-day items say so instead of showing midnight. */
function nextLabel(item: EffectiveItem, t: Date): string {
  if (item.allDay) return isToday(t) ? 'all day' : `${format(t, 'EEE')} all day`;
  return isToday(t) ? format(t, 'h:mm a') : format(t, 'EEE h:mm a');
}

export function NextUp({ items, now }: { items: EffectiveItem[]; now: Date }) {
  const fade = useScrollEdges();
  const upcoming = items
    .filter((i) => {
      const t = itemTime(i);
      if (!t) return false;
      // an all-day item stays up for its whole day; a timed one until it ends (or, with no end, until it starts)
      const until = i.allDay ? endOfDay(itemEnd(i) ? addDays(itemEnd(i)!, -1) : t) : (itemEnd(i) ?? t);
      return until.getTime() >= now.getTime();
    })
    .sort(sortItems);
  if (!upcoming.length) return <p className="p-3 text-sm text-sub">Nothing coming up.</p>;
  return (
    <ul ref={fade} className="scroll-fade h-full space-y-0.5 overflow-auto p-1.5">
      {upcoming.map((i) => {
        const t = itemTime(i)!;
        return (
          <li key={i.id}>
            <ItemPopover item={i}>
              <span className="flex items-baseline gap-2 rounded-lg px-1.5 py-1 text-sm hover:bg-well">
                <span className="w-[5.75rem] shrink-0 whitespace-nowrap text-xs tabular-nums text-ter">{nextLabel(i, t)}</span>
                <span className="inline-block size-2 shrink-0 self-center rounded-full" style={{ background: itemColor(i) ?? 'var(--ter)' }} />
                <span className="min-w-0 flex-1 truncate">{i.title}</span>
              </span>
            </ItemPopover>
          </li>
        );
      })}
    </ul>
  );
}

/* ---------- sm/tall: agenda by day ---------- */
export function Agenda({ items, from, days = 7 }: { items: EffectiveItem[]; from: Date; days?: number }) {
  const fade = useScrollEdges();
  const dayList = daysBetween(from, addDays(from, days - 1));
  const grouped = groupByDay(items, dayList);
  return (
    <div ref={fade} className="scroll-fade h-full overflow-auto px-2 py-1.5">
      {dayList.map((d) => {
        const list = grouped.get(dayKey(d)) ?? [];
        const today = isToday(d);
        return (
          <section key={dayKey(d)} className="mb-2">
            <h4 className="sticky top-0 z-10 flex items-center gap-2 bg-surface/95 px-2.5 py-1.5 backdrop-blur">
              {today ? <span className="grid h-5 min-w-5 place-items-center rounded-full bg-brand px-1.5 text-[11px] font-semibold text-on-brand">{format(d, 'd')}</span> : <span className="min-w-5 text-center text-[13px] font-semibold text-sub">{format(d, 'd')}</span>}
              <span className={cn('label', today && '!text-brand-ink')}>{today ? 'Today' : format(d, 'EEEE')}</span>
              <span className="text-[12px] text-ter">{format(d, 'MMM')}</span>
            </h4>
            {list.length ? list.map((i) => <Row key={i.id} item={i} />) : <p className="px-2.5 py-0.5 text-xs text-ter/70">—</p>}
          </section>
        );
      })}
    </div>
  );
}

function DayHead({ d }: { d: Date }) {
  const today = isToday(d);
  return (
    <div className="flex h-8 items-center justify-center gap-1.5">
      <span className={cn('label !text-[10.5px]', today ? '!text-brand-ink' : '!text-ter')}>{format(d, 'EEE')}</span>
      {today ? (
        <span className="grid size-6 place-items-center rounded-full bg-brand text-[13px] font-semibold text-on-brand">{format(d, 'd')}</span>
      ) : (
        <span className="text-[14px] font-semibold text-ink">{format(d, 'd')}</span>
      )}
    </div>
  );
}

/* ---------- md/wide: 7-day strip ---------- */
export function WeekStrip({ items, from }: { items: EffectiveItem[]; from: Date }) {
  const fade = useScrollEdges();
  const dayList = daysBetween(from, addDays(from, 6));
  const grouped = groupByDay(items, dayList);
  return (
    <div className="grid h-full grid-cols-7 gap-1 overflow-hidden px-2.5 pb-2 pt-1.5">
      {dayList.map((d) => (
        <div key={dayKey(d)} className={cn('flex min-w-0 flex-col overflow-hidden rounded-xl', isToday(d) ? 'bg-brand-soft' : 'bg-well')}>
          <DayHead d={d} />
          <div ref={fade} className="scroll-fade min-h-0 flex-1 space-y-[3px] overflow-auto p-1 [--fade-size:16px]">
            {(grouped.get(dayKey(d)) ?? []).map((i) => <Chip key={i.id} item={i} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

/** "12 AM", "7 AM", "12 PM", "11 PM". */
const hourLabel = (h: number) => (h === 0 ? '12 AM' : h === 12 ? '12 PM' : h > 12 ? `${h - 12} PM` : `${h} AM`);
/** The scroller's top padding (pt-2.5): the grid's midnight line sits this far below its top edge. */
const GRID_PAD_TOP = 10;

/* ---------- lg: week grid with hours ---------- */
export function WeekGrid({ items, from, now }: { items: EffectiveItem[]; from: Date; now: Date }) {
  const fade = useScrollEdges();
  const dayList = daysBetween(from, addDays(from, 6));
  const grouped = groupByDay(items, dayList);
  // the whole day; the grid scrolls inside the widget rather than squeezing 24 rows into its height
  const gridPx = (GRID_MINUTES / 60) * PX_PER_HOUR;
  const hours = Array.from({ length: GRID_MINUTES / 60 }, (_, h) => h);
  const nowTop = (getHours(now) + getMinutes(now) / 60) * PX_PER_HOUR;
  const scrollRef = useRef<HTMLDivElement>(null);
  const setScroller = useCallback((el: HTMLDivElement | null) => {
    scrollRef.current = el;
    return fade(el);
  }, [fade]);
  // Open with "now" a third of the way down the visible area; a week without today opens at 7 AM.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = dayList.some(isToday) ? GRID_PAD_TOP + nowTop - el.clientHeight / 3 : SCROLL_TO_HOUR * PX_PER_HOUR;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from.getTime()]);
  const col = 'grid-cols-[48px_repeat(7,minmax(0,1fr))]';
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className={cn('grid shrink-0 px-2.5 pt-1.5', col)}>
        <div />
        {dayList.map((d) => <DayHead key={dayKey(d)} d={d} />)}
      </div>
      <div className={cn('grid shrink-0 px-2.5 pb-1 pt-0.5', col)}>
        <div className="pr-2.5 pt-1.5 text-right text-[11px] text-ter">all day</div>
        {dayList.map((d) => {
          const allDay = (grouped.get(dayKey(d)) ?? []).filter((i) => i.allDay || i.kind !== 'event');
          return (
            <div key={dayKey(d)} ref={fade} className="scroll-fade flex max-h-[76px] min-h-[30px] min-w-0 flex-col gap-[3px] overflow-auto px-[2px] py-0.5 [--fade-size:14px]">
              {allDay.map((i) => <Chip key={i.id} item={i} dense />)}
            </div>
          );
        })}
      </div>
      {/* pt keeps the first hour label, centred on its line, from being clipped at the top of the scroller */}
      <div ref={setScroller} className="scroll-fade relative min-h-0 flex-1 overflow-auto px-2.5 pb-2 pt-2.5">
        <div className={cn('grid', col)} style={{ height: gridPx + 8 }}>
          <div className="relative">
            {hours.map((h) => (
              <span key={h} className="absolute right-2.5 -translate-y-1/2 text-[11px] text-ter" style={{ top: h * PX_PER_HOUR }}>
                {hourLabel(h)}
              </span>
            ))}
          </div>
          {dayList.map((d) => {
            const today = isToday(d);
            const timed = (grouped.get(dayKey(d)) ?? []).filter((i) => !i.allDay && i.kind === 'event');
            // hairline hour rules on the card itself; today sits on a faint well
            return (
              <div
                key={dayKey(d)}
                className={cn('relative border-l border-line', today && 'rounded-[10px] bg-well/55')}
                style={{ backgroundImage: `repeating-linear-gradient(to bottom, var(--line) 0, var(--line) 1px, transparent 1px, transparent ${PX_PER_HOUR}px)` }}
              >
                {today && (
                  <>
                    <div className="absolute inset-x-0 z-10 h-[2px] rounded-full bg-brand" style={{ top: nowTop }} />
                    <div className="absolute -left-[5px] z-10 size-2.5 rounded-full bg-brand shadow-[0_0_0_2px_var(--surface)]" style={{ top: nowTop - 4 }} />
                  </>
                )}
                {placeDay(timed).map(({ item: i, start: s, end: e, top: topMin, bottom: bottomMin, col: c, cols }) => {
                  const top = (topMin / 60) * PX_PER_HOUR;
                  const height = Math.max(MIN_EVENT_PX, ((bottomMin - topMin) / 60) * PX_PER_HOUR - 3);
                  const color = itemColor(i);
                  const loc = (i.raw as { location?: string | null }).location;
                  // 4px in from each side of the day column, then the column's share; a 2px gutter between neighbours
                  const pos = { left: `calc(4px + (100% - 8px) * ${c / cols})`, width: `calc((100% - 8px) / ${cols} - ${cols > 1 ? 2 : 0}px)` };
                  return (
                    <div key={i.id} className="absolute" style={{ top: top + 1, height, ...pos }}>
                      <ItemPopover item={i} side="right" className="h-full">
                        <div
                          className={cn('relative h-full overflow-hidden rounded-[6px] py-[6px] text-left leading-tight transition-[filter] hover:brightness-[1.04]', cols > 2 ? 'pl-[10px] pr-1' : 'pl-[13px] pr-2', i.effectiveDone && 'opacity-60')}
                          style={{ background: tint(color, 16), boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color ?? 'var(--ink)'} 22%, transparent)` }}
                          title={`${i.title} · ${timeLabel(i)}`}
                        >
                          {/* the solid course-colour bar down the left edge */}
                          <span aria-hidden className="absolute bottom-[4px] left-[4px] top-[4px] w-[3px] rounded-full" style={{ background: color ?? 'var(--ink-muted)' }} />
                          <div className="truncate text-xs font-semibold text-ink">{i.course?.code ?? i.title}</div>
                          {height > 34 && <div className="mt-0.5 truncate text-[11px] text-sub">{i.course ? `${format(s, 'h:mm')} – ${format(e, 'h:mm')}` : timeLabel(i)}</div>}
                          {height > 62 && i.course && <div className="mt-1 truncate text-[11px] text-sub">{i.title.replace(new RegExp(`^${i.course.code}\\s*\\(\\d+\\)\\s*-\\s*`), '')}{loc ? ` · ${loc}` : ''}</div>}
                          {height > 62 && !i.course && loc && <div className="mt-1 truncate text-[11px] text-sub">{loc}</div>}
                        </div>
                      </ItemPopover>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ---------- xl: month ---------- */
/** Past this many items a day shows its count by the date, since the list below may fade out before the last one. */
const MONTH_COUNT_AFTER = 2;
/** The day's list fades out over its last few pixels instead of cutting a chip in half. */
const MONTH_FADE = 'linear-gradient(to bottom, #000 calc(100% - 14px), transparent)';

export function Month({ items, from, to, anchor, onPickDay }: { items: EffectiveItem[]; from: Date; to: Date; anchor: Date; onPickDay(d: Date): void }) {
  const dayList = daysBetween(from, to);
  const grouped = groupByDay(items, dayList);
  const weeks = Math.ceil(dayList.length / 7);
  return (
    <div className="flex h-full flex-col overflow-hidden px-2.5 pb-2 pt-1">
      <div className="label grid shrink-0 grid-cols-7 text-center !text-[10.5px] !text-ter">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="py-1">{d}</div>)}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 gap-1" style={{ gridTemplateRows: `repeat(${weeks}, minmax(0, 1fr))` }}>
        {dayList.map((d) => {
          const list = grouped.get(dayKey(d)) ?? [];
          const inMonth = isSameMonth(d, anchor);
          const today = isToday(d);
          return (
            <div key={dayKey(d)} className={cn('flex min-h-0 flex-col overflow-hidden rounded-[10px] p-1', today ? 'bg-brand-soft' : inMonth ? 'bg-well' : 'bg-well/40')}>
              <button
                type="button"
                className={cn('flex shrink-0 items-baseline justify-between gap-1 rounded-[6px] px-1 text-left text-[11px] tabular-nums transition-colors hover:bg-surface/70', today ? 'font-[620] text-brand-ink' : inMonth ? 'font-semibold text-sub' : 'text-ter/60')}
                title={`${format(d, 'EEEE, MMMM d')}: ${list.length ? `${list.length} item${list.length === 1 ? '' : 's'}` : 'nothing'}. Open the day.`}
                aria-label={`Open ${format(d, 'EEEE, MMMM d')} (${list.length} item${list.length === 1 ? '' : 's'})`}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => onPickDay(d)}
              >
                {format(d, 'd')}
                {list.length > MONTH_COUNT_AFTER && <span className="text-[10px] font-medium text-ter">{list.length}</span>}
              </button>
              <div className="min-h-0 flex-1 space-y-px overflow-hidden" style={{ maskImage: MONTH_FADE, WebkitMaskImage: MONTH_FADE }}>
                {list.map((i) => <Chip key={i.id} item={i} dense />)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
