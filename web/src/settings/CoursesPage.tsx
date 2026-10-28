import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Download, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { COURSE_ROLES, SUBMITS_VIA, courseScheduleSchema, type Course, type CourseInput, type CourseLink, type CourseSchedule } from '@collected/shared';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useCourseLinks, useCourses, useDeleteCourse, useLinkItems, useSaveCourse } from '@/lib/queries';
import { friendlyDate } from '@/lib/time';
import { safeColor } from '@/lib/color';
import { ImportCoursesDialog } from './ImportCoursesDialog';
import { ROLE_LABEL, SUBMITS_LABEL } from './labels';
import { ScheduleEditor } from './ScheduleEditor';
import { Field, PageTitle } from './ui';

type Draft = Omit<CourseInput, 'links' | 'schedule'> & { id?: string; links: CourseLink[]; scheduleText: string };

const blank = (term: string): Draft => ({
  term,
  code: '',
  section: '',
  name: '',
  role: 'student',
  canvasCourseId: '',
  gradescopeCourseId: '',
  submitsVia: 'both',
  color: '#2563eb',
  links: [],
  scheduleText: '{}',
  notes: '',
  archived: false,
});

const toDraft = (c: Course): Draft => ({
  id: c.id,
  term: c.term,
  code: c.code,
  section: c.section ?? '',
  name: c.name ?? '',
  role: c.role,
  canvasCourseId: c.canvasCourseId ?? '',
  gradescopeCourseId: c.gradescopeCourseId ?? '',
  submitsVia: c.submitsVia,
  color: c.color ?? '#2563eb',
  links: c.links,
  scheduleText: JSON.stringify(c.schedule, null, 2),
  notes: c.notes ?? '',
  archived: c.archived,
});

export function CoursesPage() {
  const q = useCourses();
  const save = useSaveCourse();
  const del = useDeleteCourse();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [importing, setImporting] = useState(false);
  // `?edit=<course id>` (the course pane's edit button) opens that course's editor; the param is dropped once used.
  const [params, setParams] = useSearchParams();
  const editId = params.get('edit');
  useEffect(() => {
    if (!editId || !q.data) return;
    const c = q.data.find((x) => x.id === editId);
    if (c) openDraft(toDraft(c));
    setParams((p) => {
      p.delete('edit');
      return p;
    }, { replace: true });
  }, [editId, q.data, setParams]);
  // `?import=1` (the dashboard's first-run card) opens the Canvas import straight away; dropped once used.
  const wantsImport = params.get('import') === '1';
  useEffect(() => {
    if (!wantsImport) return;
    setImporting(true);
    setParams((p) => {
      p.delete('import');
      return p;
    }, { replace: true });
  }, [wantsImport, setParams]);

  // What the editor opened with, to tell a dirty draft from an untouched one before closing it.
  const [opened, setOpened] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const openDraft = (d: Draft) => {
    setDraft(d);
    setOpened(JSON.stringify(d));
  };
  const dirty = !!draft && JSON.stringify(draft) !== opened;
  /** Escape, a click outside and Cancel ask first when there are edits; Save is the only quiet way out. */
  const requestClose = () => (dirty ? setConfirmDiscard(true) : setDraft(null));

  const currentTerm = q.data?.[0]?.term ?? '2026-fall';

  const remove = (c: Course) =>
    del.mutateAsync(c.id, {
      onSuccess: () => toast.success(`Deleted ${c.code}`),
      onError: (e) => toast.error(`Could not delete ${c.code}: ${e.message}`),
    });

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!draft || save.isPending || !draft.code || !draft.term) return;
    let schedule: unknown = {};
    try {
      schedule = JSON.parse(draft.scheduleText || '{}');
    } catch {
      toast.error('Schedule must be valid JSON');
      return;
    }
    const { scheduleText, id, ...rest } = draft;
    save.mutate(
      {
        id,
        ...rest,
        section: rest.section || null,
        name: rest.name || null,
        canvasCourseId: rest.canvasCourseId || null,
        gradescopeCourseId: rest.gradescopeCourseId || null,
        notes: rest.notes || null,
        schedule: schedule as CourseInput['schedule'],
      },
      { onSuccess: () => { toast.success('Saved'); setDraft(null); }, onError: (e) => toast.error(e.message) },
    );
  };

  return (
    <div>
      <PageTitle sub="Per-class personalization: ids for matching, where it submits, hotlinks, schedule.">Courses</PageTitle>
      <div className="mb-3 flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={() => setImporting(true)}>
          <Download className="size-4" /> Import from Canvas
        </Button>
        <Button onClick={() => openDraft(blank(currentTerm))}>
          <Plus className="size-4" /> Add course
        </Button>
      </div>
      {q.isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
      {q.isError && <p className="text-sm text-critical">Could not load courses: {q.error.message}</p>}
      {q.data && (
        <div className="overflow-x-auto rounded-2xl bg-well/60">
          <table className="w-full text-sm">
            {/* Ids, submits-via and link counts are secondary; on a phone they go so the course name keeps its width. */}
            <thead className="text-left text-xs text-sub">
              <tr>
                <th className="px-3 py-2.5 font-[560]">Course</th>
                <th className="px-3 py-2.5 font-[560]">Role</th>
                <th className="hidden px-3 py-2.5 font-[560] sm:table-cell">Submits via</th>
                <th className="hidden px-3 py-2.5 font-[560] md:table-cell">Canvas id</th>
                <th className="hidden px-3 py-2.5 font-[560] md:table-cell">Gradescope id</th>
                <th className="hidden px-3 py-2.5 font-[560] sm:table-cell">Links</th>
                <th className="px-3 py-2.5"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {q.data.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-[13px] text-sub">
                    No courses yet. Import them from Canvas or add one by hand.
                  </td>
                </tr>
              )}
              {q.data.map((c) => (
                <tr key={c.id}>
                  <td className="px-3 py-2">
                    <span className="mr-2 inline-block size-2.5 rounded-full align-middle" style={{ background: safeColor(c.color) ?? 'var(--ink-faint)' }} />
                    <span className="font-medium">{c.code}</span>
                    {c.section && <span className="text-muted-foreground"> · {c.section}</span>}
                    {c.name && <div className="text-xs text-muted-foreground">{c.name}</div>}
                    {c.archived && <span className="ml-1 text-xs text-muted-foreground">(archived)</span>}
                  </td>
                  <td className="px-3 py-2 text-xs">{ROLE_LABEL[c.role]}</td>
                  <td className="hidden px-3 py-2 sm:table-cell">{SUBMITS_LABEL[c.submitsVia]}</td>
                  <td className="hidden px-3 py-2 font-mono text-xs md:table-cell">{c.canvasCourseId ?? <span className="text-muted-foreground">auto</span>}</td>
                  <td className="hidden px-3 py-2 font-mono text-xs md:table-cell">{c.gradescopeCourseId ?? <span className="text-muted-foreground">auto</span>}</td>
                  <td className="hidden px-3 py-2 text-xs text-muted-foreground sm:table-cell">{c.links.length || '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <Button size="icon-sm" variant="ghost" aria-label={`Edit ${c.code}`} onClick={() => openDraft(toDraft(c))}>
                      <Pencil className="size-3.5" />
                    </Button>
                    <ConfirmDialog
                      trigger={(open) => (
                        <Button size="icon-sm" variant="ghost" aria-label={`Delete ${c.code}`} onClick={open} disabled={del.isPending && del.variables === c.id}>
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                      title={`Delete ${c.code}?`}
                      description="Its assignments and events stay; the link to this course is removed."
                      confirmLabel="Delete"
                      destructive
                      onConfirm={() => remove(c)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ImportCoursesDialog open={importing} onOpenChange={setImporting} />
      <Dialog open={!!draft} onOpenChange={(o) => !o && requestClose()}>
        <DialogContent className="max-h-[90vh] overflow-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{draft?.id ? `Edit ${draft.code}` : 'Add course'}</DialogTitle>
            <DialogDescription>Ids are filled automatically by the ingesters when a course can be matched unambiguously.</DialogDescription>
          </DialogHeader>
          {/* A form so Enter in a field saves; every other button in here is type="button". */}
          <form onSubmit={submit} className="grid gap-4">
          {draft && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Term">
                <Input value={draft.term} onChange={(e) => setDraft({ ...draft, term: e.target.value })} disabled={!!draft.id} />
              </Field>
              <Field label="Code">
                <Input value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} placeholder="CMSC422" disabled={!!draft.id} />
              </Field>
              <Field label="Section">
                <Input value={draft.section ?? ''} onChange={(e) => setDraft({ ...draft, section: e.target.value })} placeholder="0101" disabled={!!draft.id} />
              </Field>
              <Field label="Name">
                <Input value={draft.name ?? ''} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </Field>
              <Field label="Role">
                <Select value={draft.role} onValueChange={(v) => setDraft({ ...draft, role: v as Draft['role'] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{COURSE_ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Submits via" hint="Which system is authoritative for done state.">
                <Select value={draft.submitsVia} onValueChange={(v) => setDraft({ ...draft, submitsVia: v as Draft['submitsVia'] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{SUBMITS_VIA.map((r) => <SelectItem key={r} value={r}>{SUBMITS_LABEL[r]}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Canvas course id">
                <Input value={draft.canvasCourseId ?? ''} onChange={(e) => setDraft({ ...draft, canvasCourseId: e.target.value })} placeholder="auto" />
              </Field>
              <Field label="Gradescope course id">
                <Input value={draft.gradescopeCourseId ?? ''} onChange={(e) => setDraft({ ...draft, gradescopeCourseId: e.target.value })} placeholder="auto" />
              </Field>
              <Field label="Color">
                <Input type="color" value={draft.color ?? '#2563eb'} onChange={(e) => setDraft({ ...draft, color: e.target.value })} className="h-9 w-20 p-1" />
              </Field>
              <label className="flex items-center gap-2 self-end text-sm">
                <Switch checked={draft.archived} onCheckedChange={(v) => setDraft({ ...draft, archived: v })} /> Archived
              </label>
              <div className="sm:col-span-2">
                <span className="text-sm font-medium">Hotlinks</span>
                <div className="mt-1.5 space-y-2">
                  {draft.links.map((l, i) => (
                    <div key={i} className="flex gap-2">
                      <Input value={l.label} placeholder="Syllabus" onChange={(e) => setDraft({ ...draft, links: draft.links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} className="w-28 shrink-0 sm:w-40" />
                      <Input value={l.url} placeholder="https://…" onChange={(e) => setDraft({ ...draft, links: draft.links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })} />
                      <Button type="button" size="icon" variant="ghost" aria-label="Remove link" onClick={() => setDraft({ ...draft, links: draft.links.filter((_, j) => j !== i) })}>
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  ))}
                  <Button type="button" size="sm" variant="secondary" onClick={() => setDraft({ ...draft, links: [...draft.links, { label: '', url: '' }] })}>
                    <Plus className="size-3.5" /> Add link
                  </Button>
                </div>
              </div>
              <div className="sm:col-span-2">
                <ScheduleField text={draft.scheduleText} color={draft.color} onText={(t) => setDraft({ ...draft, scheduleText: t })} />
              </div>
              <div className="sm:col-span-2">
                <Field label="Notes">
                  <Textarea rows={2} value={draft.notes ?? ''} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
                </Field>
              </div>
              {draft.id && (
                <div className="sm:col-span-2">
                  <LinkedAssignments courseId={draft.id} />
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={requestClose}>Cancel</Button>
            <Button type="submit" disabled={save.isPending || !draft?.code || !draft?.term}>{save.isPending ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title="Discard your changes?"
        description={draft?.id ? `The edits to ${draft.code} have not been saved.` : 'This course has not been saved.'}
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        destructive
        onConfirm={() => setDraft(null)}
      />
    </div>
  );
}


/** Visual week editor over the schedule JSON, with the raw JSON one click away for anything the grid can't express. */
function ScheduleField({ text, color, onText }: { text: string; color?: string | null; onText(t: string): void }) {
  const [showJson, setShowJson] = useState(false);
  let parsed: CourseSchedule | null = null;
  let error: string | null = null;
  try {
    const r = courseScheduleSchema.safeParse(JSON.parse(text || '{}'));
    if (r.success) parsed = r.data;
    else error = r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
  } catch {
    error = 'not valid JSON';
  }
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium">Schedule</span>
        <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => setShowJson((v) => !v)}>
          {showJson ? 'Hide JSON' : 'Edit as JSON'}
        </button>
      </div>
      {parsed ? (
        <ScheduleEditor value={parsed} color={color} onChange={(next) => onText(JSON.stringify(next, null, 2))} />
      ) : (
        <p className="text-xs text-critical">Schedule JSON is invalid ({error}). Fix it below to use the grid.</p>
      )}
      {(showJson || !parsed) && (
        <Textarea rows={5} className="font-mono text-xs" value={text} onChange={(e) => onText(e.target.value)} placeholder={'{"lecture":[{"day":"tue","start":"09:30","end":"10:45","location":"IRB 0324"}]}'} />
      )}
    </div>
  );
}

/** Canvas ↔ Gradescope pairs for one course: auto links can be broken, unlinked rows can be paired by hand. */
function LinkedAssignments({ courseId }: { courseId: string }) {
  const q = useCourseLinks(courseId);
  const link = useLinkItems();
  const [pick, setPick] = useState<{ a: string; b: string }>({ a: '', b: '' });
  if (q.isPending) return <p className="text-xs text-muted-foreground">Loading assignments…</p>;
  if (q.isError || !q.data) return null;
  const { canvas, gradescope, links } = q.data;
  if (!canvas.length && !gradescope.length) return <p className="text-xs text-muted-foreground">No Canvas or Gradescope assignments synced for this course yet.</p>;
  const title = (id: string) => [...canvas, ...gradescope].find((x) => x.id === id)?.title ?? id;
  const linkedIds = new Set(links.flatMap((l) => [l.a, l.b]));
  const freeCanvas = canvas.filter((x) => !linkedIds.has(x.id));
  const freeGs = gradescope.filter((x) => !linkedIds.has(x.id));
  return (
    <div className="space-y-2 rounded-2xl bg-well/60 p-4">
      <div className="text-sm font-medium">Linked assignments</div>
      <p className="text-xs text-muted-foreground">Pairs count as one item; done on either side marks both done. Auto pairs come from title and due-date similarity.</p>
      {links.length > 0 && (
        <ul className="space-y-1 text-sm">
          {links.map((l) => (
            <li key={l.a + l.b} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate">{title(l.a)}</span>
              <span className="text-muted-foreground">↔</span>
              <span className="min-w-0 flex-1 truncate">{title(l.b)}</span>
              <span className="text-xs text-muted-foreground">{l.method}{l.confidence != null ? ` ${Math.round(l.confidence * 100)}%` : ''}</span>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                disabled={link.isPending}
                onClick={() =>
                  link.mutate({ a: l.a, b: l.b, unlink: true }, { onSuccess: () => toast.success('Unlinked'), onError: (e) => toast.error(`Could not unlink: ${e.message}`) })
                }
              >
                Unlink
              </Button>
            </li>
          ))}
        </ul>
      )}
      {freeCanvas.length > 0 && freeGs.length > 0 && (
        <div className="flex flex-wrap items-end gap-2 text-sm">
          <select aria-label="Canvas assignment" className="h-8 min-w-40 flex-1 rounded-[10px] bg-surface px-2 text-sm shadow-[inset_0_0_0_1px_var(--line)]" value={pick.a} onChange={(e) => setPick({ ...pick, a: e.target.value })}>
            <option value="">Canvas assignment…</option>
            {freeCanvas.map((x) => <option key={x.id} value={x.id}>{x.title}{x.dueAt ? ` · ${friendlyDate(x.dueAt)}` : ''}</option>)}
          </select>
          <select aria-label="Gradescope assignment" className="h-8 min-w-40 flex-1 rounded-[10px] bg-surface px-2 text-sm shadow-[inset_0_0_0_1px_var(--line)]" value={pick.b} onChange={(e) => setPick({ ...pick, b: e.target.value })}>
            <option value="">Gradescope assignment…</option>
            {freeGs.map((x) => <option key={x.id} value={x.id}>{x.title}{x.dueAt ? ` · ${friendlyDate(x.dueAt)}` : ''}</option>)}
          </select>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={!pick.a || !pick.b || link.isPending}
            onClick={() =>
              link.mutate(
                { a: pick.a, b: pick.b },
                {
                  onSuccess: () => {
                    toast.success('Linked');
                    setPick({ a: '', b: '' });
                  },
                  onError: (e) => toast.error(`Could not link: ${e.message}`),
                },
              )
            }
          >
            Link
          </Button>
        </div>
      )}
    </div>
  );
}
