import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLiquid } from '@/lib/liquid';
import { useInvalidate, useResetLayout, useSaveSetting, useSettings, useUpsertWidget, useWidgets } from '@/lib/queries';
import { ACCENTS, useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { Field, PageTitle } from './ui';

/** Ground (light, dark, or the system's) and the one accent colour. Kept per browser. */
function Appearance() {
  const { theme, setTheme, accent, setAccent } = useTheme();
  const liquid = useLiquid();
  return (
    <section className="space-y-4">
      <h3 className="label">Appearance</h3>
      <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
        <div className="seg" role="group" aria-label="Theme" ref={liquid}>
          {(['system', 'light', 'dark'] as const).map((t) => (
            <button key={t} className={cn('min-w-[4.5rem] capitalize', theme === t && 'seg-on')} aria-pressed={theme === t} onClick={() => setTheme(t)}>
              {t === 'system' ? 'Auto' : t}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5" role="group" aria-label="Accent">
          {ACCENTS.map((a) => (
            <button
              key={a.id}
              aria-label={`${a.label} accent`}
              aria-pressed={accent === a.id}
              title={a.label}
              onClick={() => setAccent(a.id)}
              className={cn('grid size-10 place-items-center rounded-full transition-[box-shadow] duration-150', accent === a.id ? 'shadow-[inset_0_0_0_2px_var(--ink)]' : 'hover:shadow-[inset_0_0_0_2px_var(--line-mid)]')}
            >
              <span data-accent-swatch={a.id} className="grid size-7 place-items-center rounded-full">
                {accent === a.id && <Check className="size-3.5" strokeWidth={2.4} />}
              </span>
            </button>
          ))}
        </div>
      </div>
      <p className="text-[13px] text-sub">Saved in this browser. The accent marks what is current or primary: the selected item, the main button, filled ticks.</p>
    </section>
  );
}

export function LayoutPage() {
  const reset = useResetLayout();
  const widgets = useWidgets();
  const upsert = useUpsertWidget();
  const inv = useInvalidate();
  const [showing, setShowing] = useState(false);
  const showAll = async () => {
    setShowing(true);
    try {
      for (const w of widgets.data ?? []) if (w.hidden && w.type !== 'class') await upsert.mutateAsync({ id: w.id, hidden: false });
      await inv(['widgets']);
      toast.success('Core widgets shown');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setShowing(false);
    }
  };
  const settings = useSettings();
  const saveSetting = useSaveSetting();
  const [initials, setInitials] = useState('');
  useEffect(() => setInitials(String(settings.data?.['profile.initials'] ?? '')), [settings.data]);
  return (
    <div className="space-y-8">
      <PageTitle sub="Layouts are saved per screen size (desktop, tablet, phone).">Layout</PageTitle>
      <Appearance />
      <h3 className="label !mb-4">Board</h3>
      <div className="max-w-xs">
        <Field label="Header initials" hint="Shown in the avatar at the top right of the dashboard when there is no Google photo.">
          <Input value={initials} maxLength={3} placeholder="PK" onChange={(e) => setInitials(e.target.value)} onBlur={() => saveSetting.mutate({ key: 'profile.initials', value: initials.trim() }, { onError: (e) => toast.error(e.message) })} />
        </Field>
      </div>
      <div className="flex flex-wrap gap-2">
        <ConfirmDialog
          trigger={(open) => (
            <Button variant="outline" onClick={open} disabled={reset.isPending}>
              Reset positions
            </Button>
          )}
          title="Reset widget positions?"
          description="Every widget goes back to its default place and size on desktop, tablet and phone. Hidden widgets stay hidden."
          confirmLabel="Reset"
          destructive
          onConfirm={() =>
            reset.mutateAsync(undefined, {
              onSuccess: () => toast.success('Layout reset to defaults'),
              onError: (e) => toast.error(`Reset failed: ${e.message}`),
            })
          }
        />
        <Button variant="outline" onClick={showAll} disabled={showing}>{showing ? 'Showing…' : 'Show all core widgets'}</Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Tip: press <kbd className="rounded-md bg-well px-1.5 py-px text-[12px] font-semibold">e</kbd> on the dashboard to enter edit mode.
      </p>
    </div>
  );
}
