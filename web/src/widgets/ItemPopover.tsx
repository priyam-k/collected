import { useState, type ReactNode } from 'react';
import { format } from 'date-fns';
import { Check, ExternalLink, MapPin } from 'lucide-react';
import { toast } from 'sonner';
import { COURSE_EVENT_LABELS, SOURCE_LABELS, isTodoApp, type EffectiveItem, type ManualEventRaw } from '@collected/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useCloseTask, useSetOverride } from '@/lib/queries';
import { usePane } from '@/panes/PaneContext';
import { friendlyDate } from '@/lib/time';
import { safeColor } from '@/lib/color';
import { safeHref } from '@/lib/url';
import { cn } from '@/lib/utils';

/** Canvas descriptions are HTML: text with paragraph breaks kept and the common entities decoded. */
export function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => (Number(n) <= 0x10ffff ? String.fromCodePoint(Number(n)) : ''))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function linkify(text: string): ReactNode[] {
  const parts = text.split(/(https?:\/\/[^\s)]+)/g);
  return parts.map((p, i) => {
    const href = safeHref(p);
    return href ? (
      <a key={i} href={href} target="_blank" rel="noreferrer" className="break-all underline underline-offset-2">
        {p}
      </a>
    ) : (
      <span key={i}>{p}</span>
    );
  });
}

function when(item: EffectiveItem): string {
  if (item.kind === 'event') {
    if (!item.startsAt) return '';
    const s = new Date(item.startsAt);
    if (item.allDay) {
      const e = item.endsAt ? new Date(new Date(item.endsAt).getTime() - 1) : s;
      return e.toDateString() === s.toDateString() ? `${format(s, 'EEE MMM d')} · all day` : `${format(s, 'EEE MMM d')} – ${format(e, 'EEE MMM d')}`;
    }
    const e = item.endsAt ? new Date(item.endsAt) : null;
    return e ? `${format(s, 'EEE MMM d, h:mm a')} – ${format(e, e.toDateString() === s.toDateString() ? 'h:mm a' : 'EEE MMM d, h:mm a')}` : format(s, 'EEE MMM d, h:mm a');
  }
  if (item.dueAt) return `Due ${friendlyDate(item.dueAt, { withTime: true, allDay: item.allDay })}`;
  if (item.startsAt) return friendlyDate(item.startsAt, { withTime: true });
  return 'No date';
}

export function ItemDetails({ item, onClose }: { item: EffectiveItem; onClose?: () => void }) {
  const setOverride = useSetOverride();
  const closeTask = useCloseTask();
  const pane = usePane();
  const raw = item.raw as { location?: string | null; calendarName?: string | null; projectName?: string | null; sectionName?: string | null; statusText?: string | null; parentId?: string | null };
  const manual = item.source === 'manual' ? (item.raw as unknown as ManualEventRaw) : null;
  const desc = item.description ? stripHtml(item.description) : '';
  const canComplete = !item.effectiveDone && !item.informational && (item.kind === 'assignment' || item.kind === 'task');
  // mutateAsync, not mutate(…, { onSuccess }): marking done refetches the list, which can unmount this row before the
  // mutation settles, and React Query drops per-call callbacks of an unmounted caller (the toast then never showed).
  const complete = () => {
    const run = isTodoApp(item.source) ? closeTask.mutateAsync({ source: item.source, externalId: item.externalId }) : setOverride.mutateAsync({ id: item.id, done: true });
    run.then(
      () => {
        toast.success('Marked done');
        onClose?.();
      },
      (e: Error) => toast.error(e.message),
    );
  };
  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-start gap-2">
        {safeColor(item.course?.color) && <span className="mt-1.5 inline-block size-2.5 shrink-0 rounded-full" style={{ background: safeColor(item.course?.color) }} />}
        <div className="min-w-0 flex-1">
          <div className={cn('font-medium leading-snug', item.effectiveDone && 'line-through opacity-70')}>{item.title}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            <span className="capitalize">{manual ? COURSE_EVENT_LABELS[manual.eventKind] : item.kind}</span>
            {item.course && (
              <button className="hover:text-foreground hover:underline" title="Open the course" onClick={() => { onClose?.(); pane.open({ kind: 'course', courseId: item.course!.id }); }}>
                · {item.course.code}
              </button>
            )}
            {raw.calendarName && <span>· {raw.calendarName}</span>}
            {raw.projectName && <span>· #{raw.projectName}{raw.sectionName ? ` / ${raw.sectionName}` : ''}</span>}
          </div>
        </div>
        <Badge variant="outline" className="shrink-0 text-[10px]">{SOURCE_LABELS[item.source]}</Badge>
      </div>
      <div className="text-xs">
        <div>{when(item)}</div>
        {raw.location && (
          <div className="mt-0.5 flex items-center gap-1 text-muted-foreground">
            <MapPin className="size-3" /> {raw.location}
          </div>
        )}
        <div className="mt-0.5 flex flex-wrap gap-1 text-muted-foreground">
          {item.status !== 'open' && <span className="rounded bg-secondary px-1">{item.status}</span>}
          {item.effectiveDone && item.status === 'open' && <span className="rounded bg-secondary px-1">done</span>}
          {item.points != null && <span className="rounded bg-secondary px-1">{item.score != null ? `${item.score} / ` : ''}{item.points} pts</span>}
          {item.labels.map((l) => <span key={l} className="rounded bg-secondary px-1">@{l}</span>)}
          {item.linkedIds.length > 0 && <span className="rounded bg-secondary px-1" title={item.linkedIds.join(', ')}>linked</span>}
        </div>
      </div>
      {desc && <p className="max-h-40 overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">{linkify(desc.slice(0, 1500))}{desc.length > 1500 ? '…' : ''}</p>}
      <div className="flex items-center gap-2 pt-1">
        {safeHref(item.url) && (
          <Button asChild size="sm" variant="secondary">
            <a href={safeHref(item.url)} target="_blank" rel="noreferrer">
              Open in {SOURCE_LABELS[item.source].replace(' (iCal fallback)', '')} <ExternalLink className="size-3.5" />
            </a>
          </Button>
        )}
        {canComplete && (
          <Button size="sm" variant="ghost" onClick={complete} title={isTodoApp(item.source) ? `Complete in ${SOURCE_LABELS[item.source]}` : 'Mark done here only; the source is never changed'}>
            <Check className="size-3.5" /> Done
          </Button>
        )}
        {manual && item.courseId && (
          <Button size="sm" variant="ghost" onClick={() => { onClose?.(); pane.open({ kind: 'course', courseId: item.courseId!, tab: 'dates' }); }} title="Edit in the course's dates">
            Edit
          </Button>
        )}
      </div>
    </div>
  );
}

/** Wraps any element: click opens the item's details beside it instead of jumping to the source. */
export function ItemPopover({ item, children, className, side = 'bottom', align = 'start' }: { item: EffectiveItem; children: ReactNode; className?: string; side?: 'top' | 'bottom' | 'left' | 'right'; align?: 'start' | 'center' | 'end' }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={cn('block w-full min-w-0 text-left', className)} onMouseDown={(e) => e.stopPropagation()}>
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent side={side} align={align} className="w-80" onOpenAutoFocus={(e) => e.preventDefault()}>
        <ItemDetails item={item} onClose={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
