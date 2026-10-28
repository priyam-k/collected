import { useCallback, useRef } from 'react';

/**
 * Caustic's two moving parts, as ref callbacks.
 *
 * useLiquid: the selection highlight of a segmented control or tab list travels to the new item like a drop of
 * liquid. It rides an underdamped spring (one visible overshoot, settled in about half a second), stretches along
 * its path and thins while moving fast, squashes against the track's padding instead of poking out, and squishes
 * while pressed. It is drawn with real width and height, never scale(), so its rounded ends stay round. Under
 * reduced motion it jumps. The current item is whichever child matches CURRENT.
 *
 * useGlass: edge refraction for liquid glass in Chromium. Content behind the rim bends, the middle stays clear.
 * Elsewhere, and under reduced transparency, the plain blur from the `.glass` class stays.
 */

const CURRENT = '.seg-on, [aria-current]:not([aria-current="false"]), [aria-pressed="true"], [aria-selected="true"], [aria-checked="true"], [data-state="active"]';

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

interface Spring {
  v: number;
  vel: number;
  to: number;
}

function attachLiquid(box: HTMLElement, stiffness = 380, damping = 21): () => void {
  const thumb = document.createElement('span');
  thumb.className = 'liquid-thumb';
  thumb.setAttribute('aria-hidden', 'true');
  box.insertBefore(thumb, box.firstChild);
  box.classList.add('liquid-live');

  const sp = (): Spring => ({ v: 0, vel: 0, to: 0 });
  const x = sp(), y = sp(), w = sp(), h = sp(), pr = sp();
  let raf = 0;
  let placed = false;
  let current: Element | null = null;

  const step = (s: Spring, k: number, c: number, dt: number) => {
    s.vel += (k * (s.to - s.v) - c * s.vel) * dt;
    s.v += s.vel * dt;
  };
  const still = (s: Spring, e: number) => Math.abs(s.to - s.v) < e && Math.abs(s.vel) < e * 10;
  const snap = (s: Spring) => {
    s.v = s.to;
    s.vel = 0;
  };

  const paint = () => {
    const sx = Math.min(Math.abs(x.vel) / 2600, 0.28);
    const sy = Math.min(Math.abs(y.vel) / 2600, 0.28);
    const p = Math.max(-0.5, Math.min(1.5, pr.v));
    const cs = getComputedStyle(box);
    const hw = (Math.max(0, w.v) * (1 + sx) * (1 - sy * 0.45) * (1 + 0.05 * p)) / 2;
    const hh = (Math.max(0, h.v) * (1 + sy) * (1 - sx * 0.45) * (1 - 0.09 * p)) / 2;
    const cx = x.v + w.v / 2;
    const cy = y.v + h.v / 2;
    const l = Math.max(parseFloat(cs.paddingLeft), cx - hw);
    const r = Math.min(box.scrollWidth - parseFloat(cs.paddingRight), cx + hw);
    const t = Math.max(parseFloat(cs.paddingTop), cy - hh);
    const b = Math.min(box.scrollHeight - parseFloat(cs.paddingBottom), cy + hh);
    thumb.style.width = `${Math.max(0, r - l)}px`;
    thumb.style.height = `${Math.max(0, b - t)}px`;
    thumb.style.transform = `translate(${l}px, ${t}px)`;
  };

  const run = () => {
    if (raf) cancelAnimationFrame(raf);
    let last = performance.now();
    const tick = (now: number) => {
      let dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      while (dt > 0) {
        const d = Math.min(dt, 1 / 240);
        for (const s of [x, y, w, h]) step(s, stiffness, damping, d);
        step(pr, 520, 18, d);
        dt -= d;
      }
      paint();
      if ([x, y, w, h].every((s) => still(s, 0.1)) && still(pr, 0.002)) {
        for (const s of [x, y, w, h, pr]) snap(s);
        paint();
        raf = 0;
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  };

  // relayout: re-aim a running animation, or jump when at rest
  const aim = (relayout: boolean) => {
    let el = box.querySelector(CURRENT) as HTMLElement | null;
    if (!el) {
      thumb.style.width = '0px';
      current = null;
      placed = false;
      return;
    }
    while (el.parentElement && el.parentElement !== box && el.offsetParent !== box) el = el.parentElement;
    const moved = el !== current;
    current = el;
    x.to = el.offsetLeft;
    y.to = el.offsetTop;
    w.to = el.offsetWidth;
    h.to = el.offsetHeight;
    if (relayout && raf) return;
    if (!placed || reducedMotion() || (relayout && !moved)) {
      for (const s of [x, y, w, h]) snap(s);
      placed = true;
      paint();
    } else if (moved || relayout) run();
  };

  const down = (e: PointerEvent) => {
    if (reducedMotion() || !(e.target as Element).closest?.('button, a, [role=tab], [role=radio]')) return;
    pr.to = 1;
    run();
  };
  const up = () => {
    if (pr.to) {
      pr.to = 0;
      run();
    }
  };

  // React owns the box's className and children, so a re-render can drop the marker class or the thumb: put them back.
  const mo = new MutationObserver(() => {
    if (!box.classList.contains('liquid-live')) box.classList.add('liquid-live');
    if (thumb.parentElement !== box) box.insertBefore(thumb, box.firstChild);
    aim(false);
  });
  mo.observe(box, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'aria-current', 'aria-pressed', 'aria-selected', 'aria-checked', 'data-state'] });
  const ro = new ResizeObserver(() => aim(true));
  ro.observe(box);
  document.fonts?.ready.then(() => aim(true));
  box.addEventListener('pointerdown', down);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
  aim(false);

  return () => {
    mo.disconnect();
    ro.disconnect();
    if (raf) cancelAnimationFrame(raf);
    box.removeEventListener('pointerdown', down);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    thumb.remove();
    box.classList.remove('liquid-live');
  };
}

/** Ref callback that gives a `.seg` (or any track whose items mark the current one) the springy thumb. */
export function useLiquid<T extends HTMLElement = HTMLElement>(): (el: T | null) => void {
  const off = useRef<(() => void) | null>(null);
  return useCallback((el: T | null) => {
    off.current?.();
    off.current = el ? attachLiquid(el) : null;
  }, []);
}

/* ---------- glass ---------- */

const filters = new Map<string, string>();

/** A displacement map that pushes pixels outward near the rounded rim and leaves the middle alone. */
function refractFilter(W: number, H: number, rad: number, edge: number, scale: number): string {
  const key = [W, H, rad, edge, scale].join('-');
  const hit = filters.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  const d = img.data;
  for (let py = 0; py < H; py++)
    for (let px = 0; px < W; px++) {
      const cx = px + 0.5 - W / 2;
      const cy = py + 0.5 - H / 2;
      const qx = Math.abs(cx) - (W / 2 - rad);
      const qy = Math.abs(cy) - (H / 2 - rad);
      const ox = Math.max(qx, 0);
      const oy = Math.max(qy, 0);
      const len = Math.sqrt(ox * ox + oy * oy);
      const dist = -(len + Math.min(Math.max(qx, qy), 0) - rad);
      let nx: number;
      let ny: number;
      if (qx > 0 && qy > 0) {
        nx = ox / (len || 1);
        ny = oy / (len || 1);
      } else if (qx > qy) {
        nx = 1;
        ny = 0;
      } else {
        nx = 0;
        ny = 1;
      }
      nx *= cx < 0 ? -1 : 1;
      ny *= cy < 0 ? -1 : 1;
      const t = Math.max(0, 1 - dist / edge);
      const m = t * t * t;
      const i = (py * W + px) * 4;
      d[i] = 128 - nx * m * 127;
      d[i + 1] = 128 - ny * m * 127;
      d[i + 2] = 128;
      d[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  const id = `glass-refract-${filters.size}`;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.position = 'absolute';
  const f = document.createElementNS(NS, 'filter');
  for (const [k, v] of Object.entries({ id, x: '0', y: '0', width: String(W), height: String(H), filterUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB' })) f.setAttribute(k, v);
  const fi = document.createElementNS(NS, 'feImage');
  for (const [k, v] of Object.entries({ href: c.toDataURL(), x: '0', y: '0', width: String(W), height: String(H), preserveAspectRatio: 'none', result: 'map' })) fi.setAttribute(k, v);
  const dm = document.createElementNS(NS, 'feDisplacementMap');
  for (const [k, v] of Object.entries({ in: 'SourceGraphic', in2: 'map', scale: String(scale), xChannelSelector: 'R', yChannelSelector: 'G' })) dm.setAttribute(k, v);
  f.append(fi, dm);
  svg.append(f);
  document.body.append(svg);
  filters.set(key, id);
  return id;
}

function attachGlass(el: HTMLElement, scale = 16): () => void {
  if (!/Chrome\//.test(navigator.userAgent)) return () => {};
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-transparency: reduce)').matches) return () => {};
  const apply = () => {
    const W = Math.round(el.offsetWidth);
    const H = Math.round(el.offsetHeight);
    if (!W || !H) return;
    const rad = Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0, Math.min(W, H) / 2);
    const id = refractFilter(W, H, Math.round(rad), Math.round(Math.min(W, H) * 0.3), scale);
    const v = `url(#${id}) blur(2px) saturate(150%)`;
    el.style.backdropFilter = v;
    el.style.setProperty('-webkit-backdrop-filter', v);
  };
  apply();
  // While the pill animates its width, wait for it to settle instead of building a map for every frame.
  let timer = 0;
  const ro = new ResizeObserver(() => {
    window.clearTimeout(timer);
    timer = window.setTimeout(apply, 140);
  });
  ro.observe(el);
  return () => {
    window.clearTimeout(timer);
    ro.disconnect();
    el.style.backdropFilter = '';
    el.style.removeProperty('-webkit-backdrop-filter');
  };
}

/** Ref callback for a `.glass` element: adds edge refraction where the browser can draw it. */
export function useGlass<T extends HTMLElement = HTMLElement>(): (el: T | null) => void {
  const off = useRef<(() => void) | null>(null);
  return useCallback((el: T | null) => {
    off.current?.();
    off.current = el ? attachGlass(el) : null;
  }, []);
}
