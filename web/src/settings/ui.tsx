import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-6">
      <h2 className="text-[26px] font-semibold leading-tight tracking-[-0.022em]">{children}</h2>
      {sub && <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-sub">{sub}</p>}
    </div>
  );
}

/** A labelled input. `error` (from `useFormMarks`) takes the hint's place in critical, under `errorId` for aria-describedby. */
export function Field({ label, hint, error, errorId, children }: { label: string; hint?: ReactNode; error?: ReactNode; errorId?: string; children: ReactNode }) {
  return (
    <label className="block min-w-0 space-y-1.5">
      <span className="text-[13px] font-medium text-sub">{label}</span>
      {children}
      {error ? (
        <span id={errorId} className="block text-xs font-medium text-critical">
          {error}
        </span>
      ) : (
        hint && <span className="block text-xs text-muted-foreground">{hint}</span>
      )}
    </label>
  );
}

/** A titled block on a settings page. */
export function Section({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-base font-semibold tracking-[-0.01em]">{title}</h3>
        {sub && <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-sub">{sub}</p>}
      </div>
      {children}
    </section>
  );
}

export type StatusTone = 'ok' | 'warn' | 'bad' | 'off';

/** A small status chip: a dot and a word. `ok` reads positive, `off` is an outline. */
export function StatusTag({ tone, children, className, title }: { tone: StatusTone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-[22px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-medium',
        tone === 'off' ? 'text-sub shadow-[inset_0_0_0_1px_var(--line-strong)]' : 'bg-well text-ink',
        className,
      )}
      title={title}
    >
      <span aria-hidden className={cn('size-1.5 rounded-full', tone === 'ok' && 'bg-positive', tone === 'warn' && 'bg-caution', tone === 'bad' && 'bg-critical', tone === 'off' && 'bg-ink-muted')} />
      {children}
    </span>
  );
}
