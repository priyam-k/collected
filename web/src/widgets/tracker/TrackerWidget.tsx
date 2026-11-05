import { useMemo, useState } from 'react';
import { CalendarClock, FileText, Plus } from 'lucide-react';
import { toast } from 'sonner';
import type { Job } from '@collected/shared';
import { Button } from '@/components/ui/button';
import { WidgetHeader } from '@/dashboard/WidgetHeader';
import { baseName, isClosedStage, stageLabel, stageTone, type JobStage } from '@/lib/jobStages';
import { useJobStages, useTrackedJobs, usePatchJobState } from '@/lib/queries';
import { friendlyDate, isPast } from '@/lib/time';
import { cn } from '@/lib/utils';
import { usePane } from '@/panes/PaneContext';
import { StageSelect } from '@/panes/JobPane';
import { EmptyState, ErrorState } from '@/widgets/Placeholder';
import { HOVER_REVEAL, activateOnKey, useScrollEdges } from '@/widgets/shared';
import type { WidgetProps } from '@/widgets/types';

/** Next-action date, then applied date, then last touch: the one line under the company. */
function meta(job: Job): { text: string; urgent: boolean } {
  if (job.nextActionAt || job.nextAction) {
    const due = job.nextActionAt ? friendlyDate(`${job.nextActionAt}T12:00:00`) : '';
    return { text: [due, job.nextAction].filter(Boolean).join(' · '), urgent: !!job.nextActionAt && isPast(`${job.nextActionAt}T23:59:59`) };
  }
  if (job.appliedAt) return { text: `Applied ${friendlyDate(`${job.appliedAt}T12:00:00`)}`, urgent: false };
  return { text: job.stateUpdatedAt ? `Saved ${friendlyDate(job.stateUpdatedAt)}` : '', urgent: false };
}

function Card({ job, stages, onStage, showStage }: { job: Job; stages: readonly JobStage[]; onStage(s: string): void; showStage?: boolean }) {
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
        {showStage && <span className={cn('label shrink-0 !text-[10px]', stageTone(stages, job.state))}>{stageLabel(stages, job.state)}</span>}
      </div>
      {job.resumePath && (
        <span className="inline-flex min-w-0 max-w-full items-center gap-1 self-start rounded-full bg-surface px-1.5 py-px text-[10px] text-ter" title={`Resume: ${job.resumePath}`}>
          <FileText className="size-2.5 shrink-0" />
          <span className="truncate">{baseName(job.resumePath)}</span>
        </span>
      )}
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
  const fade = useScrollEdges();
  const q = useTrackedJobs();
  const patch = usePatchJobState();
  const { open } = usePane();
  const [showClosed, setShowClosed] = useState(false);
  const { stages } = useJobStages();

  // Columns: Saved first, then the open stages in the list's order, then any open id the list doesn't know yet.
  const { byStage, openOrder, openJobs, closedJobs } = useMemo(() => {
    const byStage = new Map<string, Job[]>();
    const openJobs: Job[] = [];
    const closedJobs: Job[] = [];
    for (const j of q.data ?? []) {
      if (j.state === 'new' || j.state === 'hidden') continue;
      byStage.set(j.state, [...(byStage.get(j.state) ?? []), j]);
      (isClosedStage(stages, j.state) ? closedJobs : openJobs).push(j);
    }
    const listed = ['starred', ...stages.filter((s) => s.kind === 'open').map((s) => s.id)];
    const strays = [...byStage.keys()].filter((id) => !listed.includes(id) && !isClosedStage(stages, id));
    return { byStage, openOrder: [...listed, ...strays], openJobs, closedJobs };
  }, [q.data, stages]);
  // The first stage that counts as applied keeps its column when empty, so a fresh board has somewhere to look.
  const anchor = stages.find((s) => s.kind === 'open' && s.appliedStage)?.id ?? stages.find((s) => s.kind === 'open')?.id;
  const label = (id: string) => stageLabel(stages, id);
  const onStage = (job: Job, state: string) =>
    patch.mutate({ id: job.id, state }, { onError: (e) => toast.error(e.message), onSuccess: () => toast.success(`${job.company}: ${label(state)}`) });

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;

  const board = size.tier === 'lg' || (size.tier === 'md' && size.aspect !== 'tall');
  const summary = openOrder.map((s) => [s, byStage.get(s)?.length ?? 0] as const).filter(([, n]) => n > 0);
  const closedNames = stages.filter((s) => s.kind === 'closed').map((s) => s.label).join(', ');
  const xs = size.tier === 'xs';

  return (
    <div className="flex h-full flex-col">
      <WidgetHeader>
        {summary.length && xs ? (
          // no room for the per-stage breakdown: one count, the breakdown in the tooltip
          <span className="min-w-0 truncate text-[12.5px] text-sub" title={summary.map(([s, n]) => `${n} ${label(s).toLowerCase()}`).join(' · ')}>
            <span className="font-semibold text-ink">{openJobs.length}</span> open
          </span>
        ) : summary.length ? (
          <span className="min-w-0 truncate text-[12.5px] text-sub">
            {summary.map(([s, n], i) => (
              <span key={s}>{i > 0 && ' · '}<span className={cn('font-semibold', stageTone(stages, s))}>{n}</span> {label(s).toLowerCase()}</span>
            ))}
          </span>
        ) : (
          <span className="min-w-0 truncate text-[12.5px] text-ter">nothing open</span>
        )}
        {closedJobs.length > 0 && (
          <button title={closedNames || 'Closed stages'} aria-pressed={showClosed} className={cn('chip !h-7 shrink-0 whitespace-nowrap', showClosed && 'chip-on')} onMouseDown={(e) => e.stopPropagation()} onClick={() => setShowClosed((v) => !v)}>
            Closed · {closedJobs.length}
          </button>
        )}
        <Button size="xs" className="shrink-0" onMouseDown={(e) => e.stopPropagation()} onClick={() => open({ kind: 'job-new' })} title="Add a job that isn't in the feed">
          <Plus className="size-3" /> Add
        </Button>
      </WidgetHeader>
      <div ref={fade} className={cn('scroll-fade min-h-0 flex-1', board ? 'overflow-x-auto overflow-y-hidden [--fade-size:40px]' : 'overflow-auto')}>
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
            {[...openOrder.filter((s) => (byStage.get(s)?.length ?? 0) > 0 || s === anchor || s === 'starred'), ...(showClosed ? ['closed'] : [])].map((stage) => {
              const list = stage === 'closed' ? closedJobs : (byStage.get(stage) ?? []);
              return (
                <section key={stage} className="flex w-52 shrink-0 flex-col">
                  <h4 className={cn('label mb-1.5 flex items-baseline gap-1.5 px-1', stage === 'closed' ? 'text-ter' : stageTone(stages, stage))}>
                    {stage === 'closed' ? 'Closed' : label(stage)} <span className="text-ter">{list.length}</span>
                  </h4>
                  <div ref={fade} className="scroll-fade min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-0.5">
                    {list.map((j) => <Card key={j.id} job={j} stages={stages} onStage={(s) => onStage(j, s)} showStage={stage === 'closed'} />)}
                    {!list.length && <p className="px-1 text-xs text-muted-foreground/60">—</p>}
                  </div>
                </section>
              );
            })}
          </div>
        ) : (
          <div className="space-y-2 p-2.5">
            {[...openJobs, ...(showClosed ? closedJobs : [])].map((j) => <Card key={j.id} job={j} stages={stages} onStage={(s) => onStage(j, s)} showStage />)}
          </div>
        )}
      </div>
    </div>
  );
}
