import { useState } from 'react';
import { Link } from 'react-router';
import { LayoutGrid, Moon, Plus, RefreshCw, Settings, Sun, SunMoon } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Layouts } from '@collected/shared';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useCourses, useSources, useUpsertWidget } from '@/lib/queries';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { AddTray } from './AddTray';
import { COLS, findFreeSlot, withConstraints } from './defaults';
import { useEditMode } from './EditMode';
import { Grid } from './Grid';
import { useDashboardLayout } from './useLayout';
import type { WidgetPreset } from '@/widgets/types';

export function Dashboard() {
  const { editMode, setEditMode } = useEditMode();
  const { instances, layouts, ready, error, scheduleSave, flush, saveNow } = useDashboardLayout();
  const sourcesQ = useSources();
  const coursesQ = useCourses();
  const upsert = useUpsertWidget();
  const [trayOpen, setTrayOpen] = useState(false);

  const hide = (id: string) => {
    upsert.mutate({ id, hidden: true });
    const next: Layouts = {};
    for (const bp of ['lg', 'md', 'sm'] as const) next[bp] = (layouts[bp] ?? []).filter((l) => l.i !== id);
    saveNow(next);
  };

  const add = (w: { id: string; type: string; config: Record<string, unknown> }, preset: WidgetPreset) => {
    upsert.mutate({ id: w.id, type: w.type, config: w.config, hidden: false });
    const next: Layouts = {};
    for (const bp of ['lg', 'md', 'sm'] as const) {
      const cols = COLS[bp];
      const current = (layouts[bp] ?? []).filter((l) => l.i !== w.id);
      const width = Math.min(preset.w, cols);
      const { x, y } = findFreeSlot(current, width, preset.h, cols);
      next[bp] = [...current, withConstraints({ i: w.id, x, y, w: width, h: preset.h }, w.type)];
    }
    saveNow(next);
    setTrayOpen(false);
    toast.success('Widget added');
  };

  const leaveEdit = () => {
    flush();
    setEditMode(false);
  };

  return (
    <div className="mx-auto flex min-h-full max-w-[1600px] flex-col px-3 pb-8 pt-3 sm:px-4">
      <header className="mb-3 flex items-center gap-2">
        <Link to="/" className="mr-auto text-base font-semibold tracking-tight">
          collected
        </Link>
        {editMode ? (
          <>
            <Button size="sm" variant="secondary" onClick={() => setTrayOpen(true)}>
              <Plus className="size-4" /> Add widget
            </Button>
            <Button size="sm" onClick={leaveEdit}>
              Done
            </Button>
          </>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="sm" variant="ghost" onClick={() => setEditMode(true)} aria-label="Edit layout">
                <LayoutGrid className="size-4" />
                <span className="hidden sm:inline">Edit</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Rearrange widgets (e)</TooltipContent>
          </Tooltip>
        )}
        <RefreshAll />
        <ThemeMenu />
        <Button asChild size="sm" variant="ghost" aria-label="Settings">
          <Link to="/settings">
            <Settings className="size-4" />
          </Link>
        </Button>
      </header>

      {editMode && (
        <p className="mb-2 text-xs text-muted-foreground">
          Drag by the title bar, resize from the corner, hide with the eye. Press <kbd className="rounded border px-1">Esc</kbd> when done.
        </p>
      )}

      {error ? (
        <p className="text-sm text-destructive">Could not load layout: {error.message}</p>
      ) : !ready ? (
        <div className="grid gap-2 sm:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-40 animate-pulse rounded-lg border bg-muted/40" />
          ))}
        </div>
      ) : (
        <div className={cn(editMode && '[&_.react-grid-item.react-grid-placeholder]:rounded-lg [&_.react-grid-item.react-grid-placeholder]:bg-primary/15')}>
          <Grid
            instances={instances}
            layouts={layouts}
            sources={sourcesQ.data ?? []}
            editMode={editMode}
            onLayoutsChange={scheduleSave}
            onHide={hide}
          />
          {!instances.some((w) => !w.hidden) && (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              Nothing on the dashboard.{' '}
              <button className="underline" onClick={() => { setEditMode(true); setTrayOpen(true); }}>
                Add a widget
              </button>
              .
            </div>
          )}
        </div>
      )}

      <AddTray open={trayOpen} onOpenChange={setTrayOpen} instances={instances} courses={coursesQ.data ?? []} onAdd={add} />
    </div>
  );
}

function RefreshAll() {
  const qc = useQueryClient();
  const [spinning, setSpinning] = useState(false);
  const refresh = async () => {
    setSpinning(true);
    await qc.invalidateQueries();
    setTimeout(() => setSpinning(false), 600);
  };
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button size="sm" variant="ghost" aria-label="Refresh" onClick={refresh}>
          <RefreshCw className={cn('size-4', spinning && 'animate-spin')} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Refresh all widgets</TooltipContent>
    </Tooltip>
  );
}

function ThemeMenu() {
  const { theme, setTheme } = useTheme();
  const Icon = theme === 'dark' ? Moon : theme === 'light' ? Sun : SunMoon;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost" aria-label="Theme">
          <Icon className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setTheme('system')}>System</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('light')}>Light</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('dark')}>Dark</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
