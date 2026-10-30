import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { CanvasEnrollment } from '@collected/shared';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useCanvasEnrollments, useImportCanvasCourses } from '@/lib/queries';
import { ROLE_LABEL } from './labels';

/** Pick courses from Canvas enrollments instead of typing them; term and code are editable before import. */
export function ImportCoursesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const q = useCanvasEnrollments(open);
  const importCourses = useImportCanvasCourses();
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [edits, setEdits] = useState<Record<string, { term: string; code: string; section: string }>>({});

  const rows = useMemo(() => q.data?.courses ?? [], [q.data]);
  useEffect(() => {
    if (!rows.length) return;
    // Preselect the term with the most untracked courses: that is the current one.
    const byTerm = new Map<string, number>();
    for (const r of rows) if (!r.trackedAs) byTerm.set(r.suggested.term, (byTerm.get(r.suggested.term) ?? 0) + 1);
    const current = [...byTerm.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    setPicked(Object.fromEntries(rows.map((r) => [r.canvasCourseId, !r.trackedAs && r.suggested.term === current])));
    setEdits(Object.fromEntries(rows.map((r) => [r.canvasCourseId, { term: r.suggested.term, code: r.suggested.code, section: r.suggested.section ?? '' }])));
  }, [rows]);

  const chosen = rows.filter((r) => picked[r.canvasCourseId] && !r.trackedAs);
  const submit = async () => {
    try {
      const res = await importCourses.mutateAsync({
        courses: chosen.map((r) => {
          const e = edits[r.canvasCourseId]!;
          return { canvasCourseId: r.canvasCourseId, term: e.term, code: e.code, section: e.section || null, name: r.name, role: r.role };
        }),
      });
      toast.success(`Imported ${res.created.length} course${res.created.length === 1 ? '' : 's'}${res.skipped.length ? `, ${res.skipped.length} skipped` : ''}`);
      onOpenChange(false);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* sm: prefix on purpose: a bare max-w-2xl replaces the base phone width (edge to edge) and loses to sm:max-w-lg. */}
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import from Canvas</DialogTitle>
          <DialogDescription>Your active enrollments. Untick what you do not want; fix the term or code if Canvas named it oddly.</DialogDescription>
        </DialogHeader>
        {q.isPending && <p className="text-[13px] text-sub">Asking Canvas…</p>}
        {q.isError && (
          <p className="text-[13px] text-sub">
            {/not connected|expired/i.test(q.error.message) ? 'Canvas is not connected. Connect it under Sources first: paste your session cookie there, or run collected connect canvas on your laptop.' : q.error.message}
          </p>
        )}
        {q.data && rows.length === 0 && <p className="text-[13px] text-sub">Canvas returned no active enrollments.</p>}
        {rows.length > 0 && (
          <div className="max-h-[50vh] space-y-1 overflow-y-auto pr-1">
            {rows.map((r: CanvasEnrollment) => {
              const e = edits[r.canvasCourseId] ?? { term: r.suggested.term, code: r.suggested.code, section: r.suggested.section ?? '' };
              const tracked = !!r.trackedAs;
              return (
                <label key={r.canvasCourseId} className="grid grid-cols-[auto_1fr] items-start gap-3 rounded-2xl bg-well/40 px-3 py-2.5 has-[:checked]:bg-well">
                  <Checkbox className="mt-1" checked={!!picked[r.canvasCourseId] && !tracked} disabled={tracked} onCheckedChange={(v) => setPicked((p) => ({ ...p, [r.canvasCourseId]: v === true }))} />
                  <div className="min-w-0 space-y-1.5">
                    <div className="truncate text-[13px] font-medium" title={r.name}>
                      {r.name}
                    </div>
                    <div className="text-xs text-sub">
                      {r.termName ?? 'no term'} · {ROLE_LABEL[r.role] ?? r.role}
                      {tracked && ` · already tracked as ${r.trackedAs}`}
                    </div>
                    {!tracked && (
                      <div className="grid grid-cols-3 gap-2">
                        <Input aria-label="Term" value={e.term} onChange={(ev) => setEdits((x) => ({ ...x, [r.canvasCourseId]: { ...e, term: ev.target.value } }))} />
                        <Input aria-label="Code" value={e.code} onChange={(ev) => setEdits((x) => ({ ...x, [r.canvasCourseId]: { ...e, code: ev.target.value } }))} />
                        <Input aria-label="Section" placeholder="section" value={e.section} onChange={(ev) => setEdits((x) => ({ ...x, [r.canvasCourseId]: { ...e, section: ev.target.value } }))} />
                      </div>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!chosen.length || importCourses.isPending}>
            Import {chosen.length || ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
