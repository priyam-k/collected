import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, ExternalLink, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Course, GradeCategory, GradeCategoryResult, GradedAssignment } from '@collected/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCourseGrades, useSaveCourse } from '@/lib/queries';
import { friendlyDate } from '@/lib/time';
import { cn } from '@/lib/utils';
import { safeHref } from '@/lib/url';

const pct = (n: number | null | undefined, digits = 1): string => (n == null ? '—' : `${n.toFixed(digits)}%`);
const num = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function AssignmentRows({ list }: { list: GradedAssignment[] }) {
  if (!list.length) return <p className="px-2 py-1 text-xs text-muted-foreground/80">Nothing here yet.</p>;
  return (
    <ul className="divide-y">
      {list.map((a) => {
        const graded = a.score != null && !a.excused;
        return (
          <li key={a.id} className={cn('flex items-center gap-2 px-2 py-1 text-sm', (a.dropped || a.excused || a.omitFromFinal) && 'opacity-60')}>
            <span className={cn('min-w-0 flex-1 truncate', a.dropped && 'line-through')}>{a.title}</span>
            {a.dropped && <Badge variant="outline" className="h-4 px-1 text-[10px]">dropped</Badge>}
            {a.excused && <Badge variant="outline" className="h-4 px-1 text-[10px]">excused</Badge>}
            {a.omitFromFinal && <Badge variant="outline" className="h-4 px-1 text-[10px]">not counted</Badge>}
            <span className="w-24 shrink-0 text-right text-xs text-muted-foreground">{friendlyDate(a.dueAt)}</span>
            <span className="w-20 shrink-0 text-right tabular-nums">{graded ? `${num(a.score!)} / ${a.points != null ? num(a.points) : '?'}` : a.points != null ? <span className="text-muted-foreground">– / {num(a.points)}</span> : '—'}</span>
            <span className="w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{graded && a.points ? pct((a.score! / a.points) * 100, 0) : ''}</span>
            {safeHref(a.url) ? <a href={safeHref(a.url)} target="_blank" rel="noreferrer" className="shrink-0 text-muted-foreground hover:text-foreground" title="Open"><ExternalLink className="size-3" /></a> : <span className="w-3" />}
          </li>
        );
      })}
    </ul>
  );
}

function CategoryRow({ c, weighted }: { c: GradeCategoryResult; weighted: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-xl border border-line">
      <button type="button" className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-accent/60" onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />}
        <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
        {c.dropLowest > 0 && <span className="shrink-0 text-[10px] text-muted-foreground">drops {c.dropLowest}</span>}
        <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{weighted && c.weight != null ? `${num(c.weight)}%` : ''}</span>
        <span className="w-24 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{c.possible > 0 ? `${num(c.earned)} / ${num(c.possible)}` : `${c.graded}/${c.total} graded`}</span>
        <span className={cn('w-16 shrink-0 text-right tabular-nums', c.percent == null && 'text-muted-foreground')}>{pct(c.percent)}</span>
      </button>
      {open && <div className="border-t bg-muted/20"><AssignmentRows list={c.assignments} /></div>}
    </li>
  );
}

type Draft = GradeCategory[];

function CategoryEditor({ course, initial, onDone }: { course: Course; initial: Draft; onDone(): void }) {
  const save = useSaveCourse();
  const [cats, setCats] = useState<Draft>(initial);
  const total = cats.reduce((s, c) => s + (c.weight ?? 0), 0);
  const set = (i: number, patch: Partial<GradeCategory>) => setCats(cats.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const submit = (mode: 'manual' | 'auto') => {
    const grading = mode === 'auto' ? null : { mode: 'manual' as const, categories: cats.filter((c) => c.name.trim()).map((c) => ({ ...c, name: c.name.trim(), match: c.match?.trim() || null })) };
    save.mutate({ id: course.id, grading }, { onSuccess: () => { toast.success(mode === 'auto' ? 'Back to Canvas groups' : 'Weights saved'); onDone(); }, onError: (e) => toast.error(e.message) });
  };
  return (
    <div className="space-y-2 rounded-2xl bg-well/60 p-4">
      <p className="text-xs text-muted-foreground">
        Weights are percent of the final grade. A category takes assignments from its Canvas groups, or any assignment whose title matches the regex. Leave every weight empty for a points-based total.
      </p>
      <div className="space-y-1.5">
        {cats.map((c, i) => (
          <div key={c.id} className="grid grid-cols-[1fr_4rem_4rem_1fr_auto] items-center gap-1.5 text-xs">
            <Input className="h-7 text-xs" value={c.name} placeholder="Homework" onChange={(e) => set(i, { name: e.target.value })} />
            <Input className="h-7 text-xs" type="number" min={0} max={100} step={0.5} placeholder="%" value={c.weight ?? ''} onChange={(e) => set(i, { weight: e.target.value === '' ? null : Number(e.target.value) })} title="Weight" />
            <Input className="h-7 text-xs" type="number" min={0} max={10} placeholder="drop" value={c.dropLowest || ''} onChange={(e) => set(i, { dropLowest: Number(e.target.value) || 0 })} title="Drop the lowest N" />
            <Input className="h-7 font-mono text-xs" placeholder={c.groupIds.length ? `Canvas group${c.groupIds.length > 1 ? 's' : ''} · title regex (optional)` : 'title regex, e.g. midterm|final'} value={c.match ?? ''} onChange={(e) => set(i, { match: e.target.value || null })} title="Case-insensitive regex on assignment titles" />
            <Button size="icon-xs" variant="ghost" aria-label="Remove category" onClick={() => setCats(cats.filter((_, j) => j !== i))}><Trash2 className="size-3" /></Button>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="xs" variant="secondary" onClick={() => setCats([...cats, { id: `c${Date.now()}`, name: '', weight: null, groupIds: [], match: null, dropLowest: 0 }])}><Plus className="size-3" /> Category</Button>
        <span className={cn('text-xs', total && total !== 100 ? 'text-caution' : 'text-muted-foreground')}>{total ? `weights add to ${num(total)}%` : 'unweighted'}</span>
        <span className="ml-auto flex items-center gap-1">
          {course.grading?.mode === 'manual' && <Button size="xs" variant="ghost" onClick={() => submit('auto')}>Use Canvas groups</Button>}
          <Button size="xs" variant="ghost" onClick={onDone}>Cancel</Button>
          <Button size="xs" onClick={() => submit('manual')} disabled={save.isPending}>Save</Button>
        </span>
      </div>
    </div>
  );
}

/** Canvas's grades page, but ours: categories with weights, drop rules, every assignment, and a current grade we compute. */
export function CourseGrades({ course }: { course: Course }) {
  const q = useCourseGrades(course.id);
  const [editing, setEditing] = useState(false);
  const g = q.data;
  const draft = useMemo<Draft>(() => (g ? g.categories.map((c) => ({ id: c.id, name: c.name, weight: c.weight, groupIds: course.grading?.mode === 'manual' ? (course.grading.categories.find((x) => x.id === c.id)?.groupIds ?? []) : [c.id], match: course.grading?.categories.find((x) => x.id === c.id)?.match ?? null, dropLowest: c.dropLowest })) : []), [g, course.grading]);

  if (q.isPending) return <div className="h-16 animate-pulse rounded bg-muted/40" />;
  if (q.isError || !g) return <p className="text-sm text-destructive">{q.error?.message ?? 'Could not load grades.'}</p>;

  const canvasDiffers = g.canvas?.currentScore != null && g.current != null && Math.abs(g.canvas.currentScore - g.current) >= 0.05;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
        <div>
          <div className="text-3xl font-semibold tabular-nums">{pct(g.current)}</div>
          <div className="text-xs text-muted-foreground">
            {g.current == null ? 'nothing graded yet' : g.weighted ? 'weighted by category' : 'points earned over points possible'}
            {g.mode === 'manual' && <span className="ml-1 rounded bg-secondary px-1">custom weights</span>}
          </div>
        </div>
        <div className="text-xs text-muted-foreground">
          {g.canvas?.currentScore != null && (
            <div>
              Canvas says <span className={cn('tabular-nums', canvasDiffers ? 'text-caution' : 'text-foreground')}>{pct(g.canvas.currentScore)}</span>
              {g.canvas.currentGrade && <span> ({g.canvas.currentGrade})</span>}
              {canvasDiffers && <span> · differs: Canvas may hide or weight things differently</span>}
            </div>
          )}
          {g.weighted && g.unweighted != null && g.unweighted !== g.current && <div>By points: {pct(g.unweighted)}</div>}
          <div>{g.graded} of {g.total} graded</div>
        </div>
        <div className="ml-auto">
          {!editing && <Button size="xs" variant="secondary" onClick={() => setEditing(true)}>{g.mode === 'manual' ? 'Edit weights' : 'Customize weights'}</Button>}
        </div>
      </div>

      {editing && <CategoryEditor course={course} initial={draft.length ? draft : [{ id: 'hw', name: 'Homework', weight: null, groupIds: [], match: 'hw|homework', dropLowest: 0 }]} onDone={() => setEditing(false)} />}

      {g.categories.length ? (
        <ul className="space-y-1.5">
          {g.categories.map((c) => <CategoryRow key={c.id} c={c} weighted={g.weighted} />)}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No categories: Canvas has no assignment groups for this course. Customize weights to build your own from the syllabus.</p>
      )}

      {g.uncategorized.length > 0 && (
        <section className="space-y-1">
          <h4 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Not in a category · {g.uncategorized.length}</h4>
          <div className="rounded-xl border border-line"><AssignmentRows list={g.uncategorized} /></div>
          {g.weighted && <p className="text-xs text-muted-foreground">These count toward the points total but not the weighted grade. Add a category with a matching regex to place them.</p>}
        </section>
      )}
    </div>
  );
}
