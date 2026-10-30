import { useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { format } from 'date-fns';
import { Check, CircleArrowUp, LogOut, Moon, Plus, RefreshCw, Settings, Sun, SunMoon, UserRound } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { SOURCE_LABELS, type Layouts, type Source } from '@collected/shared';
import { DropdownMenu as DropdownMenuPrimitive } from 'radix-ui';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { LogoMark, Wordmark } from '@/components/Logo';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { api } from '@/lib/api';
import { useGlass, useLiquid } from '@/lib/liquid';
import { qk, useCourses, useItems, useMe, useSettings, useSources, useSyncAll, useUpsertWidget } from '@/lib/queries';
import { ACCENTS, useTheme } from '@/lib/theme';
import { relative } from '@/lib/time';
import { useSignOut } from '@/lib/useSignOut';
import { cn } from '@/lib/utils';
import { meetingExceptions, windowFromNow } from '@/widgets/shared';
import { AddTray } from './AddTray';
import { COLS, findFreeSlot, withConstraints } from './defaults';
import { useEditMode } from './EditMode';
import { Grid } from './Grid';
import { UpdatePanel, buildLine, useUpdateState } from './UpdatePanel';
import { useDashboardLayout } from './useLayout';
import type { WidgetPreset } from '@/widgets/types';

const DAY_INDEX: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

/** "2026-fall" → "Fall 2026"; anything else as stored. */
function termLabel(term: string | undefined): string | null {
  if (!term) return null;
  const m = /^(\d{4})-(\w+)$/.exec(term);
  return m ? `${m[2]!.charAt(0).toUpperCase()}${m[2]!.slice(1)} ${m[1]}` : term;
}

/**
 * Publishes the page scrollbar's width as --sbw on <html> (0 with overlay scrollbars). A classic scrollbar takes room
 * on the right only, so the board subtracts it from its right padding to keep the visible margins even.
 */
function useScrollbarWidth() {
  useEffect(() => {
    const root = document.documentElement;
    const update = () => {
      // a modal's scroll lock hides the scrollbar and pads the body by its width instead: keep the last reading
      if (document.body.hasAttribute('data-scroll-locked')) return;
      root.style.setProperty('--sbw', `${Math.max(0, window.innerWidth - root.clientWidth)}px`);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(root);
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
      root.style.removeProperty('--sbw');
    };
  }, []);
}

/** True after scrolling down past the header, false again on any scroll up or near the top. */
function useScrollCollapse(active: boolean): boolean {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    if (!active) {
      setCollapsed(false);
      return;
    }
    let last = window.scrollY;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const y = window.scrollY;
        const dy = y - last;
        if (y < 60) setCollapsed(false);
        else if (dy > 8) setCollapsed(true);
        else if (dy < -8) setCollapsed(false);
        if (Math.abs(dy) > 8 || y < 60) last = y;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [active]);
  return collapsed;
}

/** Folds a toolbar item away: its column springs to zero width while it fades and blurs out. */
function Fold({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div className="glass-fold" data-open={open} inert={!open}>
      <div className="min-w-0 overflow-hidden">{children}</div>
    </div>
  );
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
  const update = useUpdateState();
  const [updateOpen, setUpdateOpen] = useState(false);
  useScrollbarWidth();
  // Scrolled down, the toolbar draws in to sync and the avatar; hovering it or tabbing into it opens it again.
  const scrolledAway = useScrollCollapse(!editMode);
  const [reaching, setReaching] = useState(false);
  const collapsed = scrolledAway && !reaching;
  // the pill wobbles on each fold and unfold, never on first paint
  const folded = useRef<boolean | null>(null);
  const [squishClass, setSquishClass] = useState('');
  useEffect(() => {
    if (folded.current !== null && folded.current !== collapsed) setSquishClass(collapsed ? 'glass-squish-in' : 'glass-squish-out');
    folded.current = collapsed;
  }, [collapsed]);

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
  const showPill = !editMode && update.nudge;

  return (
    <div className="mx-auto flex min-h-full max-w-[1600px] flex-col gap-3.5 pb-28 pl-3 pr-[max(0px,calc(0.75rem-var(--sbw,0px)))] pt-4 sm:pb-10 sm:pl-4 sm:pr-[max(0px,calc(1rem-var(--sbw,0px)))]">
      {/* One row as tall as the toolbar pill beside it: the small logo over the date, then the eyebrow over the
          summary. The logo row (14px) plus its gap fill the room the 26px date left in the 44px row, so the header
          is no taller for it. */}
      <header className={cn('flex h-11 items-end gap-3.5 px-1', showPill ? 'sm:pr-[356px] lg:pr-[470px]' : 'sm:pr-[300px]')}>
        <div className="flex shrink-0 flex-col items-start gap-1">
          <Link to="/" aria-label="collected home" className="-mx-1 flex h-3.5 items-center gap-[5px] rounded-full px-1 text-sub transition-colors hover:text-ink">
            <LogoMark className="size-3.5" />
            <Wordmark className="text-[12.5px] leading-none" />
          </Link>
          <h1 className="text-[26px] font-[620] leading-none tracking-[-0.025em]"><span className="sr-only">Today, </span>{format(new Date(), 'MMMM d')}</h1>
        </div>
        <div className="flex min-w-0 flex-col justify-center gap-0.5">
          <p className="label !text-[10.5px] !leading-[13px]">{eyebrow}</p>
          <p className="truncate text-[13px] leading-[17px] text-sub">
            {parts.length ? parts.map((p, i) => <span key={i}>{i > 0 && <span className="text-ter"> · </span>}{p}</span>) : ' '}
          </p>
        </div>
      </header>

      {/* Floating toolbar: liquid glass over the board. Top right on wide screens, bottom centre on phones. It is
          fixed, so swapping its contents for edit mode never moves the board. The update pill rides in the same row,
          so it stays flush against the toolbar while the toolbar draws in and spreads out. */}
      <Popover open={updateOpen && !!update.status} onOpenChange={setUpdateOpen}>
        <PopoverAnchor asChild>
          <div className="fixed z-40 flex w-max items-center gap-2 max-sm:bottom-[max(1rem,env(safe-area-inset-bottom))] max-sm:left-1/2 max-sm:-translate-x-1/2 sm:right-[max(calc(1rem-var(--sbw,0px)),calc((100vw-var(--sbw,0px)-1600px)/2+1rem-var(--sbw,0px)))] sm:top-4">
            {showPill && <UpdatePill matters={update.matters} collapsed={collapsed} />}
            <div
              ref={glass}
              role="toolbar"
              aria-label="Dashboard"
              onPointerEnter={() => setReaching(true)}
              onPointerLeave={() => setReaching(false)}
              onFocus={() => setReaching(true)}
              onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setReaching(false)}
              className={cn('glass flex items-center p-1', squishClass)}
            >
              {editMode ? (
                <>
                  <span className="hidden pl-3.5 pr-2 text-[13px] text-sub lg:inline">Drag a title to move · Esc to finish</span>
                  <button className="glass-btn px-3.5 text-[14px] font-[560]" onClick={() => setTrayOpen(true)}>
                    <Plus className="size-4" /> Add widget
                  </button>
                  <button className="h-9 rounded-full bg-brand px-4 text-[14px] font-[560] text-on-brand transition-[background-color,transform] duration-150 hover:bg-[color-mix(in_srgb,var(--brand)_88%,var(--ink))] active:scale-[.98]" onClick={leaveEdit}>
                    Done
                  </button>
                </>
              ) : (
                <>
                  <Fold open={!collapsed}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button className="glass-btn mr-0.5 px-3.5 text-[14px] font-[560]" onClick={() => setEditMode(true)} aria-label="Edit layout">
                          Edit
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>Rearrange widgets (e)</TooltipContent>
                    </Tooltip>
                  </Fold>
                  <RefreshAll />
                  <Fold open={!collapsed}>
                    <ThemeToggle />
                  </Fold>
                  <ProfileMenu buildLine={buildLine(update.current)} updateDot={update.available ? (update.nudge ? 'on' : 'quiet') : null} onOpenUpdate={() => setUpdateOpen(true)} />
                </>
              )}
            </div>
          </div>
        </PopoverAnchor>
        {update.status && (
          <PopoverContent
            align="end"
            sideOffset={10}
            collisionPadding={12}
            aria-label="Update"
            className="w-[min(25rem,calc(100vw-1.5rem))] max-h-[min(40rem,var(--radix-popover-content-available-height))] overflow-y-auto p-[18px] [scrollbar-width:thin]"
          >
            <UpdatePanel
              status={update.status}
              onDismiss={() => {
                update.dismiss();
                setUpdateOpen(false);
              }}
            />
          </PopoverContent>
        )}
      </Popover>

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

/**
 * The quiet neighbour of the toolbar: liquid glass, the same height and radius, shown only while upstream main has
 * commits this build lacks. It draws in to its icon with the toolbar, on the same spring.
 */
function UpdatePill({ matters, collapsed }: { matters: boolean; collapsed: boolean }) {
  const glass = useGlass<HTMLDivElement>();
  const label = matters ? 'Update available' : 'Minor update';
  return (
    <div ref={glass} className="glass flex items-center p-1 duration-500 animate-in fade-in-0 zoom-in-90 motion-reduce:animate-none">
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button className="glass-btn gap-0 px-[9px]" aria-label={label}>
              <span className="relative grid size-[18px] place-items-center">
                <CircleArrowUp className={cn('size-[18px]', matters ? 'text-brand' : 'text-ink-muted')} strokeWidth={1.8} />
              </span>
              <span className="max-lg:hidden">
                <Fold open={!collapsed}>
                  <span className={cn('block whitespace-nowrap pl-1.5 pr-1 text-[14px] font-[560]', !matters && 'text-sub')}>{label}</span>
                </Fold>
              </span>
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{matters ? 'A newer version of collected is out' : 'Upstream changed, nothing in the app'}</TooltipContent>
      </Tooltip>
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

/**
 * Your Google photo, or your initials on the accent (Settings → Layout). Opens your account, settings, the theme and
 * the accent. Not modal: a modal menu locks page scroll, which hides the scrollbar and nudges the layout.
 */
function ProfileMenu({ buildLine, updateDot, onOpenUpdate }: { buildLine: string | null; updateDot: 'on' | 'quiet' | null; onOpenUpdate: () => void }) {
  const settings = useSettings();
  const me = useMe();
  const user = me.data?.user ?? null;
  const [photoFailed, setPhotoFailed] = useState(false);
  const photo = user?.picture && !photoFailed ? user.picture : null;
  const { theme, setTheme, accent, setAccent } = useTheme();
  const liquid = useLiquid();
  const { signOut, available: canSignOut } = useSignOut();
  const initials = String(settings.data?.['profile.initials'] ?? '').trim().slice(0, 3).toUpperCase();
  // Opening the update popover from here waits for the menu to finish closing, or the focus it hands back to the
  // avatar would count as a click outside the popover and shut it again.
  const openUpdateAfterClose = useRef(false);
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button aria-label="Profile and settings" className="ml-0.5 grid size-9 shrink-0 place-items-center overflow-hidden rounded-full bg-brand text-[13px] font-semibold tracking-[0.01em] text-on-brand transition-transform active:scale-95">
          {photo ? (
            <img src={photo} alt="" className="size-full object-cover" referrerPolicy="no-referrer" onError={() => setPhotoFailed(true)} />
          ) : (
            initials || <UserRound className="size-[18px]" strokeWidth={1.7} />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={10}
        className="w-64"
        onCloseAutoFocus={(e) => {
          if (!openUpdateAfterClose.current) return;
          openUpdateAfterClose.current = false;
          e.preventDefault();
          onOpenUpdate();
        }}
      >
        {user && (
          <>
            <DropdownMenuItem asChild>
              <Link to="/settings/account" className="gap-2.5 py-2">
                {photo ? (
                  <img src={photo} alt="" className="size-8 shrink-0 rounded-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand text-[12px] font-semibold text-on-brand">{initials || <UserRound className="size-4 text-on-brand" />}</span>
                )}
                <span className="min-w-0 leading-tight">
                  <span className="block truncate text-[14px] font-semibold">{user.name ?? user.email}</span>
                  {user.name && <span className="block truncate text-[12px] text-sub">{user.email}</span>}
                </span>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem asChild>
          <Link to="/settings"><Settings className="size-4" /> Settings</Link>
        </DropdownMenuItem>
        {canSignOut && (
          <DropdownMenuItem onSelect={signOut}>
            <LogOut className="size-4" /> Sign out
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <div className="px-2.5 pb-2 pt-1.5">
          <p className="label">Appearance</p>
          {/* Radio items, not plain buttons: a Radix menu only lets the arrow keys reach its own items. Choosing one
              keeps the menu open (preventDefault on select) so the theme and accent can be tried in turn. */}
          <DropdownMenuPrimitive.RadioGroup ref={liquid} value={theme} onValueChange={(v) => setTheme(v as typeof theme)} aria-label="Theme" className="seg mt-2 flex w-full">
            {(['system', 'light', 'dark'] as const).map((t) => (
              <DropdownMenuPrimitive.RadioItem key={t} value={t} onSelect={(e) => e.preventDefault()} className={cn('flex-1 text-center capitalize outline-none data-[highlighted]:text-ink data-[highlighted]:shadow-[var(--focus-ring)]', theme === t && 'seg-on')}>
                {t === 'system' ? 'Auto' : t}
              </DropdownMenuPrimitive.RadioItem>
            ))}
          </DropdownMenuPrimitive.RadioGroup>
          <DropdownMenuPrimitive.RadioGroup value={accent} onValueChange={(v) => setAccent(v as typeof accent)} aria-label="Accent" className="mt-3 flex items-center justify-between">
            {ACCENTS.map((a) => (
              <DropdownMenuPrimitive.RadioItem
                key={a.id}
                value={a.id}
                aria-label={`${a.label} accent`}
                title={a.label}
                onSelect={(e) => e.preventDefault()}
                className={cn('grid size-9 cursor-pointer place-items-center rounded-full outline-none transition-[box-shadow] duration-150 data-[highlighted]:shadow-[var(--focus-ring)]', accent === a.id ? 'shadow-[inset_0_0_0_2px_var(--ink)]' : 'hover:shadow-[inset_0_0_0_2px_var(--line-mid)]')}
              >
                <span data-accent-swatch={a.id} className="grid size-6 place-items-center rounded-full">
                  {accent === a.id && <Check className="size-3.5" strokeWidth={2.4} />}
                </span>
              </DropdownMenuPrimitive.RadioItem>
            ))}
          </DropdownMenuPrimitive.RadioGroup>
          {buildLine &&
            (updateDot ? (
              <DropdownMenuItem
                onSelect={() => (openUpdateAfterClose.current = true)}
                aria-label={`${buildLine}, update available`}
                className="-mx-1.5 mt-2.5 gap-1.5 rounded-[8px] px-1.5 py-1 font-mono text-[11px] leading-4 text-sub focus:text-ink"
              >
                <span className="truncate">{buildLine}</span>
                <span aria-hidden className={cn('size-[5px] shrink-0 rounded-full', updateDot === 'on' ? 'bg-brand' : 'bg-line-strong')} />
              </DropdownMenuItem>
            ) : (
              <p className="mt-2.5 truncate font-mono text-[11px] leading-4 text-sub">{buildLine}</p>
            ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
