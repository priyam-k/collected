import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useInvalidate, useResetLayout, useUpsertWidget, useWidgets } from '@/lib/queries';
import { PageTitle } from './ui';

export function LayoutPage() {
  const reset = useResetLayout();
  const widgets = useWidgets();
  const upsert = useUpsertWidget();
  const inv = useInvalidate();
  const showAll = async () => {
    for (const w of widgets.data ?? []) if (w.hidden && w.type !== 'class') await upsert.mutateAsync({ id: w.id, hidden: false });
    await inv(['widgets']);
    toast.success('Core widgets shown');
  };
  return (
    <div className="space-y-4">
      <PageTitle sub="Layouts are saved per screen size (desktop, tablet, phone).">Layout</PageTitle>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => reset.mutate(undefined, { onSuccess: () => toast.success('Layout reset to defaults') })}>
          Reset positions
        </Button>
        <Button variant="outline" onClick={showAll}>Show all core widgets</Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Tip: press <kbd className="rounded border px-1">e</kbd> on the dashboard to enter edit mode.
      </p>
    </div>
  );
}
