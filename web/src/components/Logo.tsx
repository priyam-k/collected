import { cn } from '@/lib/utils';

/**
 * The collected mark: a board of three tiles, a tall one and a square one in ink, and a round one in the accent: the
 * period, the same one that ends the wordmark. Geometry on a 32 grid; the static icons in web/public/icons and
 * docs/brand are drawn from the same numbers (scripts/brand.mjs).
 */
export function LogoMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('shrink-0', className)} role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <rect x="2.5" y="2.5" width="12" height="27" rx="4" fill="currentColor" />
      <rect x="17.5" y="2.5" width="12" height="12" rx="4" fill="currentColor" />
      <circle cx="23.5" cy="23.5" r="6" fill="var(--brand)" />
    </svg>
  );
}

/** "collected." in Mona Sans, the period in the accent. Size it with font-size on the className. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('font-[640] tracking-[-0.035em]', className)}>
      collected<span className="text-brand">.</span>
    </span>
  );
}

/** Mark and wordmark together; `size` is the wordmark's font size in px, the mark scales with it. */
export function Logo({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <span className={cn('inline-flex items-center', className)} style={{ gap: size * 0.45, fontSize: size }}>
      <LogoMark className="h-[1.3em] w-[1.3em]" />
      <Wordmark className="leading-none" />
    </span>
  );
}
