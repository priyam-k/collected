import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { format } from 'date-fns';
import { Moon, Plus, RefreshCw, Settings, Sun, SunMoon, UserRound } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Layouts } from '@collected/shared';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useCourses, useItems, useSettings, useSources, useUpsertWidget } from '@/lib/queries';
import { useTheme } from '@/lib/theme';
import { relative } from '@/lib/time';
import { cn } from '@/lib/utils';
import { meetingExceptions, windowFromNow } from '@/widgets/shared';
import { AddTray } from './AddTray';
import { COLS, findFreeSlot, withConstraints } from './defaults';
import { useEditMode } from './EditMode';
import { Grid } from './Grid';
import { useDashboardLayout } from './useLayout';
import type { WidgetPreset } from '@/widgets/types';

const DAY_INDEX: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

/** "2 classes today · 10 overdue · synced 5 min ago" under the date. */
function useSummary() {
  const courses = useCourses();
  const sources = useSources();
  const win = useMemo(() => windowFromNow(1), []);
  const due = useItems({ kind: ['assignment', 'task'], to: new Date().toISOString(), limit: 500 });
  const manual = useItems({ kind: ['event'], source: ['manual'], from: win.from, to: win.to, limit: 100 });
  const todayKey = format(new Date(), 'yyyy-MM-dd');
  const todayDow = new Date().getDay();
  const exceptions = meetingExceptions(manual.data ?? []);
  let classes = 0;
  for (const c of (courses.data ?? []).filter((c) => !c.archived)) {
    for (const [kind, list] of Object.entries(c.schedule)) {
      for (const m of list ?? []) {
        if (DAY_INDEX[m.day] !== todayDow) continue;
        const cancelled = exceptions.some((x) => x.eventKind === 'cancelled' && x.date === todayKey && (x.meetingKind === null || x.meetingKind === kind) && (manual.data ?? []).some((it) => it.courseId === c.id && (it.raw as { date?: string }).date === todayKey));
        if (!cancelled) classes++;
      }
    }
  }
  const now = Date.now();
  const overdue = (due.data ?? []).filter((i) => i.dueAt && new Date(i.dueAt).getTime() < now && !i.effectiveDone).length;
  const last = (sources.data ?? []).map((s) => s.lastSuccessAt).filter((x): x is string => !!x).sort().at(-1) ?? null;
  const broken = (sources.data ?? []).filter((s) => s.enabled && (s.status === 'error' || s.status === 'needs_auth')).length;
  return { classes, overdue, last, broken, ready: courses.isSuccess && due.isSuccess };
}

export function Dashboard() {
  const { editMode, setEditMode } = useEditMode();
  const { instances, layouts, ready, error, scheduleSave, flush, saveNow } = useDashboardLayout();
  const sourcesQ = useSources();
  const coursesQ = useCourses();
  const upsert = useUpsertWidget();
  const [trayOpen, setTrayOpen] = useState(false);
  const summary = useSummary();

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

  const parts = [
    summary.ready ? `${summary.classes} ${summary.classes === 1 ? 'class' : 'classes'} today` : null,
    summary.ready ? `${summary.overdue} overdue` : null,
    summary.broken ? `${summary.broken} ${summary.broken === 1 ? 'source needs' : 'sources need'} attention` : summary.last ? `synced ${relative(summary.last)}` : null,
  ].filter(Boolean);

  return (
    <div className="mx-auto flex min-h-full max-w-[1600px] flex-col gap-3 px-4 pb-6 pt-3.5">
      <header className="flex items-center gap-3 px-0.5">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="text-2xl font-bold leading-[1.1] tracking-[-0.03em]">{format(new Date(), "'Today,' MMMM d")}</h1>
          <p className={cn('truncate text-[13px] text-sub', summary.broken && 'text-amber')}>{parts.join(' · ') || ' '}</p>
        </div>
        <span className="flex-1" />
        <div className="flex items-center gap-2">
          {editMode ? (
            <>
              <Button variant="outline" onClick={() => setTrayOpen(true)}>
                <Plus className="size-4" /> Add widget
              </Button>
              <Button onClick={leaveEdit}>Done</Button>
            </>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" onClick={() => setEditMode(true)} aria-label="Edit layout">
                  Edit layout
                </Button>
              </TooltipTrigger>
              <TooltipContent>Rearrange widgets (e)</TooltipContent>
            </Tooltip>
          )}
          <RefreshAll />
          <ThemeToggle />
          <ProfileMenu />
        </div>
      </header>

      {editMode && (
        <p className="-mt-1 px-0.5 text-xs text-sub">
          Drag by the title bar, resize from the corner, hide with the eye. Press <kbd className="rounded-md border border-line2 px-1">Esc</kbd> when done.
        </p>
      )}

      {error ? (
        <p className="text-sm text-coral">Could not load layout: {error.message}</p>
      ) : !ready ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="surface h-40 animate-pulse opacity-60" />
          ))}
        </div>
      ) : (
        <div>
          <Grid
            instances={instances}
            layouts={layouts}
            sources={sourcesQ.data ?? []}
            editMode={editMode}
            onLayoutsChange={scheduleSave}
            onHide={hide}
          />
          {!instances.some((w) => !w.hidden) && (
            <div className="surface p-8 text-center text-sm text-sub">
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
        <Button size="icon" variant="outline" aria-label="Refresh" onClick={refresh}>
          <RefreshCw className={cn('size-4', spinning && 'animate-spin')} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Refresh all widgets</TooltipContent>
    </Tooltip>
  );
}

function ThemeToggle() {
  const { theme, resolved, setTheme } = useTheme();
  const Icon = theme === 'system' ? SunMoon : resolved === 'dark' ? Sun : Moon;
  const next = resolved === 'dark' ? 'light' : 'dark';
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button size="icon" variant="outline" aria-label="Toggle theme" onClick={() => setTheme(next)}>
          <Icon className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{theme === 'system' ? 'Following the system; click for ' : 'Switch to '}{next}</TooltipContent>
    </Tooltip>
  );
}

/** Gradient avatar with your initials (Settings → Layout); opens settings and theme choices. */
function ProfileMenu() {
  const settings = useSettings();
  const { theme, setTheme } = useTheme();
  const initials = String(settings.data?.['profile.initials'] ?? '').trim().slice(0, 3).toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="Profile and settings"
          className="grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold text-white shadow-[var(--shadow)] outline-none focus-visible:ring-[3px] focus-visible:ring-indigo/40"
          style={{ background: 'linear-gradient(140deg, var(--indigo), color-mix(in oklab, var(--indigo) 60%, var(--teal)))' }}
        >
          {initials || <UserRound className="size-4" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem asChild>
          <Link to="/settings"><Settings className="size-4" /> Settings</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-sub">Theme</DropdownMenuLabel>
        {(['system', 'light', 'dark'] as const).map((t) => (
          <DropdownMenuItem key={t} onClick={() => setTheme(t)} className={cn('capitalize', theme === t && 'font-semibold')}>
            {t}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
