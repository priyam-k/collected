import { Link } from 'react-router';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { SOURCE_LABELS, type Source, type SourceStatus } from '@collected/shared';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useSources, useSyncSource } from '@/lib/queries';
import { relative } from '@/lib/time';
import { cn } from '@/lib/utils';
import { ErrorState } from '@/widgets/Placeholder';
import type { WidgetProps } from '@/widgets/types';

const STATUS_STYLE: Record<SourceStatus, { dot: string; label: string }> = {
  connected: { dot: 'bg-emerald-500', label: 'Connected' },
  needs_auth: { dot: 'bg-amber-500', label: 'Needs auth' },
  error: { dot: 'bg-red-500', label: 'Error' },
  disconnected: { dot: 'bg-muted-foreground/40', label: 'Not set up' },
};

export function SourcesWidget({ size }: WidgetProps) {
  const q = useSources();
  const sync = useSyncSource();

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const list = (q.data ?? []).filter((s) => s.enabled || s.status !== 'disconnected');

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

  if (size.tier === 'xs') {
    return (
      <div className="flex h-full flex-wrap content-center items-center gap-2 p-3">
        {list.map((s) => (
          <Tooltip key={s.id}>
            <TooltipTrigger asChild>
              <Link to="/settings/sources" className="flex items-center gap-1.5 text-xs">
                <span className={cn('inline-block size-2.5 rounded-full', STATUS_STYLE[s.status].dot)} />
                <span className="text-muted-foreground">{SOURCE_LABELS[s.id]}</span>
              </Link>
            </TooltipTrigger>
            <TooltipContent>
              {STATUS_STYLE[s.status].label} · synced {relative(s.lastSuccessAt)}
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <table className="w-full text-sm">
        <tbody>
          {list.map((s) => (
            <tr key={s.id} className="border-b last:border-0">
              <td className="py-1.5 pl-3 pr-2">
                <span className={cn('mr-2 inline-block size-2.5 rounded-full align-middle', STATUS_STYLE[s.status].dot)} />
                <Link to="/settings/sources" className="align-middle hover:underline">
                  {SOURCE_LABELS[s.id]}
                </Link>
              </td>
              <td className="py-1.5 pr-2 text-muted-foreground">
                {size.tier !== 'sm' && <span className="mr-2">{STATUS_STYLE[s.status].label}</span>}
                <span title={s.lastSuccessAt ?? undefined}>{s.lastSuccessAt ? relative(s.lastSuccessAt) : '—'}</span>
              </td>
              {size.tier !== 'sm' && (
                <td className="max-w-[16rem] truncate py-1.5 pr-2 text-xs text-destructive" title={s.lastError ?? undefined}>
                  {s.lastError ?? ''}
                </td>
              )}
              <td className="py-1 pr-2 text-right">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Sync ${SOURCE_LABELS[s.id]}`}
                  title={`Sync ${SOURCE_LABELS[s.id]} now`}
                  disabled={sync.isPending && sync.variables === s.id}
                  onClick={() => runSync(s)}
                >
                  <RefreshCw className={cn('size-3.5', sync.isPending && sync.variables === s.id && 'animate-spin')} />
                </Button>
              </td>
            </tr>
          ))}
          {!list.length && !q.isPending && (
            <tr>
              <td className="p-3 text-muted-foreground">
                No sources set up yet. <Link className="underline" to="/settings/sources">Connect one.</Link>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
