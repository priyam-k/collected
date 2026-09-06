import { addDays, differenceInMinutes, format, getHours, getMinutes, isSameMonth } from 'date-fns';
import type { EffectiveItem } from '@collected/shared';
import { cn } from '@/lib/utils';
import { CourseDot } from '@/widgets/shared';
import { dayKey, daysBetween, groupByDay, isToday, itemColor, itemEnd, itemTime, sortItems, timeLabel } from './utils';

function Chip({ item, dense }: { item: EffectiveItem; dense?: boolean }) {
  const color = itemColor(item);
  const isDue = item.kind !== 'event';
  const body = (
    <span
      className={cn('flex min-w-0 items-center gap-1 rounded px-1 py-0.5 text-xs leading-tight hover:bg-accent', item.effectiveDone && 'line-through opacity-60')}
      title={`${item.title}${item.course ? ` · ${item.course.code}` : ''}`}
    >
      <span className={cn('inline-block size-1.5 shrink-0 rounded-full', isDue && 'rounded-sm')} style={{ background: color ?? 'var(--muted-foreground)' }} />
      {!dense && !item.allDay && <span className="shrink-0 tabular-nums text-muted-foreground">{format(itemTime(item)!, 'h:mma').toLowerCase().replace(':00', '')}</span>}
      <span className="truncate">{item.title}</span>
    </span>
  );
  return item.url ? (
    <a href={item.url} target="_blank" rel="noreferrer" className="block min-w-0">
      {body}
    </a>
  ) : (
    <div className="min-w-0">{body}</div>
  );
}

function Row({ item }: { item: EffectiveItem }) {
  const color = itemColor(item);
  const inner = (
    <>
      <span className="w-[5.5rem] shrink-0 text-xs tabular-nums text-muted-foreground">{timeLabel(item)}</span>
      <CourseDot color={color} />
      <span className={cn('min-w-0 flex-1 truncate', item.effectiveDone && 'line-through opacity-60')}>{item.title}</span>
      {item.course && <span className="shrink-0 text-xs text-muted-foreground">{item.course.code}</span>}
      {item.kind === 'event' && (item.raw as { location?: string | null }).location && <span className="hidden shrink-0 truncate text-xs text-muted-foreground sm:inline">{(item.raw as { location?: string }).location}</span>}
    </>
  );
  const cls = 'flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-accent/60';
  return item.url ? (
    <a href={item.url} target="_blank" rel="noreferrer" className={cls}>
      {inner}
    </a>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

/* ---------- xs: next few things ---------- */
export function NextUp({ items, limit = 4 }: { items: EffectiveItem[]; limit?: number }) {
  const now = Date.now();
  const upcoming = items
    .filter((i) => {
      const t = itemTime(i);
      const e = itemEnd(i);
      return t && ((e ? e.getTime() : t.getTime()) >= now);
    })
    .sort(sortItems)
    .slice(0, limit);
  if (!upcoming.length) return <p className="p-3 text-sm text-muted-foreground">Nothing coming up.</p>;
  return (
    <ul className="space-y-0.5 p-1.5">
      {upcoming.map((i) => {
        const t = itemTime(i)!;
        return (
          <li key={i.id} className="flex items-baseline gap-2 rounded px-1 py-0.5 text-sm">
            <span className="w-16 shrink-0 text-xs text-muted-foreground">{isToday(t) ? format(t, 'h:mm a') : format(t, 'EEE h:mm a')}</span>
            <CourseDot color={itemColor(i)} />
            <a href={i.url ?? '#'} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:underline">{i.title}</a>
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
    <div className="h-full overflow-auto px-1.5 py-1">
      {dayList.map((d) => {
        const list = grouped.get(dayKey(d)) ?? [];
        return (
          <section key={dayKey(d)} className="mb-2">
            <h4 className={cn('sticky top-0 z-10 bg-card px-1.5 py-1 text-[11px] font-medium uppercase tracking-wide', isToday(d) ? 'text-primary' : 'text-muted-foreground')}>
              {isToday(d) ? 'Today' : format(d, 'EEEE')} <span className="font-normal">{format(d, 'MMM d')}</span>
            </h4>
            {list.length ? list.map((i) => <Row key={i.id} item={i} />) : <p className="px-1.5 py-0.5 text-xs text-muted-foreground/70">—</p>}
          </section>
        );
      })}
    </div>
  );
}

/* ---------- md/wide: 7-day strip ---------- */
export function WeekStrip({ items, from }: { items: EffectiveItem[]; from: Date }) {
  const dayList = daysBetween(from, addDays(from, 6));
  const grouped = groupByDay(items, dayList);
  return (
    <div className="grid h-full grid-cols-7 divide-x overflow-hidden">
      {dayList.map((d) => (
        <div key={dayKey(d)} className="flex min-w-0 flex-col overflow-hidden">
          <div className={cn('shrink-0 border-b px-1.5 py-1 text-[11px]', isToday(d) ? 'font-semibold text-primary' : 'text-muted-foreground')}>
            {format(d, 'EEE')} <span className="tabular-nums">{format(d, 'd')}</span>
          </div>
          <div className="min-h-0 flex-1 space-y-0.5 overflow-auto p-1">
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
const PX_PER_HOUR = 44;

export function WeekGrid({ items, from }: { items: EffectiveItem[]; from: Date }) {
  const dayList = daysBetween(from, addDays(from, 6));
  const grouped = groupByDay(items, dayList);
  const hours = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i);
  const now = new Date();
  const nowTop = ((getHours(now) + getMinutes(now) / 60 - HOUR_START) / (HOUR_END - HOUR_START + 1)) * 100;
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="grid shrink-0 grid-cols-[3rem_repeat(7,minmax(0,1fr))] border-b">
        <div />
        {dayList.map((d) => {
          const allDay = (grouped.get(dayKey(d)) ?? []).filter((i) => i.allDay || i.kind !== 'event');
          return (
            <div key={dayKey(d)} className="min-w-0 border-l px-1 py-1">
              <div className={cn('text-[11px]', isToday(d) ? 'font-semibold text-primary' : 'text-muted-foreground')}>
                {format(d, 'EEE')} <span className="tabular-nums">{format(d, 'd')}</span>
              </div>
              <div className="mt-0.5 max-h-16 space-y-0.5 overflow-auto">
                {allDay.map((i) => <Chip key={i.id} item={i} dense />)}
              </div>
            </div>
          );
        })}
      </div>
      <div className="relative min-h-0 flex-1 overflow-auto">
        <div className="grid grid-cols-[3rem_repeat(7,minmax(0,1fr))]" style={{ height: hours.length * PX_PER_HOUR }}>
          <div className="relative">
            {hours.map((h) => (
              <div key={h} className="absolute right-1 -translate-y-1/2 text-[10px] tabular-nums text-muted-foreground" style={{ top: (h - HOUR_START) * PX_PER_HOUR }}>
                {h === 12 ? '12 pm' : h > 12 ? `${h - 12} pm` : `${h} am`}
              </div>
            ))}
          </div>
          {dayList.map((d) => {
            const timed = (grouped.get(dayKey(d)) ?? []).filter((i) => !i.allDay && i.kind === 'event');
            return (
              <div key={dayKey(d)} className={cn('relative border-l', isToday(d) && 'bg-primary/[0.03]')}>
                {hours.map((h) => (
                  <div key={h} className="absolute inset-x-0 border-t border-border/60" style={{ top: (h - HOUR_START) * PX_PER_HOUR }} />
                ))}
                {isToday(d) && nowTop >= 0 && nowTop <= 100 && <div className="absolute inset-x-0 z-10 border-t-2 border-red-500/70" style={{ top: `${nowTop}%` }} />}
                {timed.map((i) => {
                  const s = itemTime(i)!;
                  const e = itemEnd(i) ?? new Date(s.getTime() + 30 * 60_000);
                  const top = ((getHours(s) + getMinutes(s) / 60 - HOUR_START) * PX_PER_HOUR);
                  const height = Math.max(18, (differenceInMinutes(e, s) / 60) * PX_PER_HOUR - 2);
                  const color = itemColor(i);
                  return (
                    <a
                      key={i.id}
                      href={i.url ?? '#'}
                      target="_blank"
                      rel="noreferrer"
                      className="absolute inset-x-0.5 overflow-hidden rounded border px-1 py-0.5 text-[11px] leading-tight hover:brightness-110"
                      style={{ top, height, background: `color-mix(in oklch, ${color ?? 'var(--primary)'} 18%, var(--card))`, borderColor: `color-mix(in oklch, ${color ?? 'var(--primary)'} 40%, transparent)` }}
                      title={`${i.title} · ${timeLabel(i)}`}
                    >
                      <div className="truncate font-medium">{i.title}</div>
                      {height > 30 && <div className="truncate text-muted-foreground">{timeLabel(i)}</div>}
                    </a>
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
    <div className="flex h-full flex-col overflow-hidden">
      <div className="grid shrink-0 grid-cols-7 border-b text-[11px] text-muted-foreground">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="px-1.5 py-1">{d}</div>)}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7" style={{ gridTemplateRows: `repeat(${weeks}, minmax(0, 1fr))` }}>
        {dayList.map((d) => {
          const list = grouped.get(dayKey(d)) ?? [];
          const inMonth = isSameMonth(d, anchor);
          return (
            <div key={dayKey(d)} className={cn('flex min-h-0 flex-col overflow-hidden border-b border-r p-0.5', !inMonth && 'bg-muted/30')}>
              <div className={cn('px-1 text-[11px] tabular-nums', isToday(d) ? 'font-semibold text-primary' : inMonth ? 'text-foreground' : 'text-muted-foreground/60')}>{format(d, 'd')}</div>
              <div className="min-h-0 flex-1 space-y-px overflow-hidden">
                {list.slice(0, 4).map((i) => <Chip key={i.id} item={i} dense />)}
                {list.length > 4 && <div className="px-1 text-[10px] text-muted-foreground">+{list.length - 4} more</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
