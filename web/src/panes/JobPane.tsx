import { useEffect, useState, type FormEvent } from 'react';
import { EyeOff, ExternalLink, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { CLOSED_STAGES, JOB_STATE_LABELS, OPEN_STAGES, type Job, type JobStateValue } from '@collected/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { useCreateJob, useDeleteJob, useJob, usePatchJobState } from '@/lib/queries';
import { friendlyDate } from '@/lib/time';
import { cn } from '@/lib/utils';
import { usePane } from './PaneContext';

const todayLocal = () => new Date().toLocaleDateString('en-CA');

/** Native select: small, keyboard friendly, no portal fights inside the sheet. */
export function StageSelect({ value, onChange, className, allowUntracked }: { value: JobStateValue; onChange(v: JobStateValue): void; className?: string; allowUntracked?: boolean }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as JobStateValue)}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      className={cn('h-7 rounded-md border bg-background px-1.5 text-xs', className)}
      aria-label="Stage"
    >
      {allowUntracked && <option value="new">Not tracked</option>}
      {value === 'hidden' && <option value="hidden">Hidden</option>}
      <optgroup label="Open">{OPEN_STAGES.map((s) => <option key={s} value={s}>{JOB_STATE_LABELS[s]}</option>)}</optgroup>
      <optgroup label="Closed">{CLOSED_STAGES.map((s) => <option key={s} value={s}>{JOB_STATE_LABELS[s]}</option>)}</optgroup>
    </select>
  );
}

/** Text field that saves on blur (or Enter for single-line), so notes don't need a Save button. */
function SavedField({ label, value, onSave, multiline, type, placeholder }: { label: string; value: string | null; onSave(v: string | null): void; multiline?: boolean; type?: string; placeholder?: string }) {
  const [draft, setDraft] = useState(value ?? '');
  useEffect(() => setDraft(value ?? ''), [value]);
  const commit = () => {
    const v = draft.trim() || null;
    if (v !== (value ?? null)) onSave(v);
  };
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {multiline ? (
        <Textarea rows={4} value={draft} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} onBlur={commit} className="text-sm" />
      ) : (
        <Input type={type} value={draft} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} className="h-8 text-sm" />
      )}
    </div>
  );
}

function NewJobForm() {
  const create = useCreateJob();
  const { open } = usePane();
  const [f, setF] = useState({ company: '', title: '', url: '', locations: '', state: 'applied' as JobStateValue, appliedAt: todayLocal(), notes: '' });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(
      {
        company: f.company,
        title: f.title,
        url: f.url.trim(),
        locations: f.locations.split(',').map((x) => x.trim()).filter(Boolean),
        state: f.state,
        appliedAt: f.appliedAt || null,
        notes: f.notes.trim() || null,
      },
      { onSuccess: (job) => { toast.success(`Added ${job.company}`); open({ kind: 'job', jobId: job.id }); }, onError: (err) => toast.error(err.message) },
    );
  };
  return (
    <form onSubmit={submit} className="flex h-full min-h-0 flex-col">
      <SheetHeader className="border-b pb-3">
        <SheetTitle className="text-base">Add a job</SheetTitle>
        <SheetDescription>Something outside the feed: a referral, a career-fair lead, a company site.</SheetDescription>
      </SheetHeader>
      <div className="grid gap-3 overflow-auto px-4 py-4 sm:grid-cols-2">
        <div className="space-y-1"><Label className="text-xs text-muted-foreground">Company</Label><Input autoFocus required value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} className="h-8 text-sm" /></div>
        <div className="space-y-1"><Label className="text-xs text-muted-foreground">Title</Label><Input required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} className="h-8 text-sm" placeholder="Software Engineer Intern" /></div>
        <div className="space-y-1 sm:col-span-2"><Label className="text-xs text-muted-foreground">Posting URL</Label><Input type="url" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} className="h-8 text-sm" placeholder="https://…" /></div>
        <div className="space-y-1"><Label className="text-xs text-muted-foreground">Locations (comma-separated)</Label><Input value={f.locations} onChange={(e) => setF({ ...f, locations: e.target.value })} className="h-8 text-sm" placeholder="College Park, MD, Remote" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1"><Label className="text-xs text-muted-foreground">Stage</Label><StageSelect value={f.state} onChange={(v) => setF({ ...f, state: v })} className="h-8 w-full" /></div>
          <div className="space-y-1"><Label className="text-xs text-muted-foreground">Applied on</Label><Input type="date" value={f.appliedAt} onChange={(e) => setF({ ...f, appliedAt: e.target.value })} className="h-8 text-sm" /></div>
        </div>
        <div className="space-y-1 sm:col-span-2"><Label className="text-xs text-muted-foreground">Notes</Label><Textarea rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} className="text-sm" placeholder="Who referred you, what they said, the deadline…" /></div>
      </div>
      <div className="mt-auto flex justify-end gap-2 border-t p-4">
        <Button type="submit" disabled={create.isPending || !f.company.trim() || !f.title.trim()}>Add to tracker</Button>
      </div>
    </form>
  );
}

/** One job, feed or manual: the posting's details plus every tracker field, editable in place. */
export function JobPane({ jobId }: { jobId: string | null }) {
  const q = useJob(jobId);
  const patch = usePatchJobState();
  const del = useDeleteJob();
  const { close } = usePane();

  if (!jobId) return <NewJobForm />;
  const job = q.data;
  if (!job) {
    return (
      <SheetHeader>
        <SheetTitle>Job</SheetTitle>
        <SheetDescription>{q.isPending ? 'Loading…' : (q.error?.message ?? 'Not found.')}</SheetDescription>
      </SheetHeader>
    );
  }

  const save = (body: Omit<Parameters<typeof patch.mutate>[0], 'id'>, msg?: string) =>
    patch.mutate({ id: job.id, ...body }, { onError: (e) => toast.error(e.message), onSuccess: () => msg && toast.success(msg) });
  const manual = job.source === 'manual';
  const tracked = job.state !== 'new' && job.state !== 'hidden';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SheetHeader className="border-b pb-3">
        <div className="flex items-start gap-2 pr-8">
          <div className="min-w-0 flex-1">
            <SheetTitle className="truncate text-base">{job.company}</SheetTitle>
            <SheetDescription className="truncate">{job.title}</SheetDescription>
          </div>
          <Badge variant="outline" className="shrink-0 text-[10px]">{manual ? 'Manual' : 'Feed'}</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {job.locations.length > 0 && <span>{job.locations.join(' · ')}</span>}
          {job.postedAt && <span>{manual ? 'Added' : 'Posted'} {friendlyDate(job.postedAt)}</span>}
          {job.category && <span>{job.category}</span>}
          {job.terms.length > 0 && <span>{job.terms.join(', ')}</span>}
          {job.sponsorship && job.sponsorship !== 'Other' && <span>{job.sponsorship}</span>}
          {!job.active && <span className="text-amber-600 dark:text-amber-400">no longer listed</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {job.url && (
            <Button asChild size="sm" variant="secondary">
              <a href={job.url} target="_blank" rel="noreferrer">Open posting <ExternalLink className="size-3.5" /></a>
            </Button>
          )}
          <StageSelect value={job.state} allowUntracked onChange={(v) => save({ state: v }, v === 'new' ? 'Removed from tracker' : `Moved to ${JOB_STATE_LABELS[v]}`)} className="h-8" />
          {!manual && job.state !== 'hidden' && (
            <Button size="sm" variant="ghost" title="Hide from the feed" onClick={() => save({ state: 'hidden' }, 'Hidden from the feed')}>
              <EyeOff className="size-3.5" /> Hide
            </Button>
          )}
          {manual && (
            <Button size="sm" variant="ghost" className="text-destructive" title="Delete this entry" onClick={() => del.mutate(job.id, { onSuccess: () => { toast.success('Deleted'); close(); }, onError: (e) => toast.error(e.message) })}>
              <Trash2 className="size-3.5" /> Delete
            </Button>
          )}
        </div>
      </SheetHeader>

      <div className="min-h-0 flex-1 space-y-4 overflow-auto px-4 py-4">
        {!tracked && <p className="text-xs text-muted-foreground">Pick a stage above to start tracking this one. Notes are saved either way.</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <SavedField label="Applied on" type="date" value={job.appliedAt} onSave={(v) => save({ appliedAt: v })} />
          <SavedField label="Next action date" type="date" value={job.nextActionAt} onSave={(v) => save({ nextActionAt: v })} />
          <div className="sm:col-span-2">
            <SavedField label="Next action" value={job.nextAction} placeholder="Follow up with recruiter, OA due Friday…" onSave={(v) => save({ nextAction: v })} />
          </div>
          <div className="sm:col-span-2">
            <SavedField label="Notes" multiline value={job.notes} placeholder="Contacts, what was asked, what to prep." onSave={(v) => save({ notes: v })} />
          </div>
          <div className="sm:col-span-2">
            <SavedField label="Resume used (path or name)" value={job.resumePath} placeholder="resumes/acme-swe.pdf" onSave={(v) => save({ resumePath: v })} />
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {tracked && job.stateUpdatedAt ? `Last change ${friendlyDate(job.stateUpdatedAt, { withTime: true })} · ` : ''}
          {manual ? `added ${friendlyDate(job.firstSeenAt)}` : `in the feed since ${friendlyDate(job.firstSeenAt)}`}
        </p>
      </div>
    </div>
  );
}
