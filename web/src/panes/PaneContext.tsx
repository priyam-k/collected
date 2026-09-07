import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { CoursePane } from './CoursePane';

/** Everything that can open in the app-wide side pane. Widgets stay small; the pane is where detail lives. */
export type Pane = { kind: 'course'; courseId: string };

interface PaneApi {
  pane: Pane | null;
  open(p: Pane): void;
  close(): void;
}

const Ctx = createContext<PaneApi>({ pane: null, open: () => {}, close: () => {} });

export const usePane = () => useContext(Ctx);

/** One right-hand sheet for the whole app. Content stays mounted through the close animation. */
export function PaneProvider({ children }: { children: ReactNode }) {
  const [pane, setPane] = useState<Pane | null>(null);
  const [visible, setVisible] = useState(false);
  const open = useCallback((p: Pane) => {
    setPane(p);
    setVisible(true);
  }, []);
  const close = useCallback(() => setVisible(false), []);
  useEffect(() => {
    if (visible || !pane) return;
    const t = setTimeout(() => setPane(null), 350);
    return () => clearTimeout(t);
  }, [visible, pane]);
  const api = useMemo(() => ({ pane: visible ? pane : null, open, close }), [pane, visible, open, close]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <Sheet open={visible} onOpenChange={(o) => !o && close()}>
        <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-xl md:max-w-2xl" onOpenAutoFocus={(e) => e.preventDefault()}>
          {pane?.kind === 'course' && <CoursePane courseId={pane.courseId} />}
        </SheetContent>
      </Sheet>
    </Ctx.Provider>
  );
}
