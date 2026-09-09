import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router';
import { Check, ExternalLink, Star, X } from 'lucide-react';
import { toast } from 'sonner';
import { JOB_STATE_LABELS, type Job } from '@collected/shared';
import { WidgetHeader } from '@/dashboard/WidgetHeader';
import { useJobStats, useJobs, useMarkJobsSeen, usePatchJobState } from '@/lib/queries';
import { friendlyDate } from '@/lib/time';
import { cn } from '@/lib/utils';
import { usePane } from '@/panes/PaneContext';
import { EmptyState, ErrorState } from '@/widgets/Placeholder';
import type { WidgetProps } from '@/widgets/types';

type Mode = 'new' | 'starred' | 'matches';
const PAGE = 12;

/** Category pill colour: the design's Software = indigo, AI/ML = lime; the rest spread over the other accents. */
function categoryTone(category: string | null): string {
  const c = (category ?? '').toLowerCase();
  if (c.includes('software')) return 'var(--indigo)';
  if (c.includes('ai') || c.includes('ml') || c.includes('data')) return 'var(--lime)';
  if (c.includes('hardware')) return 'var(--teal)';
  if (c.includes('product')) return 'var(--amber)';
  if (c.includes('quant')) return 'var(--coral)';
  return 'var(--sub)';
}
const shortCategory = (c: string | null) => (c ?? '').replace('AI/ML/Data', 'AI / ML').replace('Software', 'Software');

function useMarkSeenWhenVisible(jobs: Job[]) {
  const mark = useMarkJobsSeen();
  const pending = useRef(new Set<string>());
  const timer = useRef<number | null>(null);
  const observer = useRef<IntersectionObserver | null>(null);
  useEffect(() => {
    observer.current = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.jobId;
          if (!id || !e.isIntersecting) continue;
          const job = jobs.find((j) => j.id === id);
          if (!job || job.seenAt) continue;
          pending.current.add(id);
        }
        if (pending.current.size && !timer.current) {
          timer.current = window.setTimeout(() => {
            const ids = [...pending.current];
            pending.current.clear();
            timer.current = null;
            if (ids.length) mark.mutate(ids);
          }, 2000);
        }
      },
      { threshold: 0.6 },
    );
    return () => observer.current?.disconnect();
  }, [jobs, mark]);
  return (el: HTMLElement | null) => {
    if (el) observer.current?.observe(el);
  };
}

function Orb({ on, tone, label, onClick, children }: { on?: boolean; tone: string; label: string; onClick(): void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="orb size-7 text-xs transition-colors"
      style={{ color: on ? tone : undefined, '--tone': tone } as CSSProperties}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = tone; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = on ? tone : ''; }}
    >
      {children}
    </button>
  );
}

function Card({ job, onState, tape, compact, refCb }: { job: Job; onState: (s: Job['state']) => void; tape?: boolean; compact?: boolean; refCb: (el: HTMLElement | null) => void }) {
  const { open } = usePane();
  const tracked = job.state !== 'new' && job.state !== 'starred' && job.state !== 'hidden';
  const tone = categoryTone(job.category);
  return (
    <div
      ref={refCb}
      data-job-id={job.id}
      role="button"
      tabIndex={0}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={() => open({ kind: 'job', jobId: job.id })}
      onKeyDown={(e) => e.key === 'Enter' && open({ kind: 'job', jobId: job.id })}
      className={cn('group/card flex min-w-0 cursor-pointer flex-col gap-[5px] rounded-[14px] bg-well p-3 text-left shadow-[inset_0_1px_0_var(--line)] transition-colors hover:bg-well2', tape ? 'w-[236px] shrink-0' : 'w-full', !job.seenAt && 'ring-1 ring-inset ring-indigo/35', job.state === 'starred' && 'bg-[color-mix(in_oklab,var(--amber)_8%,var(--well))]')}
      title="Details and tracking"
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{job.company}</span>
        <a href={job.url} target="_blank" rel="noreferrer" className="shrink-0 text-ter opacity-0 transition-opacity hover:text-ink group-hover/card:opacity-100" title="Open the posting" aria-label="Open the posting" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
          <ExternalLink className="size-3" />
        </a>
        <span className="shrink-0 text-[11px] text-ter">{friendlyDate(job.postedAt)}</span>
      </div>
      <div className={cn('text-[12.5px] leading-[1.4] text-sub', compact ? 'truncate' : 'line-clamp-2')} title={job.title}>{job.title}</div>
      {!compact && <div className="truncate text-xs text-ter">{job.locations.slice(0, 2).join(' · ')}{job.locations.length > 2 ? ` +${job.locations.length - 2}` : ''}</div>}
      <div className={cn('flex items-center gap-1.5', compact ? 'mt-0.5' : 'mt-1.5')}>
        <Orb on={job.state === 'starred'} tone="var(--amber)" label={job.state === 'starred' ? 'Remove star' : 'Star: keep this one in the Starred list'} onClick={() => onState(job.state === 'starred' ? 'new' : 'starred')}>
          <Star className={cn('size-3.5', job.state === 'starred' && 'fill-current')} />
        </Orb>
        <Orb on={tracked} tone="var(--teal)" label={tracked ? `${JOB_STATE_LABELS[job.state]} · open to change` : 'Mark as applied'} onClick={() => (tracked ? open({ kind: 'job', jobId: job.id }) : onState('applied'))}>
          <Check className="size-3.5" />
        </Orb>
        <Orb tone="var(--coral)" label="Hide this listing from the feed" onClick={() => onState('hidden')}>
          <X className="size-3.5" />
        </Orb>
        <span className="flex-1" />
        {tracked ? (
          <span className="grid h-6 place-items-center rounded-full px-2.5 text-[11px] font-semibold text-teal" style={{ background: 'color-mix(in oklab, var(--teal) 18%, var(--card))' }}>{JOB_STATE_LABELS[job.state]}</span>
        ) : job.category ? (
          <span className="grid h-6 max-w-[7rem] place-items-center truncate rounded-full px-2.5 text-[11px] font-semibold" style={{ color: tone, background: `color-mix(in oklab, ${tone} 18%, var(--card))` }}>{shortCategory(job.category)}</span>
        ) : null}
      </div>
    </div>
  );
}

export function JobsWidget({ size }: WidgetProps) {
  const [mode, setMode] = useState<Mode>('new');
  const [visible, setVisible] = useState(PAGE);
  const q = useJobs({ matchesOnly: true, limit: 200, state: mode === 'starred' ? ['starred'] : undefined });
  const stats = useJobStats();
  const patch = usePatchJobState();
  const refCb = useMarkSeenWhenVisible(q.data ?? []);
  const tape = size.aspect === 'wide' && size.height < 340;
  const compact = tape && size.height < 165;

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
            <span className="text-[15px] font-semibold whitespace-nowrap">{stats.data.unseen} new</span>
            {size.tier !== 'xs' && <span className="text-[12.5px] text-ter whitespace-nowrap">{stats.data.matched} match · {stats.data.active.toLocaleString()} active</span>}
          </>
        )}
        {size.tier !== 'xs' && (
          <span className="seg">
            {(['new', 'starred', 'matches'] as Mode[]).map((m) => (
              <button key={m} className={cn(mode === m && 'seg-on')} onClick={() => { setMode(m); setVisible(PAGE); }} title={m === 'new' ? 'Unseen matches first' : m === 'starred' ? 'Only starred listings' : 'Every listing that matches your filter, newest first'}>
                {m === 'new' ? 'New' : m === 'starred' ? 'Starred' : 'Matches'}
              </button>
            ))}
          </span>
        )}
        {size.tier === 'lg' && <Link to="/settings/jobs" title="Edit the match filter" className="text-xs text-ter hover:text-ink">Filter</Link>}
      </WidgetHeader>
      <div className={cn('min-h-0 flex-1', tape ? 'overflow-x-auto overflow-y-hidden' : 'overflow-auto')}>
        {q.isPending ? (
          <div className="m-3 h-16 animate-pulse rounded-xl bg-well" />
        ) : !jobs.length ? (
          <EmptyState>
            {mode === 'starred' ? 'No starred jobs yet.' : 'No matching listings yet.'} <Link to="/settings/jobs" className="underline">Adjust the filter.</Link>
          </EmptyState>
        ) : tape ? (
          <div className="flex h-full items-stretch gap-2 px-3 py-2.5">
            {shown.map((j) => <Card key={j.id} job={j} tape compact={compact} onState={(s) => onState(j, s)} refCb={refCb} />)}
            {rest > 0 && (
              <button type="button" onMouseDown={(e) => e.stopPropagation()} onClick={() => setVisible((v) => v + 2 * PAGE)} className="grid w-[120px] shrink-0 place-items-center rounded-2xl bg-well p-3.5 text-center transition-colors hover:bg-well2">
                <span>
                  <span className="block text-xl font-bold tracking-[-0.02em]">{rest}</span>
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
                  <span className="block text-xl font-bold tracking-[-0.02em]">{rest}</span>
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
