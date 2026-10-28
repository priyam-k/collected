import { useEffect, useState, useSyncExternalStore } from 'react';
import { format, isValid, parseISO } from 'date-fns';
import { ArrowUpRight, Check, Copy, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import type { SystemVersion, UpdateStatus } from '@collected/shared';
import { useCheckForUpdates, useSystemVersion, useUpdateStatus } from '@/lib/queries';
import { relative } from '@/lib/time';
import { cn } from '@/lib/utils';

/** Where the links point when the server cannot say (an older server without /api/system). */
export const DEFAULT_REPO = 'priyam-k/collected';

export const shortCommit = (c: string | null | undefined) => (c ? c.slice(0, 7) : '');

/** "collected 0.1.0 · 3cca809" */
export function buildLine(v: Pick<SystemVersion, 'version' | 'commit'> | null | undefined): string | null {
  if (!v) return null;
  return ['collected ' + v.version, shortCommit(v.commit)].filter(Boolean).join(' · ');
}

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

// The upstream commit the person chose to stop hearing about. The pill comes back when upstream moves past it.
const DISMISS_KEY = 'collected.update.dismissed';
const DISMISS_EVENT = 'collected:update-dismissed';

function readDismissed(): string | null {
  try {
    return window.localStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

function subscribeDismissed(cb: () => void) {
  window.addEventListener('storage', cb);
  window.addEventListener(DISMISS_EVENT, cb);
  return () => {
    window.removeEventListener('storage', cb);
    window.removeEventListener(DISMISS_EVENT, cb);
  };
}

function writeDismissed(commit: string) {
  try {
    window.localStorage.setItem(DISMISS_KEY, commit);
  } catch {
    // private window or blocked storage: the pill simply stays
  }
  window.dispatchEvent(new Event(DISMISS_EVENT));
}

/**
 * Everything the dashboard needs to decide whether to mention an update. Every field degrades to "nothing to say"
 * while loading, on error, or against a server that does not have the endpoints yet.
 */
export function useUpdateState() {
  const status = useUpdateStatus();
  const version = useSystemVersion();
  const dismissedCommit = useSyncExternalStore(subscribeDismissed, readDismissed, () => null);
  const data = status.data && typeof status.data === 'object' ? status.data : undefined;
  const upstream = data?.upstream ?? null;
  const available = !!upstream && upstream.ahead > 0;
  const dismissed = available && dismissedCommit === upstream.commit;
  const current = (data?.current ?? (version.data && typeof version.data === 'object' ? version.data : undefined)) || undefined;
  return {
    status: data,
    current,
    available,
    /** Available and not dismissed: worth a pill and a dot. */
    nudge: available && !dismissed,
    matters: upstream?.matters ?? false,
    dismiss: () => upstream && writeDismissed(upstream.commit),
  };
}

function niceDate(s: string): string {
  const d = parseISO(s);
  return isValid(d) ? format(d, 'MMM d, yyyy') : s;
}

/** A button that copies text and says so for a moment. */
export function CopyButton({ text, className }: { text: string; className?: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = window.setTimeout(() => setDone(false), 1600);
    return () => window.clearTimeout(t);
  }, [done]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
    } catch {
      toast.error('Could not copy; select the text instead');
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={done ? 'Copied' : 'Copy commands'}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-full bg-surface px-2.5 text-[12px] font-[560] text-sub shadow-[var(--shadow-card),inset_0_0_0_1px_var(--line)] transition-[color,background-color,transform] duration-150 hover:bg-surface-hover hover:text-ink active:scale-[.96]',
        done && 'text-positive hover:text-positive',
        className,
      )}
    >
      {done ? <Check className="size-3.5" strokeWidth={2.2} /> : <Copy className="size-3.5" strokeWidth={1.8} />}
      {done ? 'Copied' : 'Copy'}
    </button>
  );
}

/** The commands to run, in a well, with a Copy button pinned to its corner. */
export function StepsWell({ steps }: { steps: string[] }) {
  if (!steps.length) return null;
  const text = steps.join('\n');
  return (
    <div className="relative rounded-[14px] bg-well">
      <div className="flex items-center justify-between gap-2 py-1.5 pl-3 pr-1.5">
        <p className="label !text-[10.5px]">To update</p>
        <CopyButton text={text} />
      </div>
      <pre className="overflow-x-auto px-3 pb-3 font-mono text-[11.5px] leading-[1.65] text-ink [scrollbar-width:thin]">
        {steps.map((s, i) => (
          <code key={i} className="block whitespace-pre">
            <span className="select-none text-ter">$ </span>
            {s}
          </code>
        ))}
      </pre>
    </div>
  );
}

/** What changed upstream: one block per changelog section, newest first. */
export function ChangelogList({ entries }: { entries: UpdateStatus['changelog'] }) {
  if (!entries.length) return null;
  return (
    <ol className="space-y-3.5">
      {entries.map((e) => (
        <li key={`${e.version}-${e.date}`}>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="font-mono text-[12.5px] font-medium text-ink">{e.version}</span>
            <span className="text-[12px] text-ter">{niceDate(e.date)}</span>
            <span
              className={cn(
                'ml-auto rounded-full px-2 py-px text-[10.5px] font-[620] uppercase tracking-[0.06em] [font-stretch:112%]',
                e.level === 'recommended' ? 'bg-[color-mix(in_srgb,var(--positive)_13%,transparent)] text-positive' : 'bg-well text-ink-muted',
              )}
            >
              {e.level}
            </span>
          </div>
          {e.notes.length > 0 && (
            <ul className="mt-1.5 space-y-1 text-[13px] leading-[1.45] text-sub">
              {e.notes.map((n, i) => (
                <li key={i} className="relative pl-3.5 before:absolute before:left-0.5 before:top-[0.6em] before:size-[4px] before:rounded-full before:bg-line-strong">
                  {n}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}

/** "Check again" with a spinner while the server asks GitHub. */
export function CheckAgainButton({ label = 'Check again', className }: { label?: string; className?: string }) {
  const check = useCheckForUpdates();
  return (
    <button
      type="button"
      onClick={() => check.mutate(undefined, { onError: (e) => toast.error(e instanceof Error ? e.message : 'Check failed') })}
      disabled={check.isPending}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-[560] text-sub transition-[color,background-color,transform] duration-150 hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] hover:text-ink active:scale-[.97] disabled:opacity-60',
        className,
      )}
    >
      <RefreshCw className={cn('size-3.5', check.isPending && 'animate-spin motion-reduce:animate-none')} strokeWidth={1.9} />
      {check.isPending ? 'Checking…' : label}
    </button>
  );
}

export function updateTitle(upstream: NonNullable<UpdateStatus['upstream']>): string {
  return upstream.matters ? `Update available · ${plural(upstream.ahead, 'commit')}` : `${plural(upstream.ahead, 'commit')}, nothing that changes the app`;
}

/**
 * The update story, shared by the dashboard pill's popover, the build line in the profile menu and Settings → About.
 * `inline` drops the title, the running build line and the buttons, which the About page already shows.
 */
export function UpdatePanel({ status, onDismiss, inline = false }: { status: UpdateStatus; onDismiss?: () => void; inline?: boolean }) {
  const upstream = status.upstream;
  const line = buildLine(status.current);
  return (
    <div className="space-y-4">
      {!inline && (
        <div>
          <p className="label !text-[10.5px]">{upstream?.matters ? 'New version' : 'Upstream'}</p>
          <h2 className="mt-1 text-[16px] font-[620] leading-snug tracking-[-0.012em]">{upstream ? updateTitle(upstream) : 'Up to date'}</h2>
          {upstream && (
            <p className="mt-0.5 text-[12px] text-ter">
              {upstream.version ? <>Upstream is <span className="font-mono">{upstream.version}</span> · </> : null}checked {relative(upstream.checkedAt)}
            </p>
          )}
        </div>
      )}

      <ChangelogList entries={status.changelog} />

      {!upstream?.matters && status.changelog.length === 0 && upstream && (
        <p className="text-[13px] leading-[1.45] text-sub">Upstream changed docs or tooling only. Pull whenever it suits you; nothing in the running app would change.</p>
      )}

      <StepsWell steps={status.steps} />

      {upstream?.url && (
        <a href={upstream.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13px] font-[560] text-brand-ink underline-offset-[3px] hover:underline">
          Compare on GitHub <ArrowUpRight className="size-3.5" strokeWidth={2} />
        </a>
      )}

      {/* Inline, on the About page, the build and the check button already sit above the panel. */}
      {!inline && (
        <div className="border-t border-line pt-3">
          {line && <p className="font-mono text-[11.5px] text-ter">{line}</p>}
          <div className={cn('-ml-3 flex flex-wrap items-center gap-0.5', line && 'mt-1.5')}>
            <CheckAgainButton />
            {onDismiss && upstream && (
              <button
                type="button"
                onClick={onDismiss}
                className="inline-flex h-8 items-center rounded-full px-3 text-[12.5px] font-[560] text-sub transition-[color,background-color,transform] duration-150 hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] hover:text-ink active:scale-[.97]"
              >
                Dismiss until next version
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
