import type { LayoutItem, Layouts, WidgetInstance } from '@collected/shared';
import { getWidgetDef } from '@/widgets/registry';

export const BREAKPOINTS = { lg: 1100, md: 700, sm: 0 } as const;
export const COLS = { lg: 12, md: 8, sm: 4 } as const;
export const ROW_HEIGHT = 40;
export const MARGIN: [number, number] = [8, 8];

/** Where the core widgets go on a fresh install (lg, 12 columns). */
const DEFAULT_LG: Record<string, Omit<LayoutItem, 'i'>> = {
  calendar: { x: 0, y: 0, w: 8, h: 14 },
  todo: { x: 8, y: 0, w: 4, h: 14 },
  sources: { x: 0, y: 14, w: 3, h: 7 },
  jobs: { x: 3, y: 14, w: 6, h: 7 },
  classes: { x: 9, y: 14, w: 3, h: 7 },
};

export function withConstraints(item: LayoutItem, type: string): LayoutItem {
  const def = getWidgetDef(type);
  if (!def) return item;
  return {
    ...item,
    minW: def.min.w,
    minH: def.min.h,
    ...(def.max ? { maxW: def.max.w, maxH: def.max.h } : {}),
    w: Math.max(item.w, def.min.w),
    h: Math.max(item.h, def.min.h),
  };
}

/** Builds an lg layout for every visible instance: defaults for the core ones, appended below for the rest. */
export function defaultLayoutFor(instances: WidgetInstance[]): LayoutItem[] {
  const visible = instances.filter((w) => !w.hidden);
  const out: LayoutItem[] = [];
  let nextY = Math.max(0, ...Object.values(DEFAULT_LG).map((d) => d.y + d.h));
  let cursorX = 0;
  for (const w of visible) {
    const d = DEFAULT_LG[w.id];
    if (d) {
      out.push(withConstraints({ i: w.id, ...d }, w.type));
      continue;
    }
    const def = getWidgetDef(w.type);
    const preset = def?.presets[0] ?? { w: 4, h: 4 };
    if (cursorX + preset.w > COLS.lg) {
      cursorX = 0;
      nextY += preset.h;
    }
    out.push(withConstraints({ i: w.id, x: cursorX, y: nextY, w: preset.w, h: preset.h }, w.type));
    cursorX += preset.w;
  }
  return out;
}

/** Ensures every visible instance has a slot in each stored breakpoint; drops slots for hidden/removed ones. */
export function reconcileLayouts(stored: Layouts, instances: WidgetInstance[]): Layouts {
  const visible = instances.filter((w) => !w.hidden);
  const visibleIds = new Set(visible.map((w) => w.id));
  const typeOf = new Map(instances.map((w) => [w.id, w.type]));
  const base = stored.lg?.length ? stored.lg : defaultLayoutFor(instances);
  const out: Layouts = {};
  for (const bp of ['lg', 'md', 'sm'] as const) {
    const cols = COLS[bp];
    const current = (bp === 'lg' ? base : (stored[bp] ?? [])).filter((l) => visibleIds.has(l.i));
    const have = new Set(current.map((l) => l.i));
    let maxY = Math.max(0, ...current.map((l) => l.y + l.h));
    // Missing items are appended in the desktop layout's reading order (top-to-bottom, left-to-right).
    const order = new Map(base.slice().sort((a, b) => a.y - b.y || a.x - b.x).map((l, i) => [l.i, i]));
    const pending = visible.slice().sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9));
    for (const w of pending) {
      if (have.has(w.id)) continue;
      const fromLg = base.find((l) => l.i === w.id);
      const def = getWidgetDef(w.type);
      const preset = fromLg ?? { w: def?.presets[0]?.w ?? 4, h: def?.presets[0]?.h ?? 4, x: 0, y: maxY };
      const w_ = Math.min(preset.w, cols);
      current.push(withConstraints({ i: w.id, x: 0, y: maxY, w: w_, h: preset.h }, w.type));
      maxY += preset.h;
    }
    out[bp] = current.map((l) => withConstraints({ ...l, w: Math.min(l.w, cols), x: Math.min(l.x, Math.max(0, cols - Math.min(l.w, cols))) }, typeOf.get(l.i) ?? ''));
  }
  return out;
}

/** First free slot for a new item of size w×h in a given layout (scan rows top-down). */
export function findFreeSlot(layout: LayoutItem[], w: number, h: number, cols: number): { x: number; y: number } {
  const maxY = Math.max(0, ...layout.map((l) => l.y + l.h));
  for (let y = 0; y <= maxY; y++) {
    for (let x = 0; x + w <= cols; x++) {
      const collides = layout.some((l) => x < l.x + l.w && x + w > l.x && y < l.y + l.h && y + h > l.y);
      if (!collides) return { x, y };
    }
  }
  return { x: 0, y: maxY };
}
