import { useMemo, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DEFAULT_JOB_STAGES, isReservedStage, stageIdFrom, type JobStage } from '@/lib/jobStages';
import { useJobStages, useSaveJobStages, useTrackedJobs } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { Section } from './ui';

const same = (a: readonly JobStage[], b: readonly JobStage[]) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The tracker's stages, edited as a draft and saved as one ordered list. A stage with jobs in it can't be removed
 * (the server refuses too); Saved, New and Hidden are feed markers and never appear here.
 */
export function JobStagesSection() {
  const { stages, isPending } = useJobStages();
  const tracked = useTrackedJobs();
  const save = useSaveJobStages();
  const [draft, setDraft] = useState<JobStage[] | null>(null);
  const [name, setName] = useState('');
  const list = draft ?? stages;
  const dirty = draft !== null && !same(draft, stages);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const j of tracked.data ?? []) m.set(j.state, (m.get(j.state) ?? 0) + 1);
    return m;
  }, [tracked.data]);

  const edit = (fn: (l: JobStage[]) => JobStage[]) => setDraft(fn(list.map((s) => ({ ...s }))));
  const move = (i: number, by: number) =>
    edit((l) => {
      const [s] = l.splice(i, 1);
      l.splice(i + by, 0, s!);
      return l;
    });
  const patch = (i: number, p: Partial<JobStage>) => edit((l) => l.map((s, k) => (k === i ? { ...s, ...p } : s)));

  const newId = stageIdFrom(name);
  const nameProblem = !name.trim() ? null : !newId ? 'Use letters or numbers' : isReservedStage(newId) ? `"${newId}" is a feed marker` : list.some((s) => s.id === newId) ? 'Already a stage' : null;
  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!newId || nameProblem) return;
    // New open stages go after the last open one, so closed stages stay at the end.
    const lastOpen = list.map((s) => s.kind).lastIndexOf('open');
    edit((l) => {
      l.splice(lastOpen + 1, 0, { id: newId, label: name.trim().slice(0, 60), kind: 'open' });
      return l;
    });
    setName('');
  };

  // Defaults, plus whatever custom stage still holds jobs (dropping it would be refused).
  const reset = () => {
    const keep = list.filter((s) => (counts.get(s.id) ?? 0) > 0 && !DEFAULT_JOB_STAGES.some((d) => d.id === s.id));
    setDraft([...DEFAULT_JOB_STAGES.map((s) => ({ ...s })), ...keep]);
  };

  const blank = list.some((s) => !s.label.trim());
  const noOpen = !list.some((s) => s.kind === 'open');
  const submit = () => {
    if (!draft) return;
    const clean = draft.map((s) => ({ ...s, label: s.label.trim(), ...(s.kind === 'closed' ? { appliedStage: false } : {}) }));
    save.mutate(clean, {
      onSuccess: () => {
        setDraft(null);
        toast.success('Stages saved');
      },
      onError: (e) => toast.error(`Could not save the stages: ${e.message}`),
    });
  };

  return (
    <Section
      title="Stages"
      sub="The columns of the Applications board, in order. Open stages are the pipeline; closed ones sit behind the Closed toggle. A stage that counts as applied stamps the applied date when a job moves in. Saved is the feed's star and always comes first."
    >
      {isPending ? (
        <div className="h-24 animate-pulse rounded-[14px] bg-well" />
      ) : (
        <ol className="space-y-1.5" aria-label="Stages">
          {list.map((s, i) => {
            const n = counts.get(s.id) ?? 0;
            return (
              <li key={s.id} className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-[14px] bg-well px-2 py-1.5">
                <span className="flex shrink-0 gap-0.5">
                  <button type="button" className="orb size-7 bg-surface disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${s.label || s.id} up`} title="Move up">
                    <ArrowUp className="size-3.5" />
                  </button>
                  <button type="button" className="orb size-7 bg-surface disabled:opacity-30" disabled={i === list.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${s.label || s.id} down`} title="Move down">
                    <ArrowDown className="size-3.5" />
                  </button>
                </span>
                <Input
                  value={s.label}
                  maxLength={60}
                  onChange={(e) => patch(i, { label: e.target.value })}
                  aria-label={`Name of the ${s.id} stage`}
                  aria-invalid={!s.label.trim() || undefined}
                  className="h-8 min-w-[8rem] flex-1 basis-32 bg-surface text-sm"
                />
                <code className="hidden w-24 shrink-0 truncate font-mono text-[11px] text-ter sm:inline" title={`${s.id}: the id the API and the CLI use`}>{s.id}</code>
                <span className="seg shrink-0" role="group" aria-label={`${s.label || s.id}: open or closed`}>
                  {(['open', 'closed'] as const).map((k) => (
                    <button key={k} type="button" className={cn(s.kind === k && 'seg-on')} aria-pressed={s.kind === k} onClick={() => patch(i, { kind: k })}>
                      {k === 'open' ? 'Open' : 'Closed'}
                    </button>
                  ))}
                </span>
                <button
                  type="button"
                  disabled={s.kind === 'closed'}
                  aria-pressed={!!s.appliedStage && s.kind === 'open'}
                  onClick={() => patch(i, { appliedStage: !s.appliedStage })}
                  className={cn('chip shrink-0 disabled:pointer-events-none disabled:opacity-40', s.appliedStage && s.kind === 'open' && 'chip-on')}
                  title="Moving a job here stamps its applied date when it has none"
                >
                  Counts as applied
                </button>
                <span className="w-14 shrink-0 text-right text-xs tabular-nums text-ter">{n ? `${n} job${n === 1 ? '' : 's'}` : ''}</span>
                {/* A disabled button gets no hover, so the reason sits on a wrapper. */}
                <span className="shrink-0" title={n ? `${n} job${n === 1 ? ' is' : 's are'} in ${s.label || s.id}: move ${n === 1 ? 'it' : 'them'} first` : `Remove ${s.label || s.id}`}>
                  <button type="button" className="orb size-7 bg-surface hover:text-critical disabled:pointer-events-none disabled:opacity-30" disabled={n > 0} onClick={() => edit((l) => l.filter((_, k) => k !== i))} aria-label={`Remove ${s.label || s.id}`}>
                    <Trash2 className="size-3.5" />
                  </button>
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <form onSubmit={add} className="flex flex-wrap items-start gap-2">
        <div className="min-w-[12rem] flex-1 space-y-1">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="New stage, e.g. Online assessment" aria-label="New stage name" className="h-8 text-sm" />
          <span className={cn('block text-xs', nameProblem ? 'text-critical' : 'text-muted-foreground')}>{nameProblem ?? (newId ? `Saves as "${newId}", open` : 'Added as an open stage; mark it closed after.')}</span>
        </div>
        <Button type="submit" variant="secondary" size="sm" className="h-8" disabled={!newId || !!nameProblem}>
          <Plus className="size-3.5" /> Add stage
        </Button>
      </form>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={submit} disabled={!dirty || blank || noOpen || save.isPending}>{save.isPending ? 'Saving…' : 'Save stages'}</Button>
        {dirty && (
          <Button variant="ghost" onClick={() => setDraft(null)} disabled={save.isPending}>Discard changes</Button>
        )}
        <span className="flex-1" />
        <Button variant="ghost" onClick={reset} disabled={save.isPending || same(list, DEFAULT_JOB_STAGES)} title="Back to Applied, Screen, Interviewing, Offer, Rejected, Ghosted, Withdrawn. Stages that still hold jobs stay.">
          Reset to defaults
        </Button>
      </div>
      {blank && <p className="text-xs text-critical">Every stage needs a name.</p>}
      {noOpen && <p className="text-xs text-critical">Keep at least one open stage: the board needs a column.</p>}
    </Section>
  );
}
