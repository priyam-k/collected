import type { ReactNode } from 'react';
import { ArrowUpRight, BookOpen, CircleAlert, CircleArrowUp, CircleCheck, CircleDot, RefreshCw, ScrollText, Server } from 'lucide-react';
import { toast } from 'sonner';
import { Wordmark } from '@/components/Logo';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { useCheckForUpdates, useSystemVersion, useUpdateStatus } from '@/lib/queries';
import { relative } from '@/lib/time';
import { cn } from '@/lib/utils';
import { DEFAULT_REPO, UpdatePanel, plural, shortCommit, updateTitle } from '@/dashboard/UpdatePanel';
import { Section } from './ui';

const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

function builtLabel(iso: string | null | undefined): string {
  if (!iso) return 'Not recorded (development build)';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 py-2.5 sm:grid-cols-[9rem_1fr] sm:gap-4">
      <dt className="text-[13px] text-sub">{label}</dt>
      <dd className="min-w-0 text-[14px] text-ink">{children}</dd>
    </div>
  );
}

function ExternalLink({ href, icon, title, sub }: { href: string; icon: ReactNode; title: string; sub: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="group flex items-center gap-3 rounded-2xl bg-surface p-3.5 shadow-[var(--shadow-card),inset_0_0_0_1px_var(--line)] transition-[background-color,transform] duration-150 hover:bg-surface-hover active:scale-[.99]"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-well text-sub transition-colors group-hover:text-ink">{icon}</span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block text-[14px] font-[560]">{title}</span>
        <span className="mt-0.5 block truncate text-[12.5px] text-sub">{sub}</span>
      </span>
      <ArrowUpRight className="size-4 shrink-0 text-ter transition-[color,transform] duration-150 group-hover:-translate-y-px group-hover:translate-x-px group-hover:text-ink motion-reduce:transition-none" strokeWidth={1.8} />
    </a>
  );
}

/** Settings → About: what is running, whether upstream has moved, where the project lives, and who made it. */
export function AboutPage() {
  const version = useSystemVersion();
  const update = useUpdateStatus();
  const check = useCheckForUpdates();

  const status = update.data && typeof update.data === 'object' ? update.data : undefined;
  const current = status?.current ?? (version.data && typeof version.data === 'object' ? version.data : undefined);
  const repo = current?.repo && REPO_RE.test(current.repo) ? current.repo : DEFAULT_REPO;
  const gh = `https://github.com/${repo}`;
  const upstream = status?.upstream ?? null;
  const unsupported = (update.error instanceof ApiError && update.error.status === 404) || (!status && update.isError);
  const host = typeof window !== 'undefined' ? window.location.host : '';

  let state: ReactNode;
  if (update.isPending) state = <span className="text-sub">Checking…</span>;
  else if (unsupported && !status) state = <span className="text-sub">This server does not report updates.</span>;
  else if (upstream && upstream.ahead > 0)
    state = (
      <span className="inline-flex items-center gap-1.5 font-[560]">
        <CircleArrowUp className={cn('size-4', upstream.matters ? 'text-brand' : 'text-ink-muted')} strokeWidth={1.9} />
        {plural(upstream.ahead, 'commit')} behind{!upstream.matters && <span className="font-normal text-sub">, docs and tooling only</span>}
      </span>
    );
  else if (upstream)
    state = (
      <span className="inline-flex items-center gap-1.5 font-[560] text-positive">
        <CircleCheck className="size-4" strokeWidth={1.9} /> Up to date
      </span>
    );
  else if (status?.error)
    state = (
      <span className="inline-flex items-start gap-1.5 text-caution">
        <CircleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.9} />
        <span><span className="font-[560]">Check failed</span><span className="text-sub"> · {status.error}</span></span>
      </span>
    );
  else state = <span className="text-sub">Not checked yet</span>;

  return (
    <div className="space-y-10">
      <div className="flex items-center gap-4">
        <img src="/icons/icon.svg" alt="" className="size-14 shrink-0 rounded-[16px] shadow-[var(--shadow-card)]" />
        <div className="min-w-0">
          <h2 className="text-[30px] leading-none">
            <Wordmark />
          </h2>
          <p className="mt-2 text-[14.5px] leading-snug text-sub">Canvas, Gradescope, Google Calendar, Todoist and a job feed in one dashboard you host yourself.</p>
        </div>
      </div>

      <Section title="This build">
        <dl className="divide-y divide-line rounded-2xl bg-well/60 px-4">
          <Row label="Version">{current ? <span className="font-mono text-[13px]">{current.version}</span> : <span className="text-sub">{version.isPending ? '…' : 'Unknown'}</span>}</Row>
          <Row label="Commit">
            {current?.commit ? (
              <a href={`${gh}/commit/${current.commit}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-[13px] text-brand-ink underline-offset-[3px] hover:underline">
                {shortCommit(current.commit)} <ArrowUpRight className="size-3.5" strokeWidth={2} />
              </a>
            ) : (
              <span className="text-sub">{version.isPending ? '…' : 'Unknown'}</span>
            )}
          </Row>
          <Row label="Built">{current ? builtLabel(current.builtAt) : <span className="text-sub">{version.isPending ? '…' : 'Unknown'}</span>}</Row>
          <Row label="This instance">{host ? <span className="font-mono text-[13px]">{host}</span> : <span className="text-sub">Unknown</span>}</Row>
          <Row label="Updates">
            <div className="space-y-0.5">
              {state}
              {upstream?.checkedAt && <p className="text-[12px] text-ter">Checked {relative(upstream.checkedAt)}{upstream.version ? <> · upstream <span className="font-mono">{upstream.version}</span></> : null}</p>}
            </div>
          </Row>
        </dl>
        {!(unsupported && !status) && (
          <Button
            variant="outline"
            onClick={() => check.mutate(undefined, { onError: (e) => toast.error(e instanceof Error ? e.message : 'Check failed') })}
            disabled={check.isPending}
          >
            <RefreshCw className={cn(check.isPending && 'animate-spin motion-reduce:animate-none')} strokeWidth={1.9} />
            {check.isPending ? 'Checking…' : 'Check for updates'}
          </Button>
        )}
        {status && upstream && upstream.ahead > 0 && (
          <div className="rounded-2xl p-4 shadow-[inset_0_0_0_1px_var(--line)] sm:p-5">
            <h4 className="mb-3.5 text-[15px] font-[620] tracking-[-0.01em]">{updateTitle(upstream)}</h4>
            <UpdatePanel status={status} inline />
          </div>
        )}
      </Section>

      <Section title="Project">
        <div className="grid gap-2.5 sm:grid-cols-2">
          <ExternalLink href={gh} icon={<CircleDot className="size-[18px]" strokeWidth={1.7} />} title="Repository" sub={`github.com/${repo}`} />
          <ExternalLink href={`${gh}/blob/main/CHANGELOG.md`} icon={<ScrollText className="size-[18px]" strokeWidth={1.7} />} title="Changelog" sub="What changed in each version" />
          <ExternalLink href={`${gh}/blob/main/docs/self-host.md`} icon={<Server className="size-[18px]" strokeWidth={1.7} />} title="Self-host guide" sub="Install, update, back up" />
          <ExternalLink href={`${gh}/issues`} icon={<BookOpen className="size-[18px]" strokeWidth={1.7} />} title="Issues" sub="Report a bug or ask for a feature" />
        </div>
      </Section>

      <Section title="Credits">
        <div className="space-y-2 text-[14px] leading-relaxed">
          <p>
            Made by{' '}
            <a href="https://priyamkabra.com" target="_blank" rel="noreferrer" className="font-[560] text-brand-ink underline-offset-[3px] hover:underline">
              Priyam Kabra
            </a>
          </p>
          <p>
            <a href={`${gh}/blob/main/LICENSE`} target="_blank" rel="noreferrer" className="text-sub underline decoration-line-strong underline-offset-[3px] transition-colors hover:text-ink hover:decoration-brand">
              © 2026 Priyam Kabra · AGPL-3.0-only
            </a>
          </p>
          <p className="max-w-2xl text-[13px] text-sub">
            Thanks to Canvas, Gradescope, Google Calendar and Todoist, which do the real work. Their names are trademarks of their respective owners; collected is not affiliated with or endorsed by any of them.
          </p>
        </div>
      </Section>
    </div>
  );
}
