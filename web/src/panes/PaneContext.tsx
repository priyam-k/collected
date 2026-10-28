import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { createPortal } from 'react-dom';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import type { PreviewFile } from '@/lib/canvas';
import { CoursePane } from './CoursePane';
import { FilePreview } from './FilePreview';
import { JobPane } from './JobPane';

/** Everything that can open in the app-wide side pane. Widgets stay small; the pane is where detail lives. */
export type Pane = { kind: 'course'; courseId: string; tab?: string } | { kind: 'job'; jobId: string } | { kind: 'job-new' };

interface PaneApi {
  pane: Pane | null;
  open(p: Pane): void;
  close(): void;
  /** Inline PDF/image preview in a dialog; sits above the pane. */
  openPreview(f: PreviewFile): void;
}

const Ctx = createContext<PaneApi>({ pane: null, open: () => {}, close: () => {}, openPreview: () => {} });

export const usePane = () => useContext(Ctx);

/** One right-hand sheet for the whole app. Content stays mounted through the close animation. */
export function PaneProvider({ children, container }: { children: ReactNode; container?: HTMLElement | null }) {
  const [pane, setPane] = useState<Pane | null>(null);
  const [visible, setVisible] = useState(false);
  const open = useCallback((p: Pane) => {
    setPane(p);
    setVisible(true);
  }, []);
  const close = useCallback(() => setVisible(false), []);
  const [preview, setPreview] = useState<PreviewFile | null>(null);
  const openPreview = useCallback((f: PreviewFile) => setPreview(f), []);
  useEffect(() => {
    if (visible || !pane) return;
    const t = setTimeout(() => setPane(null), 350);
    return () => clearTimeout(t);
  }, [visible, pane]);
  // The pane belongs to the page it was opened on: any navigation (a link, Back) closes it rather than leaving it
  // floating over the next page.
  const { pathname } = useLocation();
  useEffect(() => close(), [pathname, close]);
  const api = useMemo(() => ({ pane: visible ? pane : null, open, close, openPreview }), [pane, visible, open, close, openPreview]);

  return (
    <Ctx.Provider value={api}>
      {children}
      {/* Inside a container (the landing page's demo) the pane is not modal, so the page around it keeps scrolling;
          its backdrop dims only the container, and a click on it closes the pane. */}
      {container && visible && createPortal(<div aria-hidden className="absolute inset-0 z-[49] bg-[rgba(24,20,14,.28)] backdrop-blur-[4px] duration-200 animate-in fade-in-0 dark:bg-[rgba(0,0,0,.45)]" onClick={close} />, container)}
      <Sheet open={visible} onOpenChange={(o) => !o && close()} modal={!container}>
        <SheetContent container={container} side="right" showCloseButton={false} className="inset-y-3 right-3 h-auto w-[min(580px,calc(100%-1.5rem))] max-w-none gap-0 overflow-hidden rounded-[24px] border-0 bg-card p-0 shadow-[0_30px_80px_-30px_rgba(0,0,0,.8),0_1px_0_rgba(255,255,255,.06)_inset] sm:max-w-none" onOpenAutoFocus={(e) => {
          // Focus the sheet itself rather than its first control (no stray focus ring on the edit button), so keyboard
          // and screen-reader users land inside the pane instead of on the board behind it.
          e.preventDefault();
          (e.currentTarget as HTMLElement | null)?.focus({ preventScroll: true });
        }}>
          {pane?.kind === 'course' && <CoursePane key={`${pane.courseId}:${pane.tab ?? ''}`} courseId={pane.courseId} initialTab={pane.tab} />}
          {pane?.kind === 'job' && <JobPane jobId={pane.jobId} />}
          {pane?.kind === 'job-new' && <JobPane jobId={null} />}
        </SheetContent>
      </Sheet>
      <FilePreview file={preview} onClose={() => setPreview(null)} />
    </Ctx.Provider>
  );
}
