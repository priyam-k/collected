import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
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
  const api = useMemo(() => ({ pane: visible ? pane : null, open, close, openPreview }), [pane, visible, open, close, openPreview]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <Sheet open={visible} onOpenChange={(o) => !o && close()}>
        <SheetContent container={container} side="right" showCloseButton={false} className="inset-y-3 right-3 h-auto w-[min(580px,calc(100%-1.5rem))] max-w-none gap-0 overflow-hidden rounded-[24px] border-0 bg-card p-0 shadow-[0_30px_80px_-30px_rgba(0,0,0,.8),0_1px_0_rgba(255,255,255,.06)_inset] sm:max-w-none" onOpenAutoFocus={(e) => e.preventDefault()}>
          {pane?.kind === 'course' && <CoursePane key={`${pane.courseId}:${pane.tab ?? ''}`} courseId={pane.courseId} initialTab={pane.tab} />}
          {pane?.kind === 'job' && <JobPane jobId={pane.jobId} />}
          {pane?.kind === 'job-new' && <JobPane jobId={null} />}
        </SheetContent>
      </Sheet>
      <FilePreview file={preview} onClose={() => setPreview(null)} />
    </Ctx.Provider>
  );
}
