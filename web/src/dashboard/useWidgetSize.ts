import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

export type SizeTier = 'xs' | 'sm' | 'md' | 'lg';
export type Aspect = 'tall' | 'square' | 'wide';

export interface WidgetSize {
  width: number;
  height: number;
  tier: SizeTier;
  aspect: Aspect;
}

export function tierFor(width: number): SizeTier {
  if (width < 300) return 'xs';
  if (width < 520) return 'sm';
  if (width < 820) return 'md';
  return 'lg';
}

export function aspectFor(width: number, height: number): Aspect {
  if (!height) return 'square';
  const r = width / height;
  if (r >= 1.6) return 'wide';
  if (r <= 0.75) return 'tall';
  return 'square';
}

export function computeSize(width: number, height: number): WidgetSize {
  return { width, height, tier: tierFor(width), aspect: aspectFor(width, height) };
}

/** Measures the widget body with a ResizeObserver. Structural switches (agenda vs week grid) key off `tier`/`aspect`. */
export function useWidgetSize(): [RefObject<HTMLDivElement | null>, WidgetSize] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<WidgetSize>(() => computeSize(0, 0));
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      const next = computeSize(Math.round(r.width), Math.round(r.height));
      setSize((prev) => (prev.width === next.width && prev.height === next.height ? prev : next));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}
