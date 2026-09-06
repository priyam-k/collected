import { format, formatDistanceToNowStrict, isToday, isTomorrow, isYesterday, isThisYear } from 'date-fns';

export function relative(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'never';
  return formatDistanceToNowStrict(d, { addSuffix: true });
}

/** "Today 3:00 PM", "Tomorrow", "Fri Sep 12", "Sep 12, 2027" */
export function friendlyDate(iso: string | null | undefined, opts: { withTime?: boolean; allDay?: boolean } = {}): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const time = opts.withTime && !opts.allDay ? ` ${format(d, 'h:mm a')}` : '';
  if (isToday(d)) return `Today${time}`;
  if (isTomorrow(d)) return `Tomorrow${time}`;
  if (isYesterday(d)) return `Yesterday${time}`;
  return `${format(d, isThisYear(d) ? 'EEE MMM d' : 'MMM d, yyyy')}${time}`;
}

export function timeOnly(iso: string): string {
  return format(new Date(iso), 'h:mm a');
}

export function isPast(iso: string | null | undefined): boolean {
  return !!iso && new Date(iso).getTime() < Date.now();
}
