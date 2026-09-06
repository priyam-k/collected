import { useMemo } from 'react';
import { Plus } from 'lucide-react';
import type { Course, WidgetInstance } from '@collected/shared';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { WIDGETS } from '@/widgets/registry';
import type { WidgetPreset } from '@/widgets/types';

interface Props {
  open: boolean;
  onOpenChange(v: boolean): void;
  instances: WidgetInstance[];
  courses: Course[];
  onAdd(instance: { id: string; type: string; config: Record<string, unknown> }, preset: WidgetPreset): void;
}

/** Bottom sheet in edit mode: hidden instances to bring back, plus addable widget types with size presets. */
export function AddTray({ open, onOpenChange, instances, courses, onAdd }: Props) {
  const entries = useMemo(() => {
    const out: { id: string; type: string; config: Record<string, unknown>; label: string; description: string; presets: WidgetPreset[]; hidden: boolean }[] = [];
    for (const def of WIDGETS) {
      if (def.multiInstance && def.type === 'class') {
        for (const c of courses.filter((c) => !c.archived)) {
          const id = `class:${c.id}`;
          const existing = instances.find((w) => w.id === id);
          if (existing && !existing.hidden) continue;
          out.push({ id, type: 'class', config: { courseId: c.id, courseCode: c.code }, label: `${c.code}`, description: c.name ?? def.description, presets: def.presets, hidden: !!existing });
        }
        continue;
      }
      const existing = instances.find((w) => w.type === def.type);
      if (existing && !existing.hidden) continue;
      out.push({ id: existing?.id ?? def.type, type: def.type, config: existing?.config ?? {}, label: def.name, description: def.description, presets: def.presets, hidden: !!existing });
    }
    return out;
  }, [instances, courses]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[70vh] overflow-auto">
        <SheetHeader>
          <SheetTitle>Add a widget</SheetTitle>
          <SheetDescription>Pick a size. You can resize and move it afterwards.</SheetDescription>
        </SheetHeader>
        {entries.length === 0 ? (
          <p className="px-4 pb-6 text-sm text-muted-foreground">Everything is already on the dashboard.</p>
        ) : (
          <ul className="grid gap-3 px-4 pb-6 sm:grid-cols-2 lg:grid-cols-3">
            {entries.map((e) => (
              <li key={e.id} className="rounded-lg border p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{e.label}</span>
                  {e.hidden && <span className="text-xs text-muted-foreground">hidden</span>}
                </div>
                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{e.description}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {e.presets.map((p) => (
                    <Button key={p.label} size="sm" variant="secondary" onClick={() => onAdd({ id: e.id, type: e.type, config: e.config }, p)}>
                      <Plus className="size-3.5" /> {p.label}
                      <span className="text-muted-foreground">
                        {p.w}×{p.h}
                      </span>
                    </Button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </SheetContent>
    </Sheet>
  );
}
