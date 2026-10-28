import { format } from 'date-fns';
import { ExternalLink } from 'lucide-react';
import type { CourseEventKind, CourseLink, CourseSchedule, EffectiveItem, ItemStatus, ManualEventRaw, Meeting, MeetingKind } from '@collected/shared';
import { Badge } from '@/components/ui/badge';
import { friendlyDate, isPast } from '@/lib/time';
import { safeColor } from '@/lib/color';
import { safeHref } from '@/lib/url';
import { cn } from '@/lib/utils';
import { ItemPopover } from '@/widgets/ItemPopover';

/**
 * For controls that only appear on hover (a row's download or sync button): also shown while focused from the
 * keyboard and always on touch screens, where there is no hover. Pair with `group-hover/x:opacity-100` and
 * `group-focus-within/x:opacity-100` on the caller's named group.
 */
export const HOVER_REVEAL = 'opacity-0 focus-visible:opacity-100 [@media(hover:none)]:opacity-100';

/** For a div with role="button" (a card): Enter or Space on the card itself activates it; keys pressed on a control inside the card are that control's. */
export function activateOnKey(e: React.KeyboardEvent, run: () => void) {
  if (e.target !== e.currentTarget) return;
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  run();
}

export function CourseDot({ color, className, title }: { color: string | null | undefined; className?: string; title?: string }) {
  return <span className={cn('inline-block size-2 shrink-0 rounded-full', className)} style={{ background: safeColor(color) ?? 'var(--muted-foreground)' }} title={title} />;
}

export function HotLinks({ links, compact }: { links: CourseLink[]; compact?: boolean }) {
  if (!links.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {links.map((l) => {
        const href = safeHref(l.url);
        const className = cn('inline-flex h-7 items-center gap-1 rounded-full bg-well px-3 text-[12px] font-medium text-ink transition-colors hover:bg-well2', compact && 'h-6 px-2.5 text-[11.5px]', !href && 'opacity-50');
        const inner = (
          <>
            {l.label}
            {!compact && <ExternalLink className="size-3" />}
          </>
        );
        return href ? (
          <a key={l.url + l.label} href={href} target="_blank" rel="noreferrer" className={className}>
            {inner}
          </a>
        ) : (
          <span key={l.url + l.label} className={className} title="Link is not http(s)">
            {inner}
          </span>
        );
      })}
    </div>
  );
}

const DAY_INDEX: Record<Meeting['day'], number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const DAY_LABEL: Record<Meeting['day'], string> = { sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat' };

function fmtTime(t: string): string {
  const [h, m] = t.split(':').map(Number);
  const d = new Date();
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: m ? '2-digit' : undefined });
}

/** A cancelled or virtual session: a manual event on a day, optionally pinned to one meeting kind. */
export interface MeetingException {
  date: string; // YYYY-MM-DD
  meetingKind: MeetingKind | null;
  eventKind: CourseEventKind;
}

export const manualRaw = (it: EffectiveItem): ManualEventRaw | null => (it.source === 'manual' ? (it.raw as unknown as ManualEventRaw) : null);

export function meetingExceptions(items: EffectiveItem[]): MeetingException[] {
  const out: MeetingException[] = [];
  for (const it of items) {
    const raw = manualRaw(it);
    if (raw && (raw.eventKind === 'cancelled' || raw.eventKind === 'virtual')) out.push({ date: raw.date, meetingKind: raw.meetingKind, eventKind: raw.eventKind });
  }
  return out;
}

export interface NextMeeting {
  label: string;
  kind: string;
  when: Date;
  /** The session is happening online (a "virtual class" event covers it). */
  virtual: boolean;
}

/**
 * The next occurrence of any meeting in the schedule that hasn't ended, skipping cancelled sessions. A session in
 * progress counts (its `when` is then in the past). Pass `now` from useNow so a caller's memo recomputes as time moves.
 */
export function nextMeeting(schedule: CourseSchedule, exceptions: MeetingException[] = [], now: Date = new Date()): NextMeeting | null {
  let best: NextMeeting | null = null;
  const covers = (x: MeetingException, kind: string, d: Date) => x.date === format(d, 'yyyy-MM-dd') && (x.meetingKind === null || x.meetingKind === kind);
  for (const [kind, list] of Object.entries(schedule) as [string, Meeting[] | undefined][]) {
    for (const m of list ?? []) {
      const [h, min] = m.end.split(':').map(Number);
      for (let add = 0; add < 15; add++) {
        const d = new Date(now);
        d.setDate(now.getDate() + add);
        if (d.getDay() !== DAY_INDEX[m.day]) continue;
        d.setHours(h ?? 0, min ?? 0, 0, 0);
        if (d < now) continue;
        if (exceptions.some((x) => x.eventKind === 'cancelled' && covers(x, kind, d))) continue;
        const virtual = exceptions.some((x) => x.eventKind === 'virtual' && covers(x, kind, d));
        const [sh, sm] = m.start.split(':').map(Number);
        const start = new Date(d);
        start.setHours(sh ?? 0, sm ?? 0, 0, 0);
        if (!best || start < best.when) best = { kind, when: start, virtual, label: `${DAY_LABEL[m.day]} ${fmtTime(m.start)}–${fmtTime(m.end)}${virtual ? ' · online' : m.location ? ` · ${m.location}` : ''}` };
        break;
      }
    }
  }
  return best;
}

const STATUS_LABEL: Partial<Record<ItemStatus, string>> = { missing: 'missing', late: 'late', submitted: 'submitted', graded: 'graded', done: 'done' };

export function StatusBadge({ item }: { item: EffectiveItem }) {
  if (item.effectiveDone) return <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">{STATUS_LABEL[item.status] ?? 'done'}</Badge>;
  if (item.status === 'missing') return <Badge variant="destructive" className="h-5 px-1.5 text-[10px]">missing</Badge>;
  if (item.dueAt && isPast(item.dueAt)) return <Badge variant="outline" className="h-5 border-critical/40 px-1.5 text-[10px] text-critical">overdue</Badge>;
  return null;
}

export function DueLabel({ item, className }: { item: EffectiveItem; className?: string }) {
  const when = item.dueAt ?? item.startsAt;
  if (!when) return <span className={cn('text-muted-foreground', className)}>no date</span>;
  const past = isPast(when) && !item.effectiveDone;
  return <span className={cn(past ? 'font-medium text-critical' : 'text-muted-foreground', className)}>{friendlyDate(when, { withTime: true, allDay: item.allDay })}</span>;
}

export function ItemRow({ item, showCourse }: { item: EffectiveItem; showCourse?: boolean }) {
  const inner = (
    <>
      {showCourse && item.course && <CourseDot color={item.course.color} title={item.course.code} />}
      <span className="min-w-0 flex-1 truncate">{item.title}</span>
      <StatusBadge item={item} />
      <DueLabel item={item} className="shrink-0 text-xs" />
    </>
  );
  return (
    <ItemPopover item={item}>
      <span className="flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm transition-colors hover:bg-well">{inner}</span>
    </ItemPopover>
  );
}

export function windowFromNow(days: number): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now);
  from.setDate(now.getDate() - 1);
  const to = new Date(now);
  to.setDate(now.getDate() + days);
  return { from: from.toISOString(), to: to.toISOString() };
}
