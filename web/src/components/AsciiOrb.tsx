import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

const RAMP = '.,-~:;=!*#$@';

/**
 * A sphere drawn in characters, its light slowly circling. Caustic's one textured object: use at most one per
 * screen, in a well or a margin. Decorative (aria-hidden). Pauses off-screen; under reduced motion it draws once.
 */
export function AsciiOrb({ className, speed = 0.25, fps = 10 }: { className?: string; speed?: number; fps?: number }) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const pre = ref.current;
    if (!pre) return;
    let cw = 6.6;
    let ch = 12;
    let cols = 1;
    let rows = 1;
    const measure = () => {
      const s = document.createElement('span');
      s.textContent = 'MMMMMMMMMM';
      s.style.visibility = 'hidden';
      pre.appendChild(s);
      cw = s.getBoundingClientRect().width / 10 || 6.6;
      pre.removeChild(s);
      ch = parseFloat(getComputedStyle(pre).lineHeight) || 12;
      cols = Math.max(1, Math.floor(pre.clientWidth / cw));
      rows = Math.max(1, Math.floor(pre.clientHeight / ch));
    };
    const draw = (t: number) => {
      if (Math.floor(pre.clientWidth / cw) !== cols || Math.floor(pre.clientHeight / ch) !== rows) measure();
      const a = t * speed + 0.9;
      let lx = Math.cos(a);
      let ly = -0.35;
      let lz = Math.sin(a) * 0.9 + 0.35;
      const ln = Math.hypot(lx, ly, lz);
      lx /= ln;
      ly /= ln;
      lz /= ln;
      const R = Math.min(cols * cw, rows * ch) * 0.46;
      let out = '';
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const px = ((x + 0.5) * cw - (cols * cw) / 2) / R;
          const py = ((y + 0.5) * ch - (rows * ch) / 2) / R;
          const rr = px * px + py * py;
          if (rr > 1) {
            out += ' ';
            continue;
          }
          const b = px * lx + py * ly + Math.sqrt(1 - rr) * lz;
          out += b <= 0 ? (rr > 0.94 ? '.' : ' ') : RAMP.charAt(Math.min(RAMP.length - 1, Math.floor(b * RAMP.length)));
        }
        if (y < rows - 1) out += '\n';
      }
      pre.textContent = out;
    };

    measure();
    draw(0);
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;
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
    io.observe(pre);
    raf = requestAnimationFrame(frame);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, [speed, fps]);
  return <pre ref={ref} aria-hidden className={cn('m-0 select-none overflow-hidden whitespace-pre font-mono text-[11px] leading-[12px] tracking-normal text-sub', className)} />;
}
