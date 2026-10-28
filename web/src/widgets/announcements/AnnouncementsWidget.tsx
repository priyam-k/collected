import { useCallback, useEffect, useMemo, useState } from 'react';
import { WidgetHeader } from '@/dashboard/WidgetHeader';
import { useItems } from '@/lib/queries';
import { friendlyDate } from '@/lib/time';
import { cn } from '@/lib/utils';
import { safeColor } from '@/lib/color';
import { ItemPopover } from '@/widgets/ItemPopover';
import { EmptyState, ErrorState } from '@/widgets/Placeholder';
import type { WidgetProps } from '@/widgets/types';

const KEY = 'collected.announcements.read';

/** Read state lives in this browser only: there's no read flag in Canvas's announcements API worth syncing. */
function useReadSet(): [Set<string>, (ids: string[]) => void] {
  const [read, setRead] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[]);
    } catch {
      return new Set();
    }
  });
  const mark = useCallback((ids: string[]) => {
    setRead((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify([...read].slice(-500)));
    } catch {
      /* ignore */
    }
  }, [read]);
  return [read, mark];
}

/** Every course's announcements, newest first, unread ones marked. Reading one (opening it) clears the mark. */
export function AnnouncementsWidget({ size }: WidgetProps) {
  const q = useItems({ kind: ['announcement'], limit: 100 });
  const [read, mark] = useReadSet();
  const rows = useMemo(() => (q.data ?? []).slice().sort((a, b) => (b.startsAt ?? '').localeCompare(a.startsAt ?? '')), [q.data]);
  const unread = rows.filter((r) => !read.has(r.id)).length;

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const xs = size.tier === 'xs';

  return (
    <div className="flex h-full flex-col">
      <WidgetHeader>
        {unread > 0 ? (
          <>
            <span className="flex h-7 items-center gap-1.5 rounded-full px-[11px] text-[12.5px] font-semibold text-brand-ink" style={{ background: 'color-mix(in oklab, var(--brand) 18%, var(--card))' }}>
              <span className="size-1.5 rounded-full bg-brand" />{unread} new
            </span>
            {!xs && <button className="text-xs text-ter hover:text-ink" onClick={() => mark(rows.map((r) => r.id))}>Mark all read</button>}
          </>
        ) : (
          rows.length > 0 && <span className="text-[12.5px] text-sub">all read</span>
        )}
      </WidgetHeader>
      {q.isPending ? (
        <div className="m-3 h-16 animate-pulse rounded-xl bg-well" />
      ) : !rows.length ? (
        <EmptyState>No announcements in the last month.</EmptyState>
      ) : (
        <ul className="min-h-0 flex-1 overflow-auto p-1.5">
          {rows.map((a) => {
            const isNew = !read.has(a.id);
            const color = safeColor(a.course?.color) ?? 'var(--ter)';
            return (
              <li key={a.id} onClickCapture={() => isNew && mark([a.id])}>
                <ItemPopover item={a}>
                  <span className="flex items-start gap-2.5 rounded-xl px-2.5 py-2 transition-colors hover:bg-well">
                    <span className={cn('mt-[7px] size-1.5 shrink-0 rounded-full', !isNew && 'opacity-0')} style={{ background: 'var(--brand)' }} />
                    <span className="min-w-0 flex-1">
                      <span className={cn('block truncate text-[13.5px] leading-[1.35]', isNew ? 'font-semibold text-ink' : 'font-medium text-sub')}>{a.title}</span>
                      <span className="mt-0.5 flex items-center gap-2 text-[11.5px]">
                        {a.course && <span className="font-medium" style={{ color }}>{a.course.code}</span>}
                        <span className="text-ter">{friendlyDate(a.startsAt)}</span>
                        {!xs && a.description && <span className="min-w-0 flex-1 truncate text-ter">{a.description.replace(/\s+/g, ' ').slice(0, 120)}</span>}
                      </span>
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
