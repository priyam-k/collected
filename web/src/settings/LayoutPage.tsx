import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useInvalidate, useResetLayout, useSaveSetting, useSettings, useUpsertWidget, useWidgets } from '@/lib/queries';
import { Field, PageTitle } from './ui';

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
  const settings = useSettings();
  const saveSetting = useSaveSetting();
  const [initials, setInitials] = useState('');
  useEffect(() => setInitials(String(settings.data?.['profile.initials'] ?? '')), [settings.data]);
  return (
    <div className="space-y-4">
      <PageTitle sub="Layouts are saved per screen size (desktop, tablet, phone).">Layout</PageTitle>
      <div className="max-w-xs">
        <Field label="Header initials" hint="Shown in the avatar at the top right of the dashboard.">
          <Input value={initials} maxLength={3} placeholder="PK" onChange={(e) => setInitials(e.target.value)} onBlur={() => saveSetting.mutate({ key: 'profile.initials', value: initials.trim() }, { onError: (e) => toast.error(e.message) })} />
        </Field>
      </div>
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
