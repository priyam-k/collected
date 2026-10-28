/**
 * Caustic instruments: rings and rows of ticks. Filled ticks take the colour they are given (a course colour, or the
 * accent), the rest are --tick, the "off" lamp. They are decorative (aria-hidden); the number they show is always
 * also present as text.
 */

interface ArcProps {
  cx: number;
  cy: number;
  /** Outer radius of the ticks. */
  r: number;
  /** Tick length, inward from r. */
  len: number;
  /** 0..1 */
  value: number;
  color: string;
  /** Tick count for the full circle; defaults to one per ~4.6 units of circumference. */
  ticks?: number;
  width?: number;
}

/** One full ring of radial ticks, filled clockwise from 12 o'clock. Draw inside an <svg>. */
export function TickArc({ cx, cy, r, len, value, color, ticks, width = 1.4 }: ArcProps) {
  const n = ticks ?? Math.max(12, Math.round((2 * Math.PI * r) / 4.6));
  const lit = Math.round(n * Math.max(0, Math.min(1, value)));
  const inner = r - len;
  return (
    <g strokeLinecap="round" strokeWidth={width}>
      {Array.from({ length: n }, (_, i) => {
        const a = (i / n) * 2 * Math.PI - Math.PI / 2;
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        return <line key={i} x1={cx + inner * cos} y1={cy + inner * sin} x2={cx + r * cos} y2={cy + r * sin} stroke={i < lit ? color : 'var(--tick)'} />;
      })}
    </g>
  );
}

/** A row of ticks; value 0..100. */
export function Meter({ value, color, height = 12, className }: { value: number; color?: string; height?: number; className?: string }) {
  return <span aria-hidden className={`meter block ${className ?? ''}`} style={{ '--value': Math.max(0, Math.min(100, value)), '--meter-h': `${height}px`, ...(color ? { '--meter-color': color } : {}) } as React.CSSProperties} />;
}
