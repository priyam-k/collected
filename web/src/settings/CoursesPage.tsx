import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { COURSE_ROLES, SUBMITS_VIA, courseScheduleSchema, type Course, type CourseInput, type CourseLink, type CourseSchedule } from '@collected/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useCourseLinks, useCourses, useDeleteCourse, useLinkItems, useSaveCourse } from '@/lib/queries';
import { friendlyDate } from '@/lib/time';
import { safeColor } from '@/lib/color';
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

  const currentTerm = q.data?.[0]?.term ?? '2026-fall';

  const submit = () => {
    if (!draft) return;
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
      <div className="mb-3 flex justify-end">
        <Button size="sm" onClick={() => setDraft(blank(currentTerm))}>
          <Plus className="size-4" /> Add course
        </Button>
      </div>
      {q.isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
      {q.data && (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Course</th>
                <th className="px-3 py-2">Role</th>
                <th className="px-3 py-2">Submits via</th>
                <th className="px-3 py-2">Canvas id</th>
                <th className="px-3 py-2">Gradescope id</th>
                <th className="px-3 py-2">Links</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {q.data.map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="px-3 py-2">
                    <span className="mr-2 inline-block size-2.5 rounded-full align-middle" style={{ background: safeColor(c.color) ?? '#999' }} />
                    <span className="font-medium">{c.code}</span>
                    {c.section && <span className="text-muted-foreground"> · {c.section}</span>}
                    {c.name && <div className="text-xs text-muted-foreground">{c.name}</div>}
                    {c.archived && <span className="ml-1 text-xs text-muted-foreground">(archived)</span>}
                  </td>
                  <td className="px-3 py-2 uppercase text-xs">{c.role}</td>
                  <td className="px-3 py-2">{c.submitsVia}</td>
                  <td className="px-3 py-2 font-mono text-xs">{c.canvasCourseId ?? <span className="text-muted-foreground">auto</span>}</td>
                  <td className="px-3 py-2 font-mono text-xs">{c.gradescopeCourseId ?? <span className="text-muted-foreground">auto</span>}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{c.links.length || '—'}</td>
                  <td className="px-3 py-2 text-right">
                    <Button size="icon-sm" variant="ghost" aria-label="Edit" onClick={() => setDraft(toDraft(c))}>
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Delete"
                      onClick={() => {
                        if (window.confirm(`Delete ${c.code}? Items stay; the course link is removed.`)) del.mutate(c.id);
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="max-h-[90vh] overflow-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{draft?.id ? `Edit ${draft.code}` : 'Add course'}</DialogTitle>
            <DialogDescription>Ids are filled automatically by the ingesters when a course can be matched unambiguously.</DialogDescription>
          </DialogHeader>
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
                  <SelectContent>{COURSE_ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Submits via" hint="Which system is authoritative for done state.">
                <Select value={draft.submitsVia} onValueChange={(v) => setDraft({ ...draft, submitsVia: v as Draft['submitsVia'] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{SUBMITS_VIA.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
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
                      <Input value={l.label} placeholder="Syllabus" onChange={(e) => setDraft({ ...draft, links: draft.links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} className="w-40" />
                      <Input value={l.url} placeholder="https://…" onChange={(e) => setDraft({ ...draft, links: draft.links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })} />
                      <Button size="icon" variant="ghost" aria-label="Remove link" onClick={() => setDraft({ ...draft, links: draft.links.filter((_, j) => j !== i) })}>
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  ))}
                  <Button size="sm" variant="secondary" onClick={() => setDraft({ ...draft, links: [...draft.links, { label: '', url: '' }] })}>
                    <Plus className="size-3.5" /> Add link
                  </Button>
                </div>
              </div>
              <div className="sm:col-span-2">
                <ScheduleField text={draft.scheduleText} onText={(t) => setDraft({ ...draft, scheduleText: t })} />
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
            <Button variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
            <Button onClick={submit} disabled={save.isPending || !draft?.code || !draft?.term}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}


/** Visual week editor over the schedule JSON, with the raw JSON one click away for anything the grid can't express. */
function ScheduleField({ text, onText }: { text: string; onText(t: string): void }) {
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
        <ScheduleEditor value={parsed} onChange={(next) => onText(JSON.stringify(next, null, 2))} />
      ) : (
        <p className="text-xs text-destructive">Schedule JSON is invalid ({error}). Fix it below to use the grid.</p>
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
    <div className="space-y-2 rounded-md border p-3">
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
              <Button size="xs" variant="ghost" onClick={() => link.mutate({ a: l.a, b: l.b, unlink: true })}>Unlink</Button>
            </li>
          ))}
        </ul>
      )}
      {freeCanvas.length > 0 && freeGs.length > 0 && (
        <div className="flex flex-wrap items-end gap-2 text-sm">
          <select className="h-8 min-w-40 flex-1 rounded-md border bg-background px-2 text-sm" value={pick.a} onChange={(e) => setPick({ ...pick, a: e.target.value })}>
            <option value="">Canvas assignment…</option>
            {freeCanvas.map((x) => <option key={x.id} value={x.id}>{x.title}{x.dueAt ? ` · ${friendlyDate(x.dueAt)}` : ''}</option>)}
          </select>
          <select className="h-8 min-w-40 flex-1 rounded-md border bg-background px-2 text-sm" value={pick.b} onChange={(e) => setPick({ ...pick, b: e.target.value })}>
            <option value="">Gradescope assignment…</option>
            {freeGs.map((x) => <option key={x.id} value={x.id}>{x.title}{x.dueAt ? ` · ${friendlyDate(x.dueAt)}` : ''}</option>)}
          </select>
          <Button size="sm" variant="secondary" disabled={!pick.a || !pick.b || link.isPending} onClick={() => { link.mutate({ a: pick.a, b: pick.b }); setPick({ a: '', b: '' }); }}>Link</Button>
        </div>
      )}
    </div>
  );
}
