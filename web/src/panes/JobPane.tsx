import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Copy, EyeOff, ExternalLink, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import type { Job } from '@collected/shared';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SheetClose, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { isReservedStage, stageIdFrom, stageLabel } from '@/lib/jobStages';
import { duplicateOf, useCreateJob, useDeleteJob, useJob, useJobFind, useJobStages, usePatchJobState } from '@/lib/queries';
import { friendlyDate } from '@/lib/time';
import { cn } from '@/lib/utils';
import { safeHref } from '@/lib/url';
import { usePane } from './PaneContext';

const todayLocal = () => new Date().toLocaleDateString('en-CA');
const NEW_STAGE = '__new_stage__';

/**
 * Native select: small, keyboard friendly, no portal fights inside the sheet. Stages come from the setting, open and
 * closed in their order; the last option, "New stage…", turns the select into a small input whose Enter picks the
 * typed stage (the server appends an unknown one to the list as open).
 */
export function StageSelect({ value, onChange, className, allowUntracked }: { value: string; onChange(v: string): void; className?: string; allowUntracked?: boolean }) {
  const { stages } = useJobStages();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const open = stages.filter((s) => s.kind === 'open');
  const closed = stages.filter((s) => s.kind === 'closed');
  const known = isReservedStage(value) || stages.some((s) => s.id === value);
  const stop = { onMouseDown: (e: React.MouseEvent) => e.stopPropagation(), onClick: (e: React.MouseEvent) => e.stopPropagation() };

  if (adding) {
    const id = stageIdFrom(draft);
    const commit = () => {
      setAdding(false);
      setDraft('');
      if (!id) return;
      if (isReservedStage(id)) return void toast.error(`"${id}" is a feed marker, not a stage`);
      onChange(id);
    };
    return (
      <input
        autoFocus
        value={draft}
        placeholder="stage name"
        aria-label="New stage"
        maxLength={40}
        title={id ? `Saves as "${id}"` : 'Lowercase, Enter to save, Escape to cancel'}
        onChange={(e) => setDraft(e.target.value.toLowerCase())}
        onKeyDown={(e) => {
          e.stopPropagation(); // a card's Enter opens the pane
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            setAdding(false);
            setDraft('');
          }
        }}
        onBlur={() => {
          setAdding(false);
          setDraft('');
        }}
        {...stop}
        className={cn('h-7 w-28 rounded-[10px] border border-line2 bg-surface px-1.5 font-mono text-xs outline-none focus:border-brand', className, 'opacity-100')}
      />
    );
  }

  return (
    <select
      value={value}
      onChange={(e) => (e.target.value === NEW_STAGE ? setAdding(true) : onChange(e.target.value))}
      {...stop}
      className={cn('h-7 rounded-[10px] border border-line2 bg-well px-1.5 text-xs', className)}
      aria-label="Stage"
    >
      {allowUntracked && <option value="new">Not tracked</option>}
      {value === 'hidden' && <option value="hidden">Hidden</option>}
      <optgroup label="Open">
        <option value="starred">{stageLabel(stages, 'starred')}</option>
        {open.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        {!known && <option value={value}>{stageLabel(stages, value)}</option>}
      </optgroup>
      {closed.length > 0 && <optgroup label="Closed">{closed.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</optgroup>}
      <option value={NEW_STAGE}>New stage…</option>
    </select>
  );
}

/**
 * Text field that saves on blur (or Enter for single-line), so notes don't need a Save button. Closing the pane
 * unmounts the field without a blur, so it also commits on unmount; refs hold the latest draft and save target.
 */
function SavedField({ label, value, onSave, multiline, type, placeholder, mono }: { label: string; value: string | null; onSave(v: string | null): void; multiline?: boolean; type?: string; placeholder?: string; mono?: boolean }) {
  const [draft, setDraft] = useState(value ?? '');
  useEffect(() => setDraft(value ?? ''), [value]);
  const latest = useRef({ draft, value, onSave });
  latest.current = { draft, value, onSave };
  const commit = () => {
    const { draft: d, value: before, onSave: save } = latest.current;
    const v = d.trim() || null;
    if (v !== (before ?? null)) {
      latest.current.value = v; // a blur and then an unmount must not save twice
      save(v);
    }
  };
  useEffect(() => () => commit(), []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {multiline ? (
        <Textarea rows={4} value={draft} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} onBlur={commit} className="text-sm" />
      ) : (
        <Input type={type} value={draft} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} className={cn('h-8 text-sm', mono && 'font-mono')} />
      )}
    </div>
  );
}

/** The value after `ms` of quiet. */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

const isHttpUrl = (s: string) => /^https?:\/\/[^\s/]+\.[^\s]+$/i.test(s.trim());
/** What was pasted in the URL field: a URL (a bare host gets https), a req id (no dots, slashes or spaces), or neither yet. */
function readPasted(raw: string): { url?: string; reqId?: string } {
  const s = raw.trim();
  if (!s) return {};
  if (/^https?:\/\//i.test(s)) return { url: s };
  if (/^[^\s/.]+$/.test(s)) return { reqId: s };
  if (/^[^\s/]+\.[^\s]+$/.test(s)) return { url: `https://${s}` };
  return {};
}

/** "Already here" for a URL or req id that is stored: open it instead of adding a second copy. */
function DuplicateNote({ job, by }: { job: Job; by: 'url' | 'req' | 'server' }) {
  const { open } = usePane();
  const { stages } = useJobStages();
  const tracked = job.state !== 'new' && job.state !== 'hidden';
  return (
    <div role="status" className="space-y-2 rounded-[14px] bg-[color-mix(in_srgb,var(--caution)_10%,var(--well))] p-3 text-sm sm:col-span-2">
      <p className="min-w-0">
        <span className="font-semibold">Already here:</span> {job.company} · <span className="text-sub">{job.title}</span>
      </p>
      <p className="text-xs text-sub">
        {tracked ? `Tracked as ${stageLabel(stages, job.state)}` : job.state === 'hidden' ? 'Hidden from the feed' : 'In the feed, not tracked yet'}
        {by === 'url' ? ', same posting URL.' : by === 'req' ? ', same req id.' : '.'}
      </p>
      <Button type="button" size="sm" onClick={() => open({ kind: 'job', jobId: job.id })}>Open the existing entry</Button>
    </div>
  );
}

/**
 * Add a job by hand, URL first: the pasted link (or req id) is looked up as it is typed, and a stored match is offered
 * instead of a duplicate. The server checks again on submit (409); "Add anyway" forces it.
 */
function NewJobForm() {
  const create = useCreateJob();
  const { open } = usePane();
  const [f, setF] = useState({ company: '', title: '', url: '', reqId: '', locations: '', state: 'applied', appliedAt: todayLocal(), notes: '' });
  const [conflict, setConflict] = useState<Job | null>(null);
  const url = useDebounced(isHttpUrl(f.url) ? f.url.trim() : '', 350);
  const req = useDebounced(f.reqId.trim(), 350);
  const byUrl = useJobFind('url', url);
  const byReq = useJobFind('req', req);
  const found = conflict ? { job: conflict, by: 'server' as const } : byUrl.data ? { job: byUrl.data, by: 'url' as const } : byReq.data ? { job: byReq.data, by: 'req' as const } : null;

  // A pasted req id belongs in its own field; a bare host becomes a link.
  const settleUrl = () => {
    const r = readPasted(f.url);
    if (r.reqId && !f.reqId.trim()) setF((x) => ({ ...x, url: '', reqId: r.reqId! }));
    else if (r.url && r.url !== f.url.trim()) setF((x) => ({ ...x, url: r.url! }));
  };
  const edit = (patch: Partial<typeof f>) => {
    setF((x) => ({ ...x, ...patch }));
    if ('url' in patch || 'reqId' in patch) setConflict(null);
  };

  const submit = (force: boolean) => {
    const r = readPasted(f.url);
    create.mutate(
      {
        company: f.company,
        title: f.title,
        url: r.url ?? '',
        reqId: f.reqId.trim() || r.reqId || null,
        locations: f.locations.split(',').map((x) => x.trim()).filter(Boolean),
        state: f.state,
        appliedAt: f.appliedAt || null,
        notes: f.notes.trim() || null,
        force,
      },
      {
        onSuccess: (job) => { toast.success(`Added ${job.company}`); open({ kind: 'job', jobId: job.id }); },
        onError: (err) => {
          const existing = duplicateOf(err);
          if (existing) setConflict(existing);
          else toast.error(err.message);
        },
      },
    );
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!found) submit(false);
  };
  const ready = !create.isPending && !!f.company.trim() && !!f.title.trim();

  return (
    <form onSubmit={onSubmit} className="flex h-full min-h-0 flex-col">
      <SheetHeader className="shrink-0 gap-1.5 px-6 pb-3 pt-6">
        <div className="flex items-center gap-2.5">
          <SheetTitle className="text-[26px] font-[620] leading-tight tracking-[-0.025em]">Add a job</SheetTitle>
          <span className="flex-1" />
          <SheetClose className="orb size-8" aria-label="Close"><X className="size-3.5" /></SheetClose>
        </div>
        <SheetDescription className="text-[14px] text-sub">Something outside the feed: a referral, a career-fair lead, a company site. Paste the link first; if it is already here, you'll see it.</SheetDescription>
      </SheetHeader>
      <div className="grid content-start gap-3 overflow-auto px-[18px] py-[18px] sm:grid-cols-2">
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="job-url" className="text-xs text-muted-foreground">Posting URL</Label>
          <Input id="job-url" autoFocus inputMode="url" value={f.url} onChange={(e) => edit({ url: e.target.value })} onBlur={settleUrl} onPaste={() => window.setTimeout(settleUrl, 0)} className="h-8 text-sm" placeholder="https://… or a req id" />
        </div>
        {found && <DuplicateNote job={found.job} by={found.by} />}
        <div className="space-y-1"><Label htmlFor="job-company" className="text-xs text-muted-foreground">Company</Label><Input id="job-company" required value={f.company} onChange={(e) => edit({ company: e.target.value })} className="h-8 text-sm" /></div>
        <div className="space-y-1"><Label htmlFor="job-title" className="text-xs text-muted-foreground">Title</Label><Input id="job-title" required value={f.title} onChange={(e) => edit({ title: e.target.value })} className="h-8 text-sm" placeholder="Software Engineer Intern" /></div>
        <div className="space-y-1"><Label htmlFor="job-req" className="text-xs text-muted-foreground">Req id</Label><Input id="job-req" value={f.reqId} onChange={(e) => edit({ reqId: e.target.value.replace(/\s/g, '') })} className="h-8 font-mono text-sm" placeholder="R0123456" maxLength={80} /></div>
        <div className="space-y-1"><Label htmlFor="job-locations" className="text-xs text-muted-foreground">Locations (comma-separated)</Label><Input id="job-locations" value={f.locations} onChange={(e) => edit({ locations: e.target.value })} className="h-8 text-sm" placeholder="College Park, MD, Remote" /></div>
        <div className="space-y-1"><Label className="text-xs text-muted-foreground">Stage</Label><StageSelect value={f.state} onChange={(v) => edit({ state: v })} className="h-8 w-full" /></div>
        <div className="space-y-1"><Label htmlFor="job-applied" className="text-xs text-muted-foreground">Applied on</Label><Input id="job-applied" type="date" value={f.appliedAt} onChange={(e) => edit({ appliedAt: e.target.value })} className="h-8 text-sm" /></div>
        <div className="space-y-1 sm:col-span-2"><Label htmlFor="job-notes" className="text-xs text-muted-foreground">Notes</Label><Textarea id="job-notes" rows={3} value={f.notes} onChange={(e) => edit({ notes: e.target.value })} className="text-sm" placeholder="Who referred you, what they said, the deadline…" /></div>
      </div>
      <div className="mt-auto flex justify-end gap-2 border-t border-line p-4">
        {found ? (
          <Button type="button" variant="secondary" disabled={!ready} onClick={() => submit(true)} title="Store a second entry next to the existing one">Add anyway</Button>
        ) : (
          <Button type="submit" disabled={!ready}>Add to tracker</Button>
        )}
      </div>
    </form>
  );
}

/** The req id as a mono chip: one click copies it. */
function ReqChip({ reqId }: { reqId: string }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(reqId);
      toast.success(`Copied ${reqId}`);
    } catch {
      toast.error('Could not copy');
    }
  };
  return (
    <button type="button" onClick={copy} title="Req id: click to copy" aria-label={`Req id ${reqId}, copy`} className="group/req inline-flex h-[22px] min-w-0 max-w-[12rem] shrink items-center gap-1 rounded-full bg-well px-2 font-mono text-[11px] text-sub transition-colors hover:bg-well2 hover:text-ink">
      <span className="truncate">{reqId}</span>
      <Copy className="size-3 shrink-0 opacity-60 group-hover/req:opacity-100" />
    </button>
  );
}

/** One job, feed or manual: the posting's details plus every tracker field, editable in place. */
export function JobPane({ jobId }: { jobId: string | null }) {
  const q = useJob(jobId);
  const patch = usePatchJobState();
  const del = useDeleteJob();
  const { stages } = useJobStages();
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
      {/* The same header as the course pane: no band behind it, borderless orbs, the title at 26px. */}
      <SheetHeader className="shrink-0 gap-1.5 px-6 pb-3 pt-6">
        <div className="flex items-center gap-2.5">
          <SheetTitle className="min-w-0 truncate text-[26px] font-[620] leading-tight tracking-[-0.025em]">{job.company}</SheetTitle>
          <span className="label shrink-0 rounded-full bg-well px-2 py-0.5">{manual ? 'Manual' : 'Feed'}</span>
          {job.reqId && <ReqChip reqId={job.reqId} />}
          <span className="flex-1" />
          <SheetClose className="orb size-8 shrink-0" aria-label="Close"><X className="size-3.5" /></SheetClose>
        </div>
        <SheetDescription className="truncate text-[15px] text-sub">{job.title}</SheetDescription>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {job.locations.length > 0 && <span>{job.locations.join(' · ')}</span>}
          {job.postedAt && <span>{manual ? 'Added' : 'Posted'} {friendlyDate(job.postedAt)}</span>}
          {job.category && <span>{job.category}</span>}
          {job.terms.length > 0 && <span>{job.terms.join(', ')}</span>}
          {job.sponsorship && job.sponsorship !== 'Other' && <span>{job.sponsorship}</span>}
          {!job.active && <span className="text-caution">no longer listed</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {safeHref(job.url) && (
            <Button asChild size="sm" variant="secondary">
              <a href={safeHref(job.url)} target="_blank" rel="noreferrer">Open posting <ExternalLink className="size-3.5" /></a>
            </Button>
          )}
          <StageSelect value={job.state} allowUntracked onChange={(v) => save({ state: v }, v === 'new' ? 'Removed from tracker' : `Moved to ${stageLabel(stages, v)}`)} className="h-8" />
          {!manual && job.state !== 'hidden' && (
            <Button size="sm" variant="ghost" title="Hide from the feed" onClick={() => save({ state: 'hidden' }, 'Hidden from the feed')}>
              <EyeOff className="size-3.5" /> Hide
            </Button>
          )}
          {manual && (
            <ConfirmDialog
              trigger={(open) => (
                <Button size="sm" variant="ghost" className="text-critical hover:text-critical" title="Delete this entry" onClick={open} disabled={del.isPending}>
                  <Trash2 className="size-3.5" /> Delete
                </Button>
              )}
              title={`Delete ${job.company}?`}
              description="This entry, its stage and its notes are removed from the tracker. It was added by hand, so no sync brings it back."
              confirmLabel="Delete"
              destructive
              onConfirm={() =>
                del.mutateAsync(job.id, {
                  onSuccess: () => {
                    toast.success(`Deleted ${job.company}`);
                    close();
                  },
                  onError: (e) => toast.error(`Could not delete: ${e.message}`),
                })
              }
            />
          )}
        </div>
      </SheetHeader>

      <div className="min-h-0 flex-1 space-y-4 overflow-auto px-[18px] py-[18px]">
        {!tracked && <p className="text-xs text-muted-foreground">Pick a stage above to start tracking this one. Notes are saved either way.</p>}
        {/* Keyed by job: switching jobs remounts the fields, so an unsaved edit commits to the job it was typed for. */}
        <div key={job.id} className="grid gap-3 sm:grid-cols-2">
          <SavedField label="Applied on" type="date" value={job.appliedAt} onSave={(v) => save({ appliedAt: v })} />
          <SavedField label="Next action date" type="date" value={job.nextActionAt} onSave={(v) => save({ nextActionAt: v })} />
          <div className="sm:col-span-2">
            <SavedField label="Next action" value={job.nextAction} placeholder="Follow up with recruiter, OA due Friday…" onSave={(v) => save({ nextAction: v })} />
          </div>
          <div className="sm:col-span-2">
            <SavedField label="Notes" multiline value={job.notes} placeholder="Contacts, what was asked, what to prep." onSave={(v) => save({ notes: v })} />
          </div>
          <SavedField label="Req id" mono value={job.reqId} placeholder="R0123456" onSave={(v) => save({ reqId: v })} />
          <SavedField label="Resume used (path or name)" value={job.resumePath} placeholder="resumes/acme-swe.pdf" onSave={(v) => save({ resumePath: v })} />
        </div>
        <p className="text-[11px] text-muted-foreground">
          {tracked && job.stateUpdatedAt ? `Last change ${friendlyDate(job.stateUpdatedAt, { withTime: true })} · ` : ''}
          {manual ? `added ${friendlyDate(job.firstSeenAt)}` : `in the feed since ${friendlyDate(job.firstSeenAt)}`}
        </p>
      </div>
    </div>
  );
}
