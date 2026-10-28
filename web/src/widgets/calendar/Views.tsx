import { useEffect, useRef } from 'react';
import { addDays, differenceInMinutes, format, getHours, getMinutes, isSameMonth } from 'date-fns';
import type { EffectiveItem } from '@collected/shared';
import { cn } from '@/lib/utils';
import { ItemPopover } from '@/widgets/ItemPopover';
import { dayKey, daysBetween, groupByDay, isToday, itemColor, itemEnd, itemTime, sortItems, timeLabel } from './utils';

const tint = (color: string | null, pct: number) => `color-mix(in srgb, ${color ?? 'var(--ink)'} ${pct}%, var(--surface))`;
/** The course colour pulled toward ink, so it reads as text on its own tint. */
const inked = (color: string | null) => (color ? `color-mix(in srgb, ${color} 62%, var(--ink))` : 'var(--ink)');

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
        {item.kind === 'event' && (item.raw as { location?: string | null }).location && <span className="hidden shrink-0 truncate text-xs text-ter sm:inline">{(item.raw as { location?: string }).location}</span>}
      </span>
    </ItemPopover>
  );
}

/* ---------- xs: next few things ---------- */
export function NextUp({ items, limit = 4 }: { items: EffectiveItem[]; limit?: number }) {
  const now = Date.now();
  const upcoming = items
    .filter((i) => {
      const t = itemTime(i);
      const e = itemEnd(i);
      return t && (e ? e.getTime() : t.getTime()) >= now;
    })
    .sort(sortItems)
    .slice(0, limit);
  if (!upcoming.length) return <p className="p-3 text-sm text-sub">Nothing coming up.</p>;
  return (
    <ul className="space-y-0.5 p-1.5">
      {upcoming.map((i) => {
        const t = itemTime(i)!;
        return (
          <li key={i.id}>
            <ItemPopover item={i}>
              <span className="flex items-baseline gap-2 rounded-lg px-1.5 py-1 text-sm hover:bg-well">
                <span className="w-16 shrink-0 text-xs text-ter">{isToday(t) ? format(t, 'h:mm a') : format(t, 'EEE h:mm a')}</span>
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
  const dayList = daysBetween(from, addDays(from, days - 1));
  const grouped = groupByDay(items, dayList);
  return (
    <div className="h-full overflow-auto px-2 py-1.5">
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
    <div className="py-0.5 text-center">
      <div className={cn('font-mono text-[10.5px] uppercase tracking-[0.08em]', today ? 'font-semibold text-brand-ink' : 'text-ter')}>{format(d, 'EEE')}</div>
      {today ? (
        <div className="mx-auto mt-0.5 grid size-[26px] place-items-center rounded-full bg-brand text-sm font-semibold text-on-brand">{format(d, 'd')}</div>
      ) : (
        <div className="mt-0.5 text-[15px] font-semibold leading-[26px] text-ink">{format(d, 'd')}</div>
      )}
    </div>
  );
}

/* ---------- md/wide: 7-day strip ---------- */
export function WeekStrip({ items, from }: { items: EffectiveItem[]; from: Date }) {
  const dayList = daysBetween(from, addDays(from, 6));
  const grouped = groupByDay(items, dayList);
  return (
    <div className="grid h-full grid-cols-7 gap-1 overflow-hidden px-2.5 pb-2 pt-1.5">
      {dayList.map((d) => (
        <div key={dayKey(d)} className={cn('flex min-w-0 flex-col overflow-hidden rounded-xl', isToday(d) ? 'bg-brand-soft' : 'bg-well')}>
          <DayHead d={d} />
          <div className="min-h-0 flex-1 space-y-[3px] overflow-auto p-1">
            {(grouped.get(dayKey(d)) ?? []).map((i) => <Chip key={i.id} item={i} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------- lg: week grid with hours ---------- */
const HOUR_START = 7;
const HOUR_END = 23;
const PX_PER_HOUR = 52;

export function WeekGrid({ items, from }: { items: EffectiveItem[]; from: Date }) {
  const dayList = daysBetween(from, addDays(from, 6));
  const grouped = groupByDay(items, dayList);
  const hours = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i);
  const now = new Date();
  const nowTop = (getHours(now) + getMinutes(now) / 60 - HOUR_START) * PX_PER_HOUR;
  const scrollRef = useRef<HTMLDivElement>(null);
  // Start the day view a little above "now" (or at 8 AM outside today's week).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const hasToday = dayList.some(isToday);
    el.scrollTop = Math.max(0, (hasToday ? nowTop : (8 - HOUR_START) * PX_PER_HOUR) - 60);
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
        <div className="pr-2.5 pt-1.5 text-right font-mono text-[10px] uppercase tracking-[0.06em] text-ter">all day</div>
        {dayList.map((d) => {
          const allDay = (grouped.get(dayKey(d)) ?? []).filter((i) => i.allDay || i.kind !== 'event');
          return (
            <div key={dayKey(d)} className="flex max-h-[76px] min-h-[30px] min-w-0 flex-col gap-[3px] overflow-auto px-[2px] py-0.5">
              {allDay.map((i) => <Chip key={i.id} item={i} dense />)}
            </div>
          );
        })}
      </div>
      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto px-2.5 pb-2">
        <div className={cn('grid', col)} style={{ height: (hours.length - 1) * PX_PER_HOUR + 8 }}>
          <div className="relative">
            {hours.map((h) => (
              <span key={h} className="absolute right-2.5 -translate-y-1/2 font-mono text-[10.5px] tabular-nums text-ter" style={{ top: (h - HOUR_START) * PX_PER_HOUR }}>
                {h === 12 ? '12 PM' : h > 12 ? `${h - 12} PM` : `${h} AM`}
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
                {today && nowTop >= 0 && nowTop <= (hours.length - 1) * PX_PER_HOUR && (
                  <>
                    <div className="absolute inset-x-0 z-10 h-[2px] rounded-full bg-brand" style={{ top: nowTop }} />
                    <div className="absolute -left-[5px] z-10 size-2.5 rounded-full bg-brand shadow-[0_0_0_2px_var(--surface)]" style={{ top: nowTop - 4 }} />
                  </>
                )}
                {timed.map((i) => {
                  const s = itemTime(i)!;
                  const e = itemEnd(i) ?? new Date(s.getTime() + 30 * 60_000);
                  const top = (getHours(s) + getMinutes(s) / 60 - HOUR_START) * PX_PER_HOUR;
                  const height = Math.max(22, (differenceInMinutes(e, s) / 60) * PX_PER_HOUR - 3);
                  const color = itemColor(i);
                  const loc = (i.raw as { location?: string | null }).location;
                  return (
                    <div key={i.id} className="absolute inset-x-1" style={{ top: top + 1, height }}>
                      <ItemPopover item={i} side="right" className="h-full">
                        <div
                          className={cn('h-full overflow-hidden rounded-[10px] px-2 py-[7px] text-left leading-tight transition-[filter] hover:brightness-[1.04]', i.effectiveDone && 'opacity-60')}
                          style={{ background: tint(color, 16), boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color ?? 'var(--ink)'} 22%, transparent)` }}
                          title={`${i.title} · ${timeLabel(i)}`}
                        >
                          <div className="truncate text-xs font-semibold" style={{ color: inked(color) }}>{i.course?.code ?? i.title}</div>
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
export function Month({ items, from, to, anchor }: { items: EffectiveItem[]; from: Date; to: Date; anchor: Date }) {
  const dayList = daysBetween(from, to);
  const grouped = groupByDay(items, dayList);
  const weeks = Math.ceil(dayList.length / 7);
  return (
    <div className="flex h-full flex-col overflow-hidden px-2.5 pb-2 pt-1">
      <div className="grid shrink-0 grid-cols-7 text-center font-mono text-[10.5px] uppercase tracking-[0.08em] text-ter">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="py-1">{d}</div>)}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 gap-1" style={{ gridTemplateRows: `repeat(${weeks}, minmax(0, 1fr))` }}>
        {dayList.map((d) => {
          const list = grouped.get(dayKey(d)) ?? [];
          const inMonth = isSameMonth(d, anchor);
          const today = isToday(d);
          return (
            <div key={dayKey(d)} className={cn('flex min-h-0 flex-col overflow-hidden rounded-[10px] p-1', today ? 'bg-brand-soft' : inMonth ? 'bg-well' : 'bg-well/40')}>
              <div className={cn('px-1 text-[11px] tabular-nums', today ? 'font-bold text-brand-ink' : inMonth ? 'font-semibold text-sub' : 'text-ter/60')}>{format(d, 'd')}</div>
              <div className="min-h-0 flex-1 space-y-px overflow-hidden">
                {list.slice(0, 4).map((i) => <Chip key={i.id} item={i} dense />)}
                {list.length > 4 && <div className="px-1 text-[10px] text-ter">+{list.length - 4} more</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
