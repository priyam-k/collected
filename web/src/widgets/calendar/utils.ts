import { addDays, endOfDay, endOfMonth, endOfWeek, format, isSameDay, startOfDay, startOfMonth, startOfWeek } from 'date-fns';
import type { EffectiveItem } from '@collected/shared';

export type CalView = 'next' | 'agenda' | 'strip' | 'week' | 'month';

/** The instant an item occupies on a calendar: events use start, everything else its due date. */
export function itemTime(item: EffectiveItem): Date | null {
  const s = item.kind === 'event' ? item.startsAt : (item.dueAt ?? item.startsAt);
  return s ? new Date(s) : null;
}

export function itemEnd(item: EffectiveItem): Date | null {
  if (item.kind !== 'event') return null;
  return item.endsAt ? new Date(item.endsAt) : null;
}

export function itemColor(item: EffectiveItem): string | null {
  if (item.course?.color) return item.course.color;
  const raw = item.raw as { color?: string | null };
  return raw.color ?? null;
}

export function rangeFor(view: CalView, anchor: Date): { from: Date; to: Date } {
  switch (view) {
    case 'next':
      return { from: startOfDay(anchor), to: addDays(anchor, 14) };
    case 'agenda':
      return { from: startOfDay(anchor), to: endOfDay(addDays(anchor, 6)) };
    case 'strip':
      return { from: startOfDay(anchor), to: endOfDay(addDays(anchor, 6)) };
    case 'week':
      return { from: startOfWeek(anchor, { weekStartsOn: 0 }), to: endOfWeek(anchor, { weekStartsOn: 0 }) };
    case 'month': {
      const s = startOfWeek(startOfMonth(anchor), { weekStartsOn: 0 });
      const e = endOfWeek(endOfMonth(anchor), { weekStartsOn: 0 });
      return { from: s, to: e };
    }
  }
}

export function daysBetween(from: Date, to: Date): Date[] {
  const out: Date[] = [];
  for (let d = startOfDay(from); d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function groupByDay(items: EffectiveItem[], days: Date[]): Map<string, EffectiveItem[]> {
  const m = new Map<string, EffectiveItem[]>(days.map((d) => [dayKey(d), []]));
  for (const it of items) {
    const t = itemTime(it);
    if (!t) continue;
    // multi-day all-day events span every day they cover
    if (it.kind === 'event' && it.allDay && it.endsAt) {
      const end = new Date(it.endsAt);
      for (let d = startOfDay(t); d < end; d = addDays(d, 1)) m.get(dayKey(d))?.push(it);
      continue;
    }
    m.get(dayKey(t))?.push(it);
  }
  for (const list of m.values()) list.sort(sortItems);
  return m;
}

export function sortItems(a: EffectiveItem, b: EffectiveItem): number {
  const aa = a.allDay ? -1 : (itemTime(a)?.getTime() ?? 0);
  const bb = b.allDay ? -1 : (itemTime(b)?.getTime() ?? 0);
  return aa - bb;
}

export const dayKey = (d: Date): string => format(d, 'yyyy-MM-dd');
export const isToday = (d: Date): boolean => isSameDay(d, new Date());

export function timeLabel(item: EffectiveItem): string {
  const t = itemTime(item);
  if (!t) return '';
  if (item.allDay) return 'all day';
  if (item.kind !== 'event') return `due ${format(t, 'h:mm a')}`;
  const e = itemEnd(item);
  return e ? `${format(t, 'h:mm')}–${format(e, 'h:mm a')}` : format(t, 'h:mm a');
}

/** Pick the view from the widget box unless the user pinned one. */
export function autoView(width: number, height: number): CalView {
  if (width < 300 && height < 260) return 'next';
  if (width < 520) return 'agenda';
  if (height < 300) return 'strip';
  if (width < 820) return height > 620 ? 'month' : 'strip';
  return height > 640 ? 'month' : 'week';
}
