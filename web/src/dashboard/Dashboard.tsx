import { useEffect, useMemo, useReducer, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { format } from 'date-fns';
import { Check, Moon, Plus, RefreshCw, Settings, Sun, SunMoon, UserRound } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { SOURCE_LABELS, type Layouts, type Source } from '@collected/shared';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { api } from '@/lib/api';
import { useGlass, useLiquid } from '@/lib/liquid';
import { qk, useCourses, useItems, useSettings, useSources, useSyncAll, useUpsertWidget } from '@/lib/queries';
import { ACCENTS, useTheme } from '@/lib/theme';
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

/** "2026-fall" → "Fall 2026"; anything else as stored. */
function termLabel(term: string | undefined): string | null {
  if (!term) return null;
  const m = /^(\d{4})-(\w+)$/.exec(term);
  return m ? `${m[2]!.charAt(0).toUpperCase()}${m[2]!.slice(1)} ${m[1]}` : term;
}

/** "2 classes today · 10 overdue · synced 5 min ago" under the date. */
function useSummary() {
  // Relative times are computed at render, and polling returns identical data, so nothing re-renders on its own.
  // Under a minute the label reads "N seconds ago", so tick every second there; every 30 s after that.
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const courses = useCourses();
  const sources = useSources();
  const last = (sources.data ?? []).map((s) => s.lastSuccessAt).filter((x): x is string => !!x).sort().at(-1) ?? null;
  const fast = !!last && Date.now() - new Date(last).getTime() < 60_000;
  useEffect(() => {
    const id = window.setInterval(tick, fast ? 1_000 : 30_000);
    return () => window.clearInterval(id);
  }, [fast]);
  const win = useMemo(() => windowFromNow(1), []);
  const nowIso = useMemo(() => new Date().toISOString(), []); // stable key; a fresh Date per render never settles
  const due = useItems({ kind: ['assignment', 'task'], to: nowIso, limit: 500 });
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
  const broken = (sources.data ?? []).filter((s) => s.enabled && (s.status === 'error' || s.status === 'needs_auth')).length;
  const term = termLabel((courses.data ?? []).find((c) => !c.archived)?.term);
  return { classes, overdue, last, broken, term, ready: courses.isSuccess && due.isSuccess };
}

export function Dashboard() {
  const { editMode, setEditMode } = useEditMode();
  const { instances, layouts, ready, error, scheduleSave, flush, saveNow } = useDashboardLayout();
  const sourcesQ = useSources();
  const coursesQ = useCourses();
  const upsert = useUpsertWidget();
  const [trayOpen, setTrayOpen] = useState(false);
  const summary = useSummary();
  const glass = useGlass<HTMLDivElement>();

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

  // Status words carry their colour; everything else in the line stays muted.
  const parts: ReactNode[] = [];
  if (summary.ready) {
    parts.push(`${summary.classes} ${summary.classes === 1 ? 'class' : 'classes'} today`);
    parts.push(summary.overdue ? <span className="font-medium text-critical">{summary.overdue} overdue</span> : 'nothing overdue');
  }
  if (summary.broken) parts.push(<span className="font-medium text-caution">{summary.broken} {summary.broken === 1 ? 'source needs' : 'sources need'} attention</span>);
  else if (summary.last) parts.push(`synced ${relative(summary.last)}`);
  const eyebrow = [format(new Date(), 'EEEE'), summary.term].filter(Boolean).join(' · ');

  return (
    <div className="mx-auto flex min-h-full max-w-[1600px] flex-col gap-5 px-4 pb-28 pt-7 sm:px-6 sm:pb-10">
      <header className="flex items-end gap-3 px-0.5 sm:pr-[300px]">
        <div className="flex min-w-0 flex-col">
          <p className="label">{eyebrow}</p>
          <h1 className="mt-1.5 text-[38px] font-[620] leading-[1.04] tracking-[-0.032em] sm:text-[44px]"><span className="sr-only">Today, </span>{format(new Date(), 'MMMM d')}</h1>
          <p className="mt-2 truncate text-[15px] text-sub">
            {parts.length ? parts.map((p, i) => <span key={i}>{i > 0 && <span className="text-ter"> · </span>}{p}</span>) : ' '}
          </p>
        </div>
      </header>

      {editMode && (
        <p className="-mt-2 px-0.5 text-[13px] text-sub">
          Drag a card by its title, resize from the corner, hide with the eye. <kbd className="rounded-md bg-well px-1.5 py-px font-mono text-[11px]">Esc</kbd> when done.
        </p>
      )}

      {/* Floating toolbar: liquid glass over the board. Top right on wide screens, bottom centre on phones. */}
      <div
        ref={glass}
        className="glass fixed z-40 flex items-center gap-0.5 p-1 max-sm:bottom-[max(1rem,env(safe-area-inset-bottom))] max-sm:left-1/2 max-sm:-translate-x-1/2 sm:right-[max(1.5rem,calc((100vw-1600px)/2+1.5rem))] sm:top-6"
      >
        {editMode ? (
          <>
            <button className="glass-btn px-3.5 text-[14px] font-[560]" onClick={() => setTrayOpen(true)}>
              <Plus className="size-4" /> Add widget
            </button>
            <button className="h-10 rounded-full bg-brand px-5 text-[14px] font-[560] text-on-brand transition-[background-color,transform] duration-150 hover:bg-[color-mix(in_srgb,var(--brand)_88%,var(--ink))] active:scale-[.98]" onClick={leaveEdit}>
              Done
            </button>
          </>
        ) : (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <button className="glass-btn px-3.5 text-[14px] font-[560]" onClick={() => setEditMode(true)} aria-label="Edit layout">
                  Edit
                </button>
              </TooltipTrigger>
              <TooltipContent>Rearrange widgets (e)</TooltipContent>
            </Tooltip>
            <RefreshAll />
            <ThemeToggle />
            <ProfileMenu />
          </>
        )}
      </div>

      {error ? (
        <p className="text-sm text-critical">Error: could not load layout: {error.message}</p>
      ) : !ready ? (
        <div className="grid gap-3.5 sm:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="surface h-44 animate-pulse opacity-70" />
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
            <div className="surface p-10 text-center text-sm text-sub">
              Nothing on the dashboard.{' '}
              <button className="font-medium text-ink underline decoration-line-strong underline-offset-[3px] hover:decoration-brand" onClick={() => { setEditMode(true); setTrayOpen(true); }}>
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

/** Sync every enabled source, spin until the last one finishes, then refetch everything. Give up waiting after 5 minutes. */
const SYNC_POLL_MS = 2_000;
const SYNC_WAIT_MAX_MS = 5 * 60_000;

function RefreshAll() {
  const qc = useQueryClient();
  const syncAll = useSyncAll();
  const [spinning, setSpinning] = useState(false);
  const refresh = async () => {
    if (spinning) return;
    setSpinning(true);
    try {
      const { started, skipped } = await syncAll.mutateAsync();
      if (!started.length) {
        toast.info(skipped.some((s) => s.reason === 'running') ? 'A sync is already running' : 'No sources enabled');
        await qc.invalidateQueries();
        return;
      }
      const deadline = Date.now() + SYNC_WAIT_MAX_MS;
      let latest: Source[] = [];
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, SYNC_POLL_MS));
        latest = await api<Source[]>('/sources');
        qc.setQueryData(qk.sources, latest);
        if (!latest.some((s) => started.includes(s.id) && s.running)) break;
      }
      await qc.invalidateQueries();
      const failed = latest.filter((s) => started.includes(s.id) && (s.status === 'error' || s.status === 'needs_auth'));
      const stillRunning = latest.filter((s) => started.includes(s.id) && s.running);
      if (stillRunning.length) toast.info(`Still syncing: ${stillRunning.map((s) => SOURCE_LABELS[s.id]).join(', ')}`);
      else if (failed.length) toast.error(failed.map((s) => `${SOURCE_LABELS[s.id]}: ${s.status === 'needs_auth' ? 'needs reconnecting' : s.lastError ?? 'failed'}`).join('\n'));
      else {
        const n = latest.filter((s) => started.includes(s.id) && s.status === 'connected').length;
        toast.success(n ? `Synced ${n} source${n === 1 ? '' : 's'}` : 'Nothing to sync yet. Connect a source in Settings.');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setSpinning(false);
    }
  };
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button className="glass-btn" aria-label="Sync all sources" onClick={refresh} disabled={spinning}>
          <RefreshCw className={cn('size-[18px]', spinning && 'animate-spin')} strokeWidth={1.7} />
        </button>
      </TooltipTrigger>
      <TooltipContent>{spinning ? 'Syncing…' : 'Sync all sources'}</TooltipContent>
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
        <button className="glass-btn" aria-label="Toggle theme" onClick={() => setTheme(next)}>
          <Icon className="size-[18px]" strokeWidth={1.7} />
        </button>
      </TooltipTrigger>
      <TooltipContent>{theme === 'system' ? 'Following the system; click for ' : 'Switch to '}{next}</TooltipContent>
    </Tooltip>
  );
}

/** Your initials on the accent (Settings → Layout); opens settings, the theme, and the accent. */
function ProfileMenu() {
  const settings = useSettings();
  const { theme, setTheme, accent, setAccent } = useTheme();
  const liquid = useLiquid();
  const initials = String(settings.data?.['profile.initials'] ?? '').trim().slice(0, 3).toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button aria-label="Profile and settings" className="ml-0.5 grid size-10 shrink-0 place-items-center rounded-full bg-brand text-[13px] font-semibold tracking-[0.01em] text-on-brand transition-transform active:scale-95">
          {initials || <UserRound className="size-[18px]" strokeWidth={1.7} />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={10} className="w-60">
        <DropdownMenuItem asChild>
          <Link to="/settings"><Settings className="size-4" /> Settings</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <div className="px-2.5 pb-2 pt-1.5">
          <p className="label">Appearance</p>
          <div className="seg mt-2 flex w-full" role="group" aria-label="Theme" ref={liquid}>
            {(['system', 'light', 'dark'] as const).map((t) => (
              <button key={t} className={cn('flex-1 capitalize', theme === t && 'seg-on')} aria-pressed={theme === t} onClick={() => setTheme(t)}>
                {t === 'system' ? 'Auto' : t}
              </button>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between" role="group" aria-label="Accent">
            {ACCENTS.map((a) => (
              <button
                key={a.id}
                aria-label={`${a.label} accent`}
                aria-pressed={accent === a.id}
                title={a.label}
                onClick={() => setAccent(a.id)}
                className={cn('grid size-9 place-items-center rounded-full transition-[box-shadow] duration-150', accent === a.id ? 'shadow-[inset_0_0_0_2px_var(--ink)]' : 'hover:shadow-[inset_0_0_0_2px_var(--line-mid)]')}
              >
                <span data-accent-swatch={a.id} className="grid size-6 place-items-center rounded-full">
                  {accent === a.id && <Check className="size-3.5" strokeWidth={2.4} />}
                </span>
              </button>
            ))}
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
