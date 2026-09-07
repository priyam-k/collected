import { useMemo, useState } from 'react';
import { CalendarClock, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { CLOSED_STAGES, JOB_STATE_LABELS, OPEN_STAGES, type Job, type JobStateValue } from '@collected/shared';
import { Button } from '@/components/ui/button';
import { useTrackedJobs, usePatchJobState } from '@/lib/queries';
import { friendlyDate, isPast } from '@/lib/time';
import { cn } from '@/lib/utils';
import { usePane } from '@/panes/PaneContext';
import { StageSelect } from '@/panes/JobPane';
import { EmptyState, ErrorState } from '@/widgets/Placeholder';
import type { WidgetProps } from '@/widgets/types';

const STAGE_TONE: Partial<Record<JobStateValue, string>> = {
  starred: 'text-amber-600 dark:text-amber-400',
  applied: 'text-sky-600 dark:text-sky-400',
  screen: 'text-violet-600 dark:text-violet-400',
  interviewing: 'text-violet-600 dark:text-violet-400',
  offer: 'text-emerald-600 dark:text-emerald-400',
  rejected: 'text-muted-foreground',
  ghosted: 'text-muted-foreground',
  withdrawn: 'text-muted-foreground',
};

/** Next-action date, then applied date, then last touch: the one line under the company. */
function meta(job: Job): { text: string; urgent: boolean } {
  if (job.nextActionAt || job.nextAction) {
    const due = job.nextActionAt ? friendlyDate(`${job.nextActionAt}T12:00:00`) : '';
    return { text: [due, job.nextAction].filter(Boolean).join(' · '), urgent: !!job.nextActionAt && isPast(`${job.nextActionAt}T23:59:59`) };
  }
  if (job.appliedAt) return { text: `Applied ${friendlyDate(`${job.appliedAt}T12:00:00`)}`, urgent: false };
  return { text: job.stateUpdatedAt ? `Saved ${friendlyDate(job.stateUpdatedAt)}` : '', urgent: false };
}

function Card({ job, onStage, showStage }: { job: Job; onStage(s: JobStateValue): void; showStage?: boolean }) {
  const { open } = usePane();
  const m = meta(job);
  return (
    <div
      role="button"
      tabIndex={0}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={() => open({ kind: 'job', jobId: job.id })}
      onKeyDown={(e) => e.key === 'Enter' && open({ kind: 'job', jobId: job.id })}
      className="group/card flex min-w-0 cursor-pointer flex-col gap-0.5 rounded-md border bg-card p-2 text-sm hover:bg-accent/40"
    >
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{job.company}</div>
          <div className="truncate text-xs text-muted-foreground" title={job.title}>{job.title}</div>
        </div>
        {showStage && <span className={cn('shrink-0 text-[10px] uppercase tracking-wide', STAGE_TONE[job.state])}>{JOB_STATE_LABELS[job.state]}</span>}
      </div>
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
        {m.urgent && <CalendarClock className="size-3 text-amber-500" />}
        <span className={cn('min-w-0 flex-1 truncate', m.urgent && 'text-amber-600 dark:text-amber-400')}>{m.text}</span>
        <StageSelect value={job.state} onChange={onStage} className="h-5 shrink-0 px-1 text-[10px] opacity-0 group-hover/card:opacity-100 focus:opacity-100" />
      </div>
    </div>
  );
}

/** Every application by stage: a board when there's room, a list otherwise. Add your own entries with +. */
export function TrackerWidget({ size }: WidgetProps) {
  const q = useTrackedJobs();
  const patch = usePatchJobState();
  const { open } = usePane();
  const [showClosed, setShowClosed] = useState(false);

  const byStage = useMemo(() => {
    const m = new Map<JobStateValue, Job[]>();
    for (const j of q.data ?? []) m.set(j.state, [...(m.get(j.state) ?? []), j]);
    return m;
  }, [q.data]);
  const openJobs = (q.data ?? []).filter((j) => OPEN_STAGES.includes(j.state));
  const closedJobs = (q.data ?? []).filter((j) => CLOSED_STAGES.includes(j.state));
  const onStage = (job: Job, state: JobStateValue) =>
    patch.mutate({ id: job.id, state }, { onError: (e) => toast.error(e.message), onSuccess: () => toast.success(`${job.company}: ${JOB_STATE_LABELS[state]}`) });

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;

  const board = size.tier === 'lg' || (size.tier === 'md' && size.aspect !== 'tall');
  const summary = OPEN_STAGES.map((s) => [s, byStage.get(s)?.length ?? 0] as const).filter(([, n]) => n > 0);

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b px-1.5 py-1 text-[11px]">
        {summary.length ? (
          <span className="truncate text-muted-foreground">
            {summary.map(([s, n], i) => (
              <span key={s}>{i > 0 && ' · '}<span className={cn('font-medium', STAGE_TONE[s])}>{n}</span> {JOB_STATE_LABELS[s].toLowerCase()}</span>
            ))}
          </span>
        ) : (
          <span className="text-muted-foreground">nothing open</span>
        )}
        <span className="ml-auto flex items-center gap-0.5">
          {closedJobs.length > 0 && (
            <button title="Rejected, ghosted, withdrawn" className={cn('rounded px-1.5 py-0.5', showClosed ? 'bg-secondary font-medium' : 'text-muted-foreground hover:bg-secondary/60')} onClick={() => setShowClosed((v) => !v)}>
              Closed {closedJobs.length}
            </button>
          )}
          <Button size="xs" variant="secondary" onMouseDown={(e) => e.stopPropagation()} onClick={() => open({ kind: 'job-new' })} title="Add a job that isn't in the feed">
            <Plus className="size-3" /> Add
          </Button>
        </span>
      </div>
      <div className={cn('min-h-0 flex-1', board ? 'overflow-x-auto overflow-y-hidden' : 'overflow-auto')}>
        {q.isPending ? (
          <div className="m-2 h-16 animate-pulse rounded bg-muted/40" />
        ) : !openJobs.length && !(showClosed && closedJobs.length) ? (
          <EmptyState>
            Nothing tracked yet. Star or apply from the job feed, or{' '}
            <button className="underline" onClick={() => open({ kind: 'job-new' })}>add one by hand</button>.
          </EmptyState>
        ) : board ? (
          <div className="flex h-full min-w-max gap-2 p-2">
            {[...OPEN_STAGES.filter((s) => (byStage.get(s)?.length ?? 0) > 0 || s === 'applied' || s === 'starred'), ...(showClosed ? (['closed'] as const) : [])].map((stage) => {
              const list = stage === 'closed' ? closedJobs : (byStage.get(stage) ?? []);
              return (
                <section key={stage} className="flex w-52 shrink-0 flex-col">
                  <h4 className={cn('mb-1 flex items-baseline gap-1 px-1 text-[11px] font-medium uppercase tracking-wide', stage === 'closed' ? 'text-muted-foreground' : STAGE_TONE[stage])}>
                    {stage === 'closed' ? 'Closed' : JOB_STATE_LABELS[stage]} <span className="font-normal text-muted-foreground">{list.length}</span>
                  </h4>
                  <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-0.5">
                    {list.map((j) => <Card key={j.id} job={j} onStage={(s) => onStage(j, s)} showStage={stage === 'closed'} />)}
                    {!list.length && <p className="px-1 text-xs text-muted-foreground/60">—</p>}
                  </div>
                </section>
              );
            })}
          </div>
        ) : (
          <div className="space-y-1.5 p-2">
            {[...openJobs, ...(showClosed ? closedJobs : [])].map((j) => <Card key={j.id} job={j} onStage={(s) => onStage(j, s)} showStage />)}
          </div>
        )}
      </div>
    </div>
  );
}
