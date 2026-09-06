import { ExternalLink } from 'lucide-react';
import type { CourseLink, CourseSchedule, EffectiveItem, ItemStatus, Meeting } from '@collected/shared';
import { Badge } from '@/components/ui/badge';
import { friendlyDate, isPast } from '@/lib/time';
import { cn } from '@/lib/utils';

export function CourseDot({ color, className, title }: { color: string | null | undefined; className?: string; title?: string }) {
  return <span className={cn('inline-block size-2 shrink-0 rounded-full', className)} style={{ background: color ?? 'var(--muted-foreground)' }} title={title} />;
}

export function HotLinks({ links, compact }: { links: CourseLink[]; compact?: boolean }) {
  if (!links.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {links.map((l) => (
        <a
          key={l.url + l.label}
          href={l.url}
          target="_blank"
          rel="noreferrer"
          className={cn('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground', compact && 'px-1')}
        >
          {l.label}
          {!compact && <ExternalLink className="size-3" />}
        </a>
      ))}
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

/** The next occurrence of any meeting in the schedule, relative to now. */
export function nextMeeting(schedule: CourseSchedule): { label: string; kind: string; when: Date } | null {
  const now = new Date();
  let best: { label: string; kind: string; when: Date } | null = null;
  for (const [kind, list] of Object.entries(schedule) as [string, Meeting[] | undefined][]) {
    for (const m of list ?? []) {
      const [h, min] = m.end.split(':').map(Number);
      for (let add = 0; add < 8; add++) {
        const d = new Date(now);
        d.setDate(now.getDate() + add);
        if (d.getDay() !== DAY_INDEX[m.day]) continue;
        d.setHours(h ?? 0, min ?? 0, 0, 0);
        if (d < now) continue;
        const [sh, sm] = m.start.split(':').map(Number);
        const start = new Date(d);
        start.setHours(sh ?? 0, sm ?? 0, 0, 0);
        if (!best || start < best.when) best = { kind, when: start, label: `${DAY_LABEL[m.day]} ${fmtTime(m.start)}–${fmtTime(m.end)}${m.location ? ` · ${m.location}` : ''}` };
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
  if (item.dueAt && isPast(item.dueAt)) return <Badge variant="outline" className="h-5 px-1.5 text-[10px] text-amber-600 dark:text-amber-400">overdue</Badge>;
  return null;
}

export function DueLabel({ item, className }: { item: EffectiveItem; className?: string }) {
  const when = item.dueAt ?? item.startsAt;
  if (!when) return <span className={cn('text-muted-foreground', className)}>no date</span>;
  const past = isPast(when) && !item.effectiveDone;
  return <span className={cn(past ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground', className)}>{friendlyDate(when, { withTime: true, allDay: item.allDay })}</span>;
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
  const cls = 'flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-accent/60';
  return item.url ? (
    <a href={item.url} target="_blank" rel="noreferrer" className={cls}>
      {inner}
    </a>
  ) : (
    <div className={cls}>{inner}</div>
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
