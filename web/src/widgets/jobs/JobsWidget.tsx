import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Check, EyeOff, ExternalLink, Star } from 'lucide-react';
import { toast } from 'sonner';
import { JOB_STATE_LABELS, type Job } from '@collected/shared';
import { Button } from '@/components/ui/button';
import { useJobStats, useJobs, useMarkJobsSeen, usePatchJobState } from '@/lib/queries';
import { friendlyDate } from '@/lib/time';
import { cn } from '@/lib/utils';
import { usePane } from '@/panes/PaneContext';
import { EmptyState, ErrorState } from '@/widgets/Placeholder';
import type { WidgetProps } from '@/widgets/types';

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

function Card({ job, onState, compact, refCb }: { job: Job; onState: (s: Job['state']) => void; compact?: boolean; refCb: (el: HTMLElement | null) => void }) {
  const { open } = usePane();
  return (
    <div
      ref={refCb}
      data-job-id={job.id}
      className={cn('group relative flex min-w-0 flex-col gap-0.5 rounded-md border bg-card p-2 text-sm', compact ? 'w-56 shrink-0' : 'w-full', !job.seenAt && 'border-primary/40', job.state === 'starred' && 'bg-amber-500/5')}
    >
      <div className="flex items-start gap-1">
        <button className="min-w-0 flex-1 text-left hover:underline" title="Details and tracking" onMouseDown={(e) => e.stopPropagation()} onClick={() => open({ kind: 'job', jobId: job.id })}>
          <div className="truncate font-medium">{job.company}</div>
          <div className="truncate text-xs text-muted-foreground" title={job.title}>{job.title}</div>
        </button>
        <a href={job.url} target="_blank" rel="noreferrer" className="mt-0.5 shrink-0 text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100" title="Open the posting" aria-label="Open the posting">
          <ExternalLink className="size-3" />
        </a>
      </div>
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <span className="truncate">{job.locations.slice(0, 2).join(' · ')}{job.locations.length > 2 ? ` +${job.locations.length - 2}` : ''}</span>
        <span className="ml-auto shrink-0">{friendlyDate(job.postedAt)}</span>
      </div>
      <div className="mt-0.5 flex items-center gap-0.5">
        <Button size="icon-xs" variant="ghost" aria-label={job.state === 'starred' ? 'Unstar' : 'Star'} title={job.state === 'starred' ? 'Remove star' : 'Star: keep this one in the Starred list'} onClick={() => onState(job.state === 'starred' ? 'new' : 'starred')}>
          <Star className={cn('size-3.5', job.state === 'starred' && 'fill-amber-400 text-amber-400')} />
        </Button>
        <Button size="icon-xs" variant="ghost" aria-label="Mark applied" title="Mark as applied" onClick={() => onState('applied')} className={cn(job.state === 'applied' && 'text-emerald-500')}>
          <Check className="size-3.5" />
        </Button>
        <Button size="icon-xs" variant="ghost" aria-label="Hide" title="Hide this listing from the feed" onClick={() => onState('hidden')}>
          <EyeOff className="size-3.5" />
        </Button>
        {job.state !== 'new' && job.state !== 'starred' && job.state !== 'hidden' ? (
          <span className="ml-auto text-[10px] uppercase tracking-wide text-emerald-500">{JOB_STATE_LABELS[job.state]}</span>
        ) : (
          job.category && <span className="ml-auto truncate text-[10px] text-muted-foreground">{job.category}</span>
        )}
      </div>
    </div>
  );
}

export function JobsWidget({ size }: WidgetProps) {
  const [showAll, setShowAll] = useState(false);
  const [starredOnly, setStarredOnly] = useState(false);
  const q = useJobs({ matchesOnly: !showAll, limit: 120, state: starredOnly ? ['starred'] : undefined });
  const stats = useJobStats();
  const patch = usePatchJobState();
  const refCb = useMarkSeenWhenVisible(q.data ?? []);
  const tape = size.aspect === 'wide' && size.height < 300;

  const onState = (job: Job, state: Job['state']) =>
    patch.mutate({ id: job.id, state }, { onError: (e) => toast.error(e.message), onSuccess: () => state === 'applied' && toast.success(`Marked ${job.company} as applied`) });

  const jobs = useMemo(() => (q.data ?? []).filter((j) => j.state !== 'hidden'), [q.data]);

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b px-1.5 py-1 text-[11px]">
        {stats.data && (
          <span className="text-muted-foreground">
            <span className={cn('font-medium', stats.data.unseen ? 'text-primary' : 'text-foreground')}>{stats.data.unseen} new</span> · {stats.data.matched} match · {stats.data.active} active
          </span>
        )}
        <span className="ml-auto flex items-center gap-0.5">
          <button title="Only starred listings" className={cn('rounded px-1.5 py-0.5', starredOnly ? 'bg-secondary font-medium' : 'text-muted-foreground hover:bg-secondary/60')} onClick={() => setStarredOnly((v) => !v)}>
            Starred
          </button>
          <button title={showAll ? 'Showing every active listing; click for matches only' : 'Showing listings that match your filter; click to see everything'} className={cn('rounded px-1.5 py-0.5', showAll ? 'bg-secondary font-medium' : 'text-muted-foreground hover:bg-secondary/60')} onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'All listings' : 'Matches'}
          </button>
          <Link to="/settings/jobs" title="Edit the match filter" className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-secondary/60">Filter</Link>
        </span>
      </div>
      <div className={cn('min-h-0 flex-1', tape ? 'overflow-x-auto overflow-y-hidden' : 'overflow-auto')}>
        {q.isPending ? (
          <div className="m-2 h-16 animate-pulse rounded bg-muted/40" />
        ) : !jobs.length ? (
          <EmptyState>
            {starredOnly ? 'No starred jobs yet.' : 'No matching listings yet.'} <Link to="/settings/jobs" className="underline">Adjust the filter.</Link>
          </EmptyState>
        ) : tape ? (
          <div className="flex h-full items-stretch gap-2 p-2">
            {jobs.slice(0, 40).map((j) => <Card key={j.id} job={j} compact onState={(s) => onState(j, s)} refCb={refCb} />)}
          </div>
        ) : (
          <div className={cn('grid gap-2 p-2', size.tier === 'lg' ? 'grid-cols-3' : size.tier === 'md' ? 'grid-cols-2' : 'grid-cols-1')}>
            {jobs.map((j) => <Card key={j.id} job={j} onState={(s) => onState(j, s)} refCb={refCb} />)}
          </div>
        )}
      </div>
    </div>
  );
}
