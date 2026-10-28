import type { ReactNode } from 'react';

export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-6">
      <h2 className="text-[26px] font-semibold leading-tight tracking-[-0.022em]">{children}</h2>
      {sub && <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-sub">{sub}</p>}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[13px] font-medium text-sub">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
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
