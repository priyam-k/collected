import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { reducedMotion } from './motion';

/**
 * The logo mark and "collected." drawn in light characters, filling the closing card's background. The art is
 * rasterised once per size (mark and wordmark on an offscreen canvas, coverage sampled per cell, coverage mapped to a
 * sparse ramp) and drawn to one canvas. As the card scrolls in, glyphs drop a few rows into place, the columns filling
 * in from both sides toward the middle and each column stacking bottom first, each glyph a little early or late.
 * Progress runs 0 when the card's top enters the viewport to 1 when its bottom is in view, so at the foot of the page
 * the art is whole; the assembly starts once the art's top row is on screen, so none of it happens out of sight.
 * The art sits centred behind the copy on a wide card; on a phone it is stacked, in a band under the buttons.
 * One draw per animation frame, only while the card is on screen.
 * Colour and opacity come from CSS (`color`, `opacity`), so it follows the theme. Decorative (aria-hidden).
 */

/** Lightest to densest. No block characters: the art should read as dust, not paint. */
const RAMP = " .`'-:~=+*";
const MONO = '"Geist Mono", ui-monospace, "SF Mono", Menlo, monospace';
const SANS = '"Mona Sans", ui-sans-serif, system-ui, sans-serif';
/** A cell's height over its width: Geist Mono's advance is 0.6em, set on a tight 0.9em line. */
const R = 1.5;
/** Raster samples per cell, across and down. */
const S = 4;
const SY = S * R;
/** Each glyph's fall lasts this share of the scroll. */
const FALL = 0.12;

type Glyph = { x: number; y: number; ch: string; t0: number; jx: number };

function hash(x: number, y: number, k = 0): number {
  let h = x * 374761393 + y * 668265263 + k * 2246822519;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/**
 * The mark (on its 32 grid, as in Logo.tsx) and the wordmark, in the proportions of <Logo>: the word at m / 1.3, a
 * 0.35m gap. Side by side and centred on a wide card; on a narrow one stacked, mark over word, in the band below the
 * copy (the card leaves room for it), since a single row would leave the letters too few cells to read.
 */
function rasterise(cols: number, rows: number, stacked: boolean): Float32Array {
  const W = cols * S;
  const H = rows * SY;
  const cov = new Float32Array(cols * rows);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return cov;
  const word = 'collected.';
  const font = (px: number) => `640 ${px}px ${SANS}`;
  const setFont = (px: number) => {
    ctx.font = font(px);
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${-0.035 * px}px`;
    return ctx.measureText(word);
  };
  const t100 = setFont(100);
  const wordW = t100.width / 100;
  const wordH = (t100.actualBoundingBoxAscent + t100.actualBoundingBoxDescent) / 100;
  const fs = stacked ? Math.min((W * 0.86) / wordW, (H * 0.86) / (1.3 * 1.2 + wordH)) : Math.min((W * 0.94) / (1.3 * 1.35 + wordW), (H * 0.74) / 1.3);
  const m = fs * 1.3;
  const tm = setFont(fs);
  const asc = tm.actualBoundingBoxAscent;
  const desc = tm.actualBoundingBoxDescent;
  let mx: number;
  let my: number;
  let wx: number;
  let wy: number;
  if (stacked) {
    const total = m * 1.2 + asc + desc;
    mx = (W - m) / 2;
    my = H - total - SY * 3;
    wx = (W - tm.width) / 2;
    wy = my + m * 1.2 + asc;
  } else {
    // The word's ink box centred on the mark, as the flex row in <Logo> does.
    mx = (W - (m * 1.35 + tm.width)) / 2;
    my = (H - m) / 2;
    wx = mx + m * 1.35;
    wy = my + m / 2 + (asc - desc) / 2;
  }
  const k = m / 32;
  ctx.fillStyle = '#000';
  const rr = (x: number, y: number, w: number, h: number, r: number) => {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(mx + x * k, my + y * k, w * k, h * k, r * k);
    else ctx.rect(mx + x * k, my + y * k, w * k, h * k);
    ctx.fill();
  };
  rr(2.5, 2.5, 12, 27, 4);
  rr(17.5, 2.5, 12, 12, 4);
  ctx.beginPath();
  ctx.arc(mx + 23.5 * k, my + 23.5 * k, 6 * k, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillText(word, wx, wy);

  const px = ctx.getImageData(0, 0, W, H).data;
  for (let r = 0; r < rows; r++)
    for (let q = 0; q < cols; q++) {
      let sum = 0;
      for (let y = r * SY; y < (r + 1) * SY; y++) for (let x = q * S; x < (q + 1) * S; x++) sum += px[(y * W + x) * 4 + 3]!;
      cov[r * cols + q] = sum / (255 * S * SY);
    }
  return cov;
}

/**
 * Coverage to glyphs, with each glyph's start time (as scroll progress): the sides before the middle, within a column
 * the bottom before the top, and some scatter. Nothing starts before the art's top row is in view.
 */
function glyphs(cov: Float32Array, cols: number, rows: number): Glyph[] {
  const out: Glyph[] = [];
  const top = RAMP.length - 1;
  let r0 = rows;
  let r1 = 0;
  let q0 = cols;
  let q1 = 0;
  for (let r = 0; r < rows; r++)
    for (let q = 0; q < cols; q++)
      if (cov[r * cols + q]! >= 0.16) {
        r0 = Math.min(r0, r);
        r1 = Math.max(r1, r);
        q0 = Math.min(q0, q);
        q1 = Math.max(q1, q);
      }
  const start = Math.min(0.5, r0 / Math.max(1, rows));
  const span = 0.99 - FALL - start;
  const mid = (q0 + q1) / 2;
  const half = Math.max(1, (q1 - q0) / 2);
  const tall = Math.max(1, r1 - r0);
  for (let r = 0; r < rows; r++)
    for (let q = 0; q < cols; q++) {
      const v = cov[r * cols + q]!;
      if (v < 0.16) continue;
      // Edges take the light end of the ramp by coverage; solid cells scatter over its dense end so the fill has grain.
      const i = v > 0.7 ? top - Math.floor(hash(q, r) * 3) : Math.max(1, Math.round(v * (top - 2)));
      const inward = 1 - Math.abs(q - mid) / half;
      const up = (r1 - r) / tall;
      out.push({ x: q, y: r, ch: RAMP[i]!, t0: start + span * (0.7 * inward + 0.18 * up + 0.12 * hash(q, r, 1)), jx: hash(q, r, 2) - 0.5 });
    }
  return out;
}


export function AsciiLogo({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const still = reducedMotion();
    let W = 0;
    let H = 0;
    let dpr = 1;
    let cw = 7;
    let cols = 0;
    let rows = 0;
    let art: Glyph[] = [];
    let p = still ? 1 : 0;
    let drawn = -1;
    let alive = true;

    const layout = () => {
      W = canvas.clientWidth;
      H = canvas.clientHeight;
      if (!W || !H) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      // About 160 cells across a desktop card; phones keep cells small enough that the word still reads.
      cw = Math.max(3.8, Math.min(8, W / 160));
      cols = Math.floor(W / cw);
      rows = Math.floor(H / (cw * R));
      art = glyphs(rasterise(cols, rows, window.innerWidth < 640), cols, rows);
      drawn = -1;
    };

    const draw = () => {
      if (!W || !H) return;
      drawn = p;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = getComputedStyle(canvas).color;
      ctx.font = `600 ${cw / 0.6}px ${MONO}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const ox = (W - cols * cw) / 2;
      const tick = Math.floor(p * 48);
      for (const g of art) {
        const t = (p - g.t0) / FALL;
        if (t <= 0) continue;
        const cx = ox + (g.x + 0.5) * cw;
        const cy = (g.y + 0.5) * cw * R;
        if (t >= 1) {
          ctx.globalAlpha = 1;
          ctx.fillText(g.ch, cx, cy);
          continue;
        }
        // Falling: starts at rest three rows up and accelerates onto the stack, flickering through the ramp.
        const fall = 1 - t * t;
        ctx.globalAlpha = Math.min(1, t * 2.5);
        const ch = RAMP[1 + Math.floor(hash(g.x, g.y, tick) * (RAMP.length - 1))]!;
        ctx.fillText(ch, cx + g.jx * cw * fall, cy - fall * cw * R * 3);
      }
      ctx.globalAlpha = 1;
    };

    const progress = () => {
      const box = (canvas.parentElement ?? canvas).getBoundingClientRect();
      const vh = window.innerHeight;
      return Math.max(0, Math.min(1, (vh - box.top) / Math.max(1, box.height)));
    };

    let raf = 0;
    const frame = () => {
      raf = 0;
      if (!still) p = progress();
      if (p !== drawn) draw();
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(frame);
    };

    layout();
    if (!still) p = progress();
    draw();
    // The brand fonts may still be loading; lay out again once they are in so the word has its real shape.
    void Promise.all([document.fonts.load(`640 32px ${SANS}`), document.fonts.load(`600 12px ${MONO}`)])
      .catch(() => undefined)
      .then(() => {
        if (!alive) return;
        layout();
        draw();
      });

    let listening = false;
    const listen = (on: boolean) => {
      if (on === listening || still) return;
      listening = on;
      if (on) {
        window.addEventListener('scroll', schedule, { passive: true });
        schedule();
      } else window.removeEventListener('scroll', schedule);
    };
    const io = new IntersectionObserver((e) => listen(!!e[0]?.isIntersecting));
    io.observe(canvas);
    const ro = new ResizeObserver(() => {
      layout();
      if (!still) p = progress();
      draw();
    });
    ro.observe(canvas);
    // The theme flips a class on <html>; the glyph colour comes from CSS, so redraw.
    const mo = new MutationObserver(() => draw());
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => {
      alive = false;
      listen(false);
      io.disconnect();
      ro.disconnect();
      mo.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  return <canvas ref={ref} aria-hidden className={cn('pointer-events-none block', className)} />;
}
