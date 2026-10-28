import { useMemo, useState } from 'react';
import { CalendarClock, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { CLOSED_STAGES, JOB_STATE_LABELS, OPEN_STAGES, type Job, type JobStateValue } from '@collected/shared';
import { Button } from '@/components/ui/button';
import { WidgetHeader } from '@/dashboard/WidgetHeader';
import { useTrackedJobs, usePatchJobState } from '@/lib/queries';
import { friendlyDate, isPast } from '@/lib/time';
import { cn } from '@/lib/utils';
import { usePane } from '@/panes/PaneContext';
import { StageSelect } from '@/panes/JobPane';
import { EmptyState, ErrorState } from '@/widgets/Placeholder';
import { HOVER_REVEAL, activateOnKey } from '@/widgets/shared';
import type { WidgetProps } from '@/widgets/types';

const STAGE_TONE: Partial<Record<JobStateValue, string>> = {
  starred: 'text-caution',
  applied: 'text-ink',
  screen: 'text-brand-ink',
  interviewing: 'text-brand-ink',
  offer: 'text-positive',
  rejected: 'text-ter',
  ghosted: 'text-ter',
  withdrawn: 'text-ter',
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
      onKeyDown={(e) => activateOnKey(e, () => open({ kind: 'job', jobId: job.id }))}
      className="group/card flex min-w-0 cursor-pointer flex-col gap-1 rounded-[16px] bg-well p-3 text-sm transition-colors hover:bg-well2"
    >
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{job.company}</div>
          <div className="truncate text-xs text-muted-foreground" title={job.title}>{job.title}</div>
        </div>
        {showStage && <span className={cn('label shrink-0 !text-[10px]', STAGE_TONE[job.state])}>{JOB_STATE_LABELS[job.state]}</span>}
      </div>
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
        {m.urgent && <CalendarClock className="size-3 text-caution" />}
        <span className={cn('min-w-0 flex-1 truncate', m.urgent && 'font-medium text-caution')}>{m.text}</span>
        <StageSelect value={job.state} onChange={onStage} className={cn('h-5 shrink-0 px-1 text-[10px] transition-opacity group-hover/card:opacity-100 group-focus-within/card:opacity-100', HOVER_REVEAL)} />
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
  const xs = size.tier === 'xs';

  return (
    <div className="flex h-full flex-col">
      <WidgetHeader>
        {summary.length && xs ? (
          // no room for the per-stage breakdown: one count, the breakdown in the tooltip
          <span className="min-w-0 truncate text-[12.5px] text-sub" title={summary.map(([s, n]) => `${n} ${JOB_STATE_LABELS[s].toLowerCase()}`).join(' · ')}>
            <span className="font-semibold text-ink">{openJobs.length}</span> open
          </span>
        ) : summary.length ? (
          <span className="min-w-0 truncate text-[12.5px] text-sub">
            {summary.map(([s, n], i) => (
              <span key={s}>{i > 0 && ' · '}<span className={cn('font-semibold', STAGE_TONE[s])}>{n}</span> {JOB_STATE_LABELS[s].toLowerCase()}</span>
            ))}
          </span>
        ) : (
          <span className="min-w-0 truncate text-[12.5px] text-ter">nothing open</span>
        )}
        {closedJobs.length > 0 && (
          <button title="Rejected, ghosted, withdrawn" aria-pressed={showClosed} className={cn('chip !h-7 shrink-0 whitespace-nowrap', showClosed && 'chip-on')} onMouseDown={(e) => e.stopPropagation()} onClick={() => setShowClosed((v) => !v)}>
            Closed · {closedJobs.length}
          </button>
        )}
        <Button size="xs" className="shrink-0" onMouseDown={(e) => e.stopPropagation()} onClick={() => open({ kind: 'job-new' })} title="Add a job that isn't in the feed">
          <Plus className="size-3" /> Add
        </Button>
      </WidgetHeader>
      <div className={cn('min-h-0 flex-1', board ? 'overflow-x-auto overflow-y-hidden' : 'overflow-auto')}>
        {q.isPending ? (
          <div className="m-3 h-16 animate-pulse rounded-xl bg-well" />
        ) : !openJobs.length && closedJobs.length && !showClosed ? (
          <EmptyState>
            Nothing open; {closedJobs.length} closed.{' '}
            <button className="underline" onClick={() => setShowClosed(true)}>Show {closedJobs.length === 1 ? 'it' : 'them'}</button>, or{' '}
            <button className="underline" onClick={() => open({ kind: 'job-new' })}>add one by hand</button>.
          </EmptyState>
        ) : !openJobs.length && !(showClosed && closedJobs.length) ? (
          <EmptyState>
            Nothing tracked yet. Star or apply from the job feed, or{' '}
            <button className="underline" onClick={() => open({ kind: 'job-new' })}>add one by hand</button>.
          </EmptyState>
        ) : board ? (
          <div className="flex h-full min-w-max gap-2.5 p-2.5">
            {[...OPEN_STAGES.filter((s) => (byStage.get(s)?.length ?? 0) > 0 || s === 'applied' || s === 'starred'), ...(showClosed ? (['closed'] as const) : [])].map((stage) => {
              const list = stage === 'closed' ? closedJobs : (byStage.get(stage) ?? []);
              return (
                <section key={stage} className="flex w-52 shrink-0 flex-col">
                  <h4 className={cn('label mb-1.5 flex items-baseline gap-1.5 px-1', stage === 'closed' ? 'text-ter' : STAGE_TONE[stage])}>
                    {stage === 'closed' ? 'Closed' : JOB_STATE_LABELS[stage]} <span className="text-ter">{list.length}</span>
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
          <div className="space-y-2 p-2.5">
            {[...openJobs, ...(showClosed ? closedJobs : [])].map((j) => <Card key={j.id} job={j} onStage={(s) => onStage(j, s)} showStage />)}
          </div>
        )}
      </div>
    </div>
  );
}
