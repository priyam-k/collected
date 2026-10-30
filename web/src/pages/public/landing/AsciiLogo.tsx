import { useEffect, useRef, type RefObject } from 'react';
import { cn } from '@/lib/utils';
import { reducedMotion } from './motion';

/**
 * The logo mark and "collected." drawn in light characters across the page's closing band, edge to edge. The art is
 * rasterised once per size (mark and wordmark on an offscreen canvas, coverage sampled per cell, coverage mapped to a
 * sparse ramp) and drawn to one canvas that covers the band. It is centred vertically on the `center` element (the
 * headline card), which floats over it: on a wide screen the mark at the left edge and the word across the rest, about
 * four fifths of the width; on a phone the mark over the word, the word filling the width.
 * As the band scrolls in, glyphs drop a few rows into place, the columns filling in from both sides toward the middle
 * and each column stacking bottom first, each glyph a little early or late. Progress runs 0 when the band's top
 * enters the viewport to 1 at the very bottom of the page, so the art is whole only there; the assembly starts once
 * the art's top row is on screen, so none of it happens out of sight.
 * One draw per animation frame, only while the band is on screen. Reduced motion draws it whole, once.
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
 * The mark (on its 32 grid, as in Logo.tsx) and the wordmark, edge to edge. On a wide screen they sit in one row
 * across the whole width: the word's ink about four fifths of it, its final "." a small margin from the right edge,
 * the mark hugging the left margin and taking what is left (a fifth of its size as the gap), centred on the word's ink.
 * On a phone, mark over word: the word across the full width, the mark centred above it at about five sixths of the
 * width. `cy` is the art's vertical centre in raster pixels.
 */
function rasterise(cols: number, rows: number, stacked: boolean, cy: number): Float32Array {
  const W = cols * S;
  const H = rows * SY;
  const cov = new Float32Array(cols * rows);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return cov;
  const word = 'collected.';
  const setFont = (px: number) => {
    ctx.font = `640 ${px}px ${SANS}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${-0.035 * px}px`;
    return ctx.measureText(word);
  };
  const t100 = setFont(100);
  // The word's ink, not its advance: the trailing letter spacing would otherwise pull the "." off the edge.
  const inkW = (t100.actualBoundingBoxLeft + t100.actualBoundingBoxRight) / 100;
  const margin = Math.max(S * 2, W * 0.022);
  const fs = ((stacked ? W - 2 * margin : W * 0.8) / inkW);
  const tm = setFont(fs);
  const asc = tm.actualBoundingBoxAscent;
  const desc = tm.actualBoundingBoxDescent;
  // The word's ink box ends at W - margin; wx is its pen position.
  const wx = W - margin - tm.actualBoundingBoxRight;
  const inkLeft = wx - tm.actualBoundingBoxLeft;
  let m: number;
  let mx: number;
  let my: number;
  let wy: number;
  if (stacked) {
    m = W * 0.84;
    const gap = m * 0.16;
    const total = m + gap + asc + desc;
    mx = (W - m) / 2;
    my = cy - total / 2;
    wy = my + m + gap + asc;
  } else {
    m = Math.max(0, (inkLeft - margin) / 1.2);
    mx = margin;
    my = cy - m / 2;
    wy = cy + (asc - desc) / 2;
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
 * the bottom before the top, and some scatter. Nothing starts before the art's top row is in view; `share` is the
 * canvas's part of the whole scroll run (the band, then whatever of the page lies below it).
 */
function glyphs(cov: Float32Array, cols: number, rows: number, share: number): Glyph[] {
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
  const start = Math.min(0.6, (r0 / Math.max(1, rows)) * share);
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


export function AsciiLogo({ className, center }: { className?: string; center?: RefObject<HTMLElement | null> }) {
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
      // About 190 cells across a desktop window; phones keep cells small enough that the word still reads.
      cw = Math.max(3.8, Math.min(10, W / 190));
      cols = Math.floor(W / cw);
      rows = Math.floor(H / (cw * R));
      // Centred on the `center` element (the headline card), which floats over the middle of the art. Offsets, not
      // the card's client rect, so its reveal translate does not move the art.
      const card = center?.current;
      const mid = card ? card.offsetTop + card.offsetHeight / 2 : H / 2;
      const cov = rasterise(cols, rows, window.innerWidth < 640, mid * (S / cw));
      const box = canvas.getBoundingClientRect();
      const below = Math.max(0, document.documentElement.scrollHeight - (window.scrollY + box.bottom));
      art = glyphs(cov, cols, rows, H / (H + below));
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

    // 0 as the band's top enters the viewport, 1 when the page can scroll no further.
    const progress = () => {
      const top = canvas.getBoundingClientRect().top;
      const run = document.documentElement.scrollHeight - (window.scrollY + top);
      return Math.max(0, Math.min(1, (window.innerHeight - top) / Math.max(1, run)));
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
  }, [center]);
  return <canvas ref={ref} aria-hidden className={cn('pointer-events-none block', className)} />;
}
