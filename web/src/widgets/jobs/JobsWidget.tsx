import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router';
import { Check, ExternalLink, Star, X } from 'lucide-react';
import { toast } from 'sonner';
import { JOB_STATE_LABELS, type Job } from '@collected/shared';
import { WidgetHeader } from '@/dashboard/WidgetHeader';
import { useLiquid } from '@/lib/liquid';
import { useJobStats, useJobs, useMarkJobsSeen, usePatchJobState } from '@/lib/queries';
import { friendlyDate } from '@/lib/time';
import { cn } from '@/lib/utils';
import { safeHref } from '@/lib/url';
import { usePane } from '@/panes/PaneContext';
import { EmptyState, ErrorState } from '@/widgets/Placeholder';
import { HOVER_REVEAL, activateOnKey, useScrollEdges } from '@/widgets/shared';
import type { WidgetProps } from '@/widgets/types';

type Mode = 'new' | 'starred' | 'matches';
const PAGE = 12;

const shortCategory = (c: string | null) => (c ?? '').replace('AI/ML/Data', 'AI / ML').replace('Software', 'Software');

/**
 * Marks cards seen once they've been at least 60% on screen, batched every two seconds. One observer lives for the
 * component's lifetime; `jobs` and `mutate` are read through refs so new data doesn't rebuild it. The ref callback is
 * stable and returns its own cleanup (React 19), and cards that mount before the observer exists (child refs attach
 * before the parent's effect runs) are kept in a set and observed when it's created.
 */
function useMarkSeenWhenVisible(jobs: Job[]) {
  const { mutate } = useMarkJobsSeen();
  const jobsRef = useRef(jobs);
  const mutateRef = useRef(mutate);
  useLayoutEffect(() => {
    jobsRef.current = jobs;
    mutateRef.current = mutate;
  });
  const elements = useRef(new Set<HTMLElement>());
  const observer = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    const pending = new Set<string>();
    let timer: number | null = null;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.jobId;
          if (!id || !e.isIntersecting) continue;
          const job = jobsRef.current.find((j) => j.id === id);
          if (job && !job.seenAt) pending.add(id);
        }
        if (pending.size && timer === null) {
          timer = window.setTimeout(() => {
            timer = null;
            const ids = [...pending];
            pending.clear();
            if (ids.length) mutateRef.current(ids);
          }, 2000);
        }
      },
      { threshold: 0.6 },
    );
    observer.current = obs;
    for (const el of elements.current) obs.observe(el);
    return () => {
      obs.disconnect();
      observer.current = null;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);

  return useCallback((el: HTMLElement | null) => {
    if (!el) return;
    elements.current.add(el);
    observer.current?.observe(el);
    return () => {
      elements.current.delete(el);
      observer.current?.unobserve(el);
    };
  }, []);
}

function Orb({ on, tone, label, onClick, children }: { on?: boolean; tone: string; label: string; onClick(): void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={cn('orb size-7 text-xs transition-colors hover:text-[var(--tone)] focus-visible:text-[var(--tone)]', on && 'text-[var(--tone)]')}
      style={{ '--tone': tone } as CSSProperties}
    >
      {children}
    </button>
  );
}

function Card({ job, onState, tape, compact, tall, refCb }: { job: Job; onState: (s: Job['state']) => void; tape?: boolean; compact?: boolean; tall?: boolean; refCb: (el: HTMLElement | null) => void | (() => void) }) {
  const { open } = usePane();
  const tracked = job.state !== 'new' && job.state !== 'starred' && job.state !== 'hidden';
  return (
    <div
      ref={refCb}
      data-job-id={job.id}
      role="button"
      tabIndex={0}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={() => open({ kind: 'job', jobId: job.id })}
      onKeyDown={(e) => activateOnKey(e, () => open({ kind: 'job', jobId: job.id }))}
      className={cn('group/card relative flex min-w-0 cursor-pointer flex-col gap-[5px] rounded-[16px] bg-well p-3 text-left transition-colors hover:bg-well2', tape ? 'w-[236px] shrink-0' : 'w-full', job.state === 'starred' && 'bg-[color-mix(in_srgb,var(--caution)_8%,var(--well))]')}
      title="Details and tracking"
    >
      <div className="flex items-center gap-2">
        {!job.seenAt && <span className="size-1.5 shrink-0 rounded-full bg-brand" title="New" />}
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{job.company}</span>
        {safeHref(job.url) && (
          <a href={safeHref(job.url)} target="_blank" rel="noreferrer" className={cn('shrink-0 text-ter transition-opacity hover:text-ink group-hover/card:opacity-100 group-focus-within/card:opacity-100', HOVER_REVEAL)} title="Open the posting" aria-label="Open the posting" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
            <ExternalLink className="size-3" />
          </a>
        )}
        <span className="shrink-0 text-[11px] text-ter">{friendlyDate(job.postedAt)}</span>
      </div>
      <div className={cn('text-[12.5px] leading-[1.4] text-sub', compact ? 'truncate' : tall ? 'line-clamp-3' : 'line-clamp-2')} title={job.title}>{job.title}</div>
      {!compact && <div className="truncate text-xs text-ter">{job.locations.slice(0, 2).join(' · ')}{job.locations.length > 2 ? ` +${job.locations.length - 2}` : ''}</div>}
      {/* Pinned to the card's foot: a tape card fills the widget's height, and grid cards stretch to their row, so the actions line up across cards instead of leaving a gap under them. */}
      <div className={cn('mt-auto flex items-center gap-1.5', compact ? 'pt-0.5' : 'pt-1.5')}>
        <Orb on={job.state === 'starred'} tone="var(--caution)" label={job.state === 'starred' ? 'Remove star' : 'Star: keep this one in the Starred list'} onClick={() => onState(job.state === 'starred' ? 'new' : 'starred')}>
          <Star className={cn('size-3.5', job.state === 'starred' && 'fill-current')} />
        </Orb>
        <Orb on={tracked} tone="var(--positive)" label={tracked ? `${JOB_STATE_LABELS[job.state]} · open to change` : 'Mark as applied'} onClick={() => (tracked ? open({ kind: 'job', jobId: job.id }) : onState('applied'))}>
          <Check className="size-3.5" />
        </Orb>
        <Orb tone="var(--critical)" label="Hide this listing from the feed" onClick={() => onState('hidden')}>
          <X className="size-3.5" />
        </Orb>
        <span className="flex-1" />
        {tracked ? (
          <span className="grid h-6 place-items-center rounded-full px-2.5 text-[11px] font-semibold text-positive" style={{ background: 'color-mix(in srgb, var(--positive) 12%, var(--surface))' }}>{JOB_STATE_LABELS[job.state]}</span>
        ) : job.category ? (
          <span className="grid h-6 max-w-[7rem] place-items-center truncate rounded-full bg-surface px-2.5 text-[11px] font-medium text-sub">{shortCategory(job.category)}</span>
        ) : null}
      </div>
    </div>
  );
}

export function JobsWidget({ size }: WidgetProps) {
  const fade = useScrollEdges();
  const [mode, setMode] = useState<Mode>('new');
  const liquid = useLiquid();
  const [visible, setVisible] = useState(PAGE);
  const q = useJobs({ matchesOnly: true, limit: 200, state: mode === 'starred' ? ['starred'] : undefined });
  const stats = useJobStats();
  const patch = usePatchJobState();
  const refCb = useMarkSeenWhenVisible(q.data ?? []);
  const tape = size.aspect === 'wide' && size.height < 340;
  const compact = tape && size.height < 165;
  const tall = tape && size.height >= 200;

  const onState = (job: Job, state: Job['state']) =>
    patch.mutate({ id: job.id, state }, { onError: (e) => toast.error(e.message), onSuccess: () => state === 'applied' && toast.success(`Marked ${job.company} as applied`) });

  const jobs = useMemo(() => {
    const list = (q.data ?? []).filter((j) => j.state !== 'hidden');
    if (mode === 'new') return list.slice().sort((a, b) => Number(!!a.seenAt) - Number(!!b.seenAt) || (b.postedAt ?? '').localeCompare(a.postedAt ?? ''));
    return list;
  }, [q.data, mode]);
  const shown = jobs.slice(0, visible);
  const rest = jobs.length - shown.length;

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;

  return (
    <div className="flex h-full flex-col">
      <WidgetHeader>
        {stats.data && (
          <>
            <span className="shrink-0 text-[15px] font-semibold whitespace-nowrap">{stats.data.unseen} new</span>
            {size.tier !== 'xs' && <span className="min-w-0 truncate text-[12.5px] text-ter">{stats.data.matched} match · {stats.data.active.toLocaleString()} active</span>}
          </>
        )}
        {size.tier !== 'xs' && (
          <span className="seg" ref={liquid}>
            {(['new', 'starred', 'matches'] as Mode[]).map((m) => (
              <button key={m} className={cn(mode === m && 'seg-on')} aria-pressed={mode === m} onClick={() => { setMode(m); setVisible(PAGE); }} title={m === 'new' ? 'Unseen matches first' : m === 'starred' ? 'Only starred listings' : 'Every listing that matches your filter, newest first'}>
                {m === 'new' ? 'New' : m === 'starred' ? 'Starred' : 'Matches'}
              </button>
            ))}
          </span>
        )}
        {size.tier === 'lg' && <Link to="/settings/jobs" title="Edit the match filter" className="text-xs text-ter hover:text-ink">Filter</Link>}
      </WidgetHeader>
      <div ref={fade} className={cn('scroll-fade min-h-0 flex-1', tape ? 'overflow-x-auto overflow-y-hidden [--fade-size:40px]' : 'overflow-auto')}>
        {q.isPending ? (
          <div className="m-3 h-16 animate-pulse rounded-xl bg-well" />
        ) : !jobs.length ? (
          <EmptyState>
            {mode === 'starred' ? 'No starred jobs yet.' : 'No matching listings yet.'} <Link to="/settings/jobs" className="underline">Adjust the filter.</Link>
          </EmptyState>
        ) : tape ? (
          <div className="flex h-full w-max min-w-full items-stretch gap-2 px-3 py-2.5">
            {shown.map((j) => <Card key={j.id} job={j} tape compact={compact} tall={tall} onState={(s) => onState(j, s)} refCb={refCb} />)}
            {rest > 0 && (
              <button type="button" onMouseDown={(e) => e.stopPropagation()} onClick={() => setVisible((v) => v + 2 * PAGE)} className="grid w-[120px] shrink-0 place-items-center rounded-2xl bg-well p-3.5 text-center transition-colors hover:bg-well2">
                <span>
                  <span className="block text-xl font-[600] tracking-[-0.02em]">{rest}</span>
                  <span className="mt-0.5 block text-xs text-sub">more {mode === 'starred' ? 'starred' : mode === 'new' ? 'new' : 'matches'}</span>
                </span>
              </button>
            )}
          </div>
        ) : (
          <div className={cn('grid gap-2 p-2.5', size.tier === 'lg' ? 'grid-cols-3' : size.tier === 'md' ? 'grid-cols-2' : 'grid-cols-1')}>
            {shown.map((j) => <Card key={j.id} job={j} onState={(s) => onState(j, s)} refCb={refCb} />)}
            {rest > 0 && (
              <button type="button" onMouseDown={(e) => e.stopPropagation()} onClick={() => setVisible((v) => v + 2 * PAGE)} className="grid min-h-[5rem] place-items-center rounded-2xl bg-well p-3.5 text-center transition-colors hover:bg-well2">
                <span>
                  <span className="block text-xl font-[600] tracking-[-0.02em]">{rest}</span>
                  <span className="mt-0.5 block text-xs text-sub">more</span>
                </span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
