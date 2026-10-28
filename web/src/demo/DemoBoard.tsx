import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { format } from 'date-fns';
import { RefreshCw, RotateCcw } from 'lucide-react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Layouts } from '@collected/shared';
import { Grid } from '@/dashboard/Grid';
import { useDashboardLayout } from '@/dashboard/useLayout';
import { setApiOverride } from '@/lib/api';
import { useCourses, useItems, useSources, useUpsertWidget } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { PaneProvider } from '@/panes/PaneContext';
import { demoApi, resetDemo } from './api';

/** The width the board is laid out at; smaller frames scale it down so the desktop arrangement always shows. */
export const DEMO_WIDTH = 1280;
const DAY_INDEX: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

/**
 * Links inside the demo would leave it (settings pages a visitor cannot open, the made-up courses' hotlinks), so a
 * click on any of them is caught here and explained instead. React events reach this through portals too, so the
 * course pane and popovers are covered.
 */
function blockLinks(e: React.MouseEvent) {
  const a = (e.target as Element).closest?.('a[href]');
  if (!a) return;
  e.preventDefault();
  toast('Links are off in the demo', { id: 'demo-links', description: 'Sign in to use them with your own courses.' });
}

/**
 * Its own query client and course pane, with every API call answered in the browser (demo/api.ts) while mounted.
 * Kept apart from the app's client so demo rows never mix with a signed-in person's cache. `paneHost` keeps the
 * course pane inside the demo's window instead of over the whole page.
 */
export function DemoProviders({ children, paneHost }: { children: ReactNode; paneHost?: HTMLElement | null }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 30_000 } } }));
  // Installed during the first render too: children start fetching before a parent's effects run.
  useState(() => setApiOverride(demoApi));
  useLayoutEffect(() => {
    setApiOverride(demoApi);
    return () => setApiOverride(null);
  }, []);
  return (
    <QueryClientProvider client={client}>
      <div className="contents" onClickCapture={blockLinks}>
        <PaneProvider container={paneHost}>{children}</PaneProvider>
      </div>
    </QueryClientProvider>
  );
}

/** "2 classes today · 1 overdue", from the demo data. */
function useDemoSummary(): string {
  const courses = useCourses();
  const nowIso = useMemo(() => new Date().toISOString(), []);
  const due = useItems({ kind: ['assignment', 'task'], to: nowIso, limit: 500 });
  const dow = new Date().getDay();
  let classes = 0;
  for (const c of courses.data ?? []) for (const list of Object.values(c.schedule)) for (const m of list ?? []) if (DAY_INDEX[m.day] === dow) classes++;
  const overdue = (due.data ?? []).filter((i) => i.dueAt && !i.effectiveDone && new Date(i.dueAt).getTime() < Date.now()).length;
  return `${classes} ${classes === 1 ? 'class' : 'classes'} today · ${overdue} overdue · synced 2 min ago`;
}

function Board({ editMode, setEditMode, scale }: { editMode: boolean; setEditMode(v: boolean): void; scale: number }) {
  const { instances, layouts, ready, scheduleSave, saveNow, flush } = useDashboardLayout();
  const sources = useSources();
  const upsert = useUpsertWidget();
  const qc = useQueryClient();
  const summary = useDemoSummary();
  const [spin, setSpin] = useState(false);

  const hide = (id: string) => {
    upsert.mutate({ id, hidden: true });
    const next: Layouts = {};
    for (const bp of ['lg', 'md', 'sm'] as const) next[bp] = (layouts[bp] ?? []).filter((l) => l.i !== id);
    saveNow(next);
  };
  const reset = async () => {
    resetDemo();
    setEditMode(false);
    await qc.resetQueries();
  };
  const refresh = () => {
    setSpin(true);
    window.setTimeout(() => setSpin(false), 900);
  };

  return (
    <div className="flex flex-col gap-3.5 px-4 pb-6 pt-4">
      <header className="flex h-11 items-center gap-3.5 px-1">
        <span className="shrink-0 text-[26px] font-[620] leading-none tracking-[-0.025em]">{format(new Date(), 'MMMM d')}</span>
        <span className="flex min-w-0 flex-col justify-center gap-0.5">
          <span className="label !text-[10.5px] !leading-[13px]">{format(new Date(), 'EEEE')} · Demo semester</span>
          <span className="truncate text-[13px] leading-[17px] text-sub">{summary}</span>
        </span>
        <span className="flex-1" />
        <div className="glass flex items-center p-1">
          {editMode ? (
            <>
              <button className="glass-btn px-3.5 text-[14px] font-[560]" onClick={reset}>
                <RotateCcw className="size-4" strokeWidth={1.8} /> Reset
              </button>
              <button
                className="h-9 rounded-full bg-brand px-4 text-[14px] font-[560] text-on-brand transition-[background-color,transform] duration-150 active:scale-[.98]"
                onClick={() => {
                  flush();
                  setEditMode(false);
                }}
              >
                Done
              </button>
            </>
          ) : (
            <>
              <button className="glass-btn px-3.5 text-[14px] font-[560]" onClick={() => setEditMode(true)}>
                Edit
              </button>
              <button className="glass-btn" aria-label="Sync (demo)" onClick={refresh}>
                <RefreshCw className={cn('size-[18px]', spin && 'animate-spin')} strokeWidth={1.7} />
              </button>
              <span className="ml-0.5 grid size-9 place-items-center rounded-full bg-brand text-[13px] font-semibold text-on-brand">AR</span>
            </>
          )}
        </div>
      </header>
      {ready ? (
        <Grid instances={instances} layouts={layouts} sources={sources.data ?? []} editMode={editMode} onLayoutsChange={scheduleSave} onHide={hide} scale={scale} />
      ) : (
        <div className="grid grid-cols-3 gap-3.5">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="surface h-44 animate-pulse opacity-70" />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The real dashboard on demo data. With a fixed `height` it is laid out at DEMO_WIDTH, scaled to fit its box and
 * scrolls inside it; with 'auto' it fills the page width like the real board. Rearranging, checking things off and
 * opening a course all work, in memory only.
 */
export function DemoBoard({ height, className, onEditModeChange }: { height: number | 'auto'; className?: string; onEditModeChange?(v: boolean): void }) {
  const outer = useRef<HTMLDivElement>(null);
  const [paneHost, setPaneHost] = useState<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  const [editMode, setEditModeState] = useState(false);
  const setEditMode = (v: boolean) => {
    setEditModeState(v);
    onEditModeChange?.(v);
  };
  useEffect(() => {
    const el = outer.current;
    if (!el) return;
    if (height === 'auto') return;
    const ro = new ResizeObserver(() => setScale(Math.min(1, el.clientWidth / DEMO_WIDTH)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [height]);
  if (height === 'auto') {
    return (
      <DemoProviders>
        <div className={cn('w-full', className)}>
          <Board editMode={editMode} setEditMode={setEditMode} scale={1} />
        </div>
      </DemoProviders>
    );
  }
  return (
    <DemoProviders paneHost={paneHost}>
      {/* translateZ makes this the containing block for the pane's fixed positioning, so it opens inside the window */}
      <div
        ref={(el) => {
          outer.current = el;
          setPaneHost(el);
        }}
        className={cn('relative w-full overflow-hidden [transform:translateZ(0)]', className)}
        style={{ height }}
      >
        <div
          className="origin-top-left overflow-y-auto overflow-x-hidden [scrollbar-width:thin]"
          style={{ width: DEMO_WIDTH, transform: scale === 1 ? undefined : `scale(${scale})`, height: height / scale }}
        >
          <Board editMode={editMode} setEditMode={setEditMode} scale={scale} />
        </div>
      </div>
    </DemoProviders>
  );
}
