import { addDays, endOfDay, endOfMonth, endOfWeek, format, isSameDay, startOfDay, startOfMonth, startOfWeek } from 'date-fns';
import type { EffectiveItem } from '@collected/shared';
import { safeColor } from '@/lib/color';

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
  const raw = item.raw as { color?: string | null };
  return safeColor(item.course?.color) ?? safeColor(raw.color) ?? null;
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

/* ---------- week grid layout ---------- */
/** The grid covers the whole day, midnight to midnight; it scrolls inside the widget at this many px per hour. */
export const GRID_MINUTES = 24 * 60;
export const PX_PER_HOUR = 52;
/** Where the grid opens on a week without today in it. */
export const SCROLL_TO_HOUR = 7;
export const MIN_EVENT_PX = 22;

export interface Placed {
  item: EffectiveItem;
  start: Date;
  end: Date;
  /** Minutes after midnight, clamped to the day. */
  top: number;
  bottom: number;
  col: number;
  cols: number;
}

/**
 * Lays out one day's timed events: each is clamped to its start's day (an event running past midnight stops at
 * the bottom of the grid), then events that overlap, counting the minimum drawn height, are clustered and dealt into
 * side-by-side columns; every event in a cluster is 1/columns wide.
 */
export function placeDay(timed: EffectiveItem[]): Placed[] {
  const gridMin = GRID_MINUTES;
  const minDur = (MIN_EVENT_PX / PX_PER_HOUR) * 60;
  const minuteOf = (d: Date, day: Date) => (d.getTime() - day.getTime()) / 60_000;
  const placed: Placed[] = timed.map((item) => {
    const start = itemTime(item)!;
    const end = itemEnd(item) ?? new Date(start.getTime() + 30 * 60_000);
    const day = new Date(start);
    day.setHours(0, 0, 0, 0);
    let top = Math.max(0, minuteOf(start, day));
    let bottom = Math.min(gridMin, minuteOf(end, day));
    if (bottom - top < minDur) {
      // too short to draw: give it the minimum height, kept inside the grid (one starting at 11:55 PM moves up)
      top = Math.min(top, gridMin - minDur);
      bottom = top + minDur;
    }
    return { item, start, end, top, bottom, col: 0, cols: 1 };
  });
  placed.sort((a, b) => a.top - b.top || b.bottom - a.bottom);
  let cluster: Placed[] = [];
  let colEnds: number[] = [];
  let clusterEnd = -Infinity;
  const close = () => {
    for (const p of cluster) p.cols = colEnds.length;
    cluster = [];
    colEnds = [];
  };
  for (const p of placed) {
    if (p.top >= clusterEnd) close();
    let col = colEnds.findIndex((end) => end <= p.top);
    if (col === -1) col = colEnds.push(p.bottom) - 1;
    else colEnds[col] = p.bottom;
    p.col = col;
    cluster.push(p);
    clusterEnd = Math.max(clusterEnd, p.bottom);
  }
  close();
  return placed;
}
