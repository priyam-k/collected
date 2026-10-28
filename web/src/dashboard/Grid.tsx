import { useCallback, useMemo, useState, type Ref } from 'react';
import { Responsive as ResponsiveGridLayout, useContainerWidth, verticalCompactor, type Layout, type ResponsiveLayouts } from 'react-grid-layout';
import { createScaledStrategy } from 'react-grid-layout/core';
import type { Breakpoint, Layouts, Source, WidgetInstance } from '@collected/shared';
import { BREAKPOINTS, COLS, MARGIN, ROW_HEIGHT } from './defaults';
import { WidgetFrame } from './WidgetFrame';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

interface Props {
  instances: WidgetInstance[];
  layouts: Layouts;
  sources: Source[];
  editMode: boolean;
  onLayoutsChange(next: Layouts): void;
  onHide(id: string): void;
  onBreakpointChange?(bp: Breakpoint): void;
  /** The grid is drawn inside a CSS scale() (the landing page's live demo), so drags map back to grid units. */
  scale?: number;
}

/** The resize grip: a thick stroke along the card's rounded bottom-right corner (22px radius, inset 6px). */
function resizeHandle(_axis: string, ref: Ref<HTMLElement>) {
  return (
    <span ref={ref as Ref<HTMLSpanElement>} className="widget-resize" aria-hidden>
      <svg viewBox="0 0 34 34" width="34" height="34" fill="none">
        <path d="M28 13 A15 15 0 0 1 13 28" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      </svg>
    </span>
  );
}

export function Grid({ instances, layouts, sources, editMode, onLayoutsChange, onHide, onBreakpointChange, scale }: Props) {
  const positionStrategy = useMemo(() => (scale && scale !== 1 ? createScaledStrategy(scale) : undefined), [scale]);
  const { width, containerRef, mounted } = useContainerWidth();
  const [, setBp] = useState<Breakpoint>('lg');
  const visible = useMemo(() => instances.filter((w) => !w.hidden), [instances]);

  const handleLayoutChange = useCallback(
    (_current: Layout, all: ResponsiveLayouts<string>) => {
      if (!editMode) return; // RGL also fires on mount/resize; only persist user-driven edits
      const next: Layouts = {};
      for (const bp of ['lg', 'md', 'sm'] as const) {
        const l = all[bp];
        if (l) next[bp] = l.map(({ i, x, y, w, h, minW, minH, maxW, maxH }) => ({ i, x, y, w, h, minW, minH, maxW, maxH }));
      }
      onLayoutsChange(next);
    },
    [editMode, onLayoutsChange],
  );

  return (
    <div ref={containerRef} className="w-full">
      {mounted && (
        <ResponsiveGridLayout
          width={width}
          breakpoints={BREAKPOINTS}
          cols={COLS}
          layouts={layouts as ResponsiveLayouts<string>}
          rowHeight={ROW_HEIGHT}
          margin={MARGIN}
          containerPadding={[0, 0]}
          compactor={verticalCompactor}
          positionStrategy={positionStrategy}
          dragConfig={{ enabled: editMode, handle: '.widget-drag-handle', threshold: 3 }}
          resizeConfig={{ enabled: editMode, handles: editMode ? ['se'] : [], handleComponent: editMode ? resizeHandle : undefined }}
          onLayoutChange={handleLayoutChange}
          onBreakpointChange={(bp) => {
            setBp(bp as Breakpoint);
            onBreakpointChange?.(bp as Breakpoint);
          }}
          className={editMode ? 'is-editing' : undefined}
        >
          {visible.map((w) => (
            <WidgetFrame key={w.id} instance={w} sources={sources} editMode={editMode} onHide={() => onHide(w.id)} />
          ))}
        </ResponsiveGridLayout>
      )}
    </div>
  );
}
