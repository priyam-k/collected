import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { COURSE_ROLES, SUBMITS_VIA, type Course, type CourseInput, type CourseLink } from '@collected/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useCourses, useDeleteCourse, useSaveCourse } from '@/lib/queries';
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
                    <span className="mr-2 inline-block size-2.5 rounded-full align-middle" style={{ background: c.color ?? '#999' }} />
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
                <Field label="Schedule (JSON)" hint={'{"discussion":[{"day":"fri","start":"11:00","end":"11:50"}],"office_hours":[]}'}>
                  <Textarea rows={4} className="font-mono text-xs" value={draft.scheduleText} onChange={(e) => setDraft({ ...draft, scheduleText: e.target.value })} />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Notes">
                  <Textarea rows={2} value={draft.notes ?? ''} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
                </Field>
              </div>
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
