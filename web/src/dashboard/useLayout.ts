import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { Layouts, WidgetInstance } from '@collected/shared';
import { useLayout, useSaveLayout, useWidgets } from '@/lib/queries';
import { reconcileLayouts } from './defaults';

/**
 * Layouts as the grid should render them: stored layouts reconciled against the current widget instances,
 * plus a debounced saver. Persisting only happens on user-driven changes (drag/resize/add/hide).
 */
export function useDashboardLayout() {
  const widgetsQ = useWidgets();
  const layoutQ = useLayout();
  const save = useSaveLayout();
  const mutateRef = useRef(save.mutate);
  mutateRef.current = save.mutate;
  const timer = useRef<number | null>(null);
  const pending = useRef<Layouts | null>(null);

  const instances: WidgetInstance[] = useMemo(() => widgetsQ.data ?? [], [widgetsQ.data]);
  const layouts: Layouts = useMemo(() => reconcileLayouts(layoutQ.data ?? {}, instances), [layoutQ.data, instances]);

  const flush = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    if (pending.current) {
      const next = pending.current;
      pending.current = null;
      mutateRef.current(next);
    }
  }, []);

  const scheduleSave = useCallback(
    (next: Layouts) => {
      pending.current = next;
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, 500);
    },
    [flush],
  );

  // Flush on unmount only.
  useEffect(() => () => flush(), [flush]);

  const saveNow = useCallback((next: Layouts) => {
    pending.current = null;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    mutateRef.current(next);
  }, []);

  return {
    instances,
    layouts,
    ready: widgetsQ.isSuccess && layoutQ.isSuccess,
    error: widgetsQ.error ?? layoutQ.error,
    scheduleSave,
    flush,
    saveNow,
  };
}
