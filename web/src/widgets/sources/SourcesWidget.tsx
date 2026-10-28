import { Link } from 'react-router';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { SOURCE_LABELS, type Source, type SourceStatus } from '@collected/shared';
import { WidgetHeader } from '@/dashboard/WidgetHeader';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useSources, useSyncSource } from '@/lib/queries';
import { relative } from '@/lib/time';
import { cn } from '@/lib/utils';
import { ErrorState, ListSkeleton } from '@/widgets/Placeholder';
import { HOVER_REVEAL } from '@/widgets/shared';
import type { WidgetProps } from '@/widgets/types';
import { useNow } from '@/widgets/useNow';

const STATUS_LABEL: Record<SourceStatus, string> = { connected: 'Live', needs_auth: 'Needs auth', error: 'Error', disconnected: 'Not set up' };

/** "5 min", "2 h", "3 d" — the compact form the sources list uses. */
function shortAgo(iso: string | null, now: number): string {
  if (!iso) return '—';
  const ms = now - new Date(iso).getTime();
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 1) return 'now';
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} d`;
}

function Dot({ s, className }: { s: Source; className?: string }) {
  const standby = s.id === 'canvas_ical' && s.status !== 'error';
  if (s.status === 'connected' && !standby) return <span className={cn('size-2 shrink-0 rounded-full bg-positive', className)} />;
  if (s.status === 'error') return <span className={cn('size-2 shrink-0 rounded-full bg-critical', className)} />;
  if (s.status === 'needs_auth') return <span className={cn('size-2 shrink-0 rounded-full bg-caution', className)} />;
  return <span className={cn('size-2 shrink-0 rounded-full shadow-[inset_0_0_0_1.5px_var(--line-strong)]', className)} />;
}

export function SourcesWidget({ size }: WidgetProps) {
  const q = useSources();
  const sync = useSyncSource();
  const now = useNow(60_000).getTime();

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const list = (q.data ?? []).filter((s) => s.enabled || s.status !== 'disconnected');
  const attention = list.filter((s) => s.status === 'error' || s.status === 'needs_auth');

  const runSync = (s: Source) => {
    sync.mutate(s.id, {
      onSuccess: (r) => {
        const o = r.outcome as { ok: boolean; error?: string; skipped?: string; ms?: number };
        if (o.ok) toast.success(`${SOURCE_LABELS[s.id]} synced`);
        else if (o.skipped) toast.info(`${SOURCE_LABELS[s.id]}: ${o.skipped}`);
        else toast.error(`${SOURCE_LABELS[s.id]}: ${o.error}`);
      },
      onError: (e) => toast.error(e.message),
    });
  };

  // nothing until the list is known: a green "All live" over an empty or loading list would be a false all-clear
  const summary = q.isPending ? null : !list.length ? (
    <span className="min-w-0 truncate text-[12.5px] text-ter">None set up</span>
  ) : attention.length ? (
    <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] font-semibold text-caution">
      <span className="size-1.5 shrink-0 rounded-full bg-caution" />
      {attention.length} need{attention.length === 1 ? 's' : ''} attention
    </span>
  ) : (
    <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] font-semibold text-positive">
      <span className="size-1.5 shrink-0 rounded-full bg-positive" />
      All live
    </span>
  );

  if (q.isPending) return <ListSkeleton rows={size.tier === 'xs' ? 2 : 4} rowHeight={30} />;

  if (size.tier === 'xs') {
    return (
      <div className="flex h-full flex-wrap content-center items-center gap-2.5 p-3">
        <WidgetHeader>{summary}</WidgetHeader>
        {list.map((s) => (
          <Tooltip key={s.id}>
            <TooltipTrigger asChild>
              <Link to="/settings/sources" className="flex items-center gap-1.5 text-xs">
                <Dot s={s} />
                <span className="text-sub">{SOURCE_LABELS[s.id]}</span>
              </Link>
            </TooltipTrigger>
            <TooltipContent>{STATUS_LABEL[s.status]} · synced {relative(s.lastSuccessAt)}</TooltipContent>
          </Tooltip>
        ))}
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-1.5">
      <WidgetHeader>{summary}</WidgetHeader>
      <ul className="flex flex-col">
        {list.map((s) => {
          const standby = s.id === 'canvas_ical' && s.status !== 'error';
          const busy = s.running || (sync.isPending && sync.variables === s.id);
          return (
            <li key={s.id} className="group/row flex items-center gap-2.5 rounded-[10px] px-2.5 py-[7px] transition-colors hover:bg-well">
              <Dot s={s} />
              <Link to="/settings/sources" className={cn('min-w-0 flex-1 truncate text-[13.5px] font-medium', (standby || s.status === 'disconnected') && 'text-sub')} title={s.lastError ?? STATUS_LABEL[s.status]}>
                {SOURCE_LABELS[s.id].replace(' (iCal fallback)', ' iCal')}
              </Link>
              {s.status === 'error' || s.status === 'needs_auth' ? (
                <span className={cn('truncate text-xs', s.status === 'error' ? 'text-critical' : 'text-caution')} title={s.lastError ?? undefined}>{STATUS_LABEL[s.status]}</span>
              ) : (
                <span className="text-xs text-ter">{standby ? 'standby' : shortAgo(s.lastSuccessAt, now)}</span>
              )}
              <button
                type="button"
                aria-label={`Sync ${SOURCE_LABELS[s.id]}`}
                title={`Sync ${SOURCE_LABELS[s.id]} now`}
                disabled={busy}
                onClick={() => runSync(s)}
                onMouseDown={(e) => e.stopPropagation()}
                className={cn('orb size-6', HOVER_REVEAL, 'group-hover/row:opacity-100 group-focus-within/row:opacity-100', busy && 'opacity-100')}
              >
                <RefreshCw className={cn('size-3', busy && 'animate-spin')} />
              </button>
            </li>
          );
        })}
        {!list.length && (
          <li className="p-3 text-sm text-sub">
            No sources set up yet. <Link className="underline" to="/settings/sources">Connect one.</Link>
          </li>
        )}
      </ul>
    </div>
  );
}
