import { useState } from 'react';
import { describeScopes, isFullScopes, TOKEN_AREA_INFO, TOKEN_AREAS, type TokenAccess, type TokenArea, type TokenScopes } from '@collected/shared';
import { cn } from '@/lib/utils';

const ACCESS: { value: TokenAccess | 'none'; label: string }[] = [
  { value: 'none', label: 'No access' },
  { value: 'read', label: 'Read' },
  { value: 'write', label: 'Read and write' },
];

/**
 * What a new token may touch. `null` is Everything (what a laptop CLI wants); an object is "Only some areas", where a
 * missing area means no access. `{}` is a valid draft here but not a valid token: the caller keeps Create disabled.
 */
export function TokenScopePicker({ value, onChange }: { value: TokenScopes | null; onChange: (v: TokenScopes | null) => void }) {
  // The last "only some areas" picks, so flipping to Everything and back does not lose them.
  const [draft, setDraft] = useState<TokenScopes>({});
  const some = value !== null;

  const set = (area: TokenArea, access: TokenAccess | 'none') => {
    const next: TokenScopes = { ...value };
    if (access === 'none') delete next[area];
    else next[area] = access;
    setDraft(next);
    onChange(next);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span id="token-access-label" className="text-[13px] font-medium text-sub">
          Access
        </span>
        <span className="seg" role="group" aria-labelledby="token-access-label">
          <button type="button" className={cn(!some && 'seg-on')} aria-pressed={!some} onClick={() => onChange(null)}>
            Everything
          </button>
          <button type="button" className={cn(some && 'seg-on')} aria-pressed={some} onClick={() => onChange(draft)}>
            Only some areas
          </button>
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        Handing it to an AI agent? Read lets it look, write also lets it add and change things in that area. No token can touch credentials, settings or other tokens, whatever its access.
      </p>
      {some && (
        <ul className="divide-y divide-line rounded-2xl bg-well/60" aria-label="Access by area">
          {TOKEN_AREAS.map((area) => {
            const info = TOKEN_AREA_INFO[area];
            const current = value[area] ?? 'none';
            return (
              <li key={area} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
                <div className="min-w-[12rem] flex-1">
                  <div className="text-[13px] font-medium">{info.label}</div>
                  <div className="text-xs text-muted-foreground">{info.covers}</div>
                </div>
                <span className="seg shrink-0" role="group" aria-label={`${info.label} access`}>
                  {ACCESS.map((a) => (
                    <button
                      key={a.value}
                      type="button"
                      className={cn(current === a.value && 'seg-on')}
                      aria-pressed={current === a.value}
                      onClick={() => set(area, a.value)}
                      title={a.value === 'read' ? `Can ${info.read}` : a.value === 'write' ? `Can also ${info.write}` : undefined}
                    >
                      {a.label}
                    </button>
                  ))}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** A token's access in a list row: "everything" as text, otherwise one small chip per area (`rw`/`r` on a phone). */
export function ScopeChips({ scopes, className }: { scopes: TokenScopes | null; className?: string }) {
  if (isFullScopes(scopes)) return <span className={cn('shrink-0 text-xs text-sub', className)}>everything</span>;
  const areas = TOKEN_AREAS.filter((a) => scopes![a]);
  return (
    <span className={cn('flex min-w-0 gap-1 overflow-hidden', className)} title={describeScopes(scopes)}>
      <span className="sr-only">{describeScopes(scopes)}</span>
      {areas.map((a) => {
        const write = scopes![a] === 'write';
        return (
          <span key={a} aria-hidden className="inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-full bg-well px-2 text-[11px] font-medium text-sub">
            {a}
            <span className="px-1 text-ter">·</span>
            <span className="sm:hidden">{write ? 'rw' : 'r'}</span>
            <span className="hidden sm:inline">{write ? 'read, write' : 'read'}</span>
          </span>
        );
      })}
    </span>
  );
}
