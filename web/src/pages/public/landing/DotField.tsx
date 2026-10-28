import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { reducedMotion } from './motion';

/**
 * Caustic's dot-matrix, as a field behind the hero: three levels only (off, dim, lit) with ordered dithering,
 * stepping a few times a second like a display, never smoothly. Lit dots take the accent, so it follows the theme.
 * Decorative; pauses off-screen and draws one still frame under reduced motion.
 */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

function hash(x: number, y: number): number {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function noise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let xf = x - xi;
  let yf = y - yi;
  xf = xf * xf * (3 - 2 * xf);
  yf = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
}

export function DotField({ className, cell = 14, fps = 5 }: { className?: string; cell?: number; fps?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let W = 0;
    let H = 0;
    let dpr = 1;
    const size = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = canvas.clientWidth;
      H = canvas.clientHeight;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    };
    const draw = (t: number) => {
      if (canvas.clientWidth !== W || canvas.clientHeight !== H) size();
      const cs = getComputedStyle(canvas);
      const off = cs.getPropertyValue('--tick').trim() || '#ddd';
      const on = cs.getPropertyValue('--brand').trim() || '#2e5aa8';
      const cols = Math.ceil(W / cell);
      const rows = Math.ceil(H / cell);
      const r = Math.max(1.1, cell * 0.13) * dpr;
      const step = Math.floor(t * fps) * 0.05;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (let y = 0; y < rows; y++)
        for (let x = 0; x < cols; x++) {
          let v = noise(x * 0.09 + step, y * 0.13 - step * 0.6) * 0.75 + noise(x * 0.31 - step, y * 0.29) * 0.25;
          v = (v - 0.4) / 0.45;
          const th = (BAYER[(y & 3) * 4 + (x & 3)]! + 0.5) / 16;
          const lvl = v > 0.62 + th * 0.4 ? 2 : v > th * 0.85 ? 1 : 0;
          const cx = (x * cell + cell / 2) * dpr;
          const cy = (y * cell + cell / 2) * dpr;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.globalAlpha = lvl === 2 ? 0.9 : lvl === 1 ? 0.32 : 1;
          ctx.fillStyle = lvl ? on : off;
          ctx.fill();
        }
      ctx.globalAlpha = 1;
    };

    size();
    draw(0);
    if (reducedMotion()) return;
    let raf = 0;
    let last = -1e9;
    let visible = true;
    const t0 = performance.now();
    const frame = (now: number) => {
      raf = 0;
      if (now - last >= 1000 / fps) {
        last = now;
        draw((now - t0) / 1000);
      }
      if (visible) raf = requestAnimationFrame(frame);
    };
    const io = new IntersectionObserver((e) => {
      visible = !!e[0]?.isIntersecting;
      if (visible && !raf) raf = requestAnimationFrame(frame);
    });
    io.observe(canvas);
    raf = requestAnimationFrame(frame);
    const ro = new ResizeObserver(() => {
      size();
      draw((performance.now() - t0) / 1000);
    });
    ro.observe(canvas);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
    };
  }, [cell, fps]);
  return <canvas ref={ref} aria-hidden className={cn('pointer-events-none block', className)} />;
}
