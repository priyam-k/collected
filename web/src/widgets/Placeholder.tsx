import { Link } from 'react-router';
import { SOURCE_LABELS, type Source, type SourceId } from '@collected/shared';
import { Button } from '@/components/ui/button';
import type { WidgetSize } from '@/dashboard/useWidgetSize';

export function ConnectPlaceholder({ missing, sources, size }: { missing: SourceId[]; sources: Source[]; size: WidgetSize }) {
  const needsAuth = missing.filter((id) => sources.find((s) => s.id === id)?.status === 'needs_auth');
  const label = missing.map((m) => SOURCE_LABELS[m]).join(' and ');
  const compact = size.tier === 'xs';
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-3 text-center">
      <p className="text-sm text-muted-foreground">
        {needsAuth.length ? `${label} needs re-authentication` : `Connect ${label} to use this widget`}
      </p>
      {!compact && (
        <Button asChild size="sm" variant="secondary">
          <Link to="/settings/sources">{needsAuth.length ? 'Reconnect' : 'Set up'}</Link>
        </Button>
      )}
    </div>
  );
}

export function ComingSoon({ what }: { what: string }) {
  return (
    <div className="flex h-full items-center justify-center p-3 text-center text-sm text-muted-foreground">
      {what}
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  // children go in a paragraph: as direct flex items, text and a following link would lose the space between them
  return (
    <div className="flex h-full items-center justify-center p-3 text-center text-sm text-muted-foreground">
      <p>{children}</p>
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-3 text-center">
      <p className="text-sm text-destructive">{msg}</p>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

/** Loading rows for a list widget: rounded well bars at row height, so the card doesn't jump when data lands. */
export function ListSkeleton({ rows = 3, rowHeight = 36 }: { rows?: number; rowHeight?: number }) {
  return (
    <div className="flex flex-col gap-1.5 p-1.5" aria-busy aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="animate-pulse rounded-xl bg-well" style={{ height: rowHeight, opacity: Math.max(0.3, 1 - i * 0.18) }} />
      ))}
    </div>
  );
}
