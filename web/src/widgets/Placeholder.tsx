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
  return <div className="flex h-full items-center justify-center p-3 text-center text-sm text-muted-foreground">{children}</div>;
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
