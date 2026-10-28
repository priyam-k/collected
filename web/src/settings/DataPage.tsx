import { useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { useInvalidate } from '@/lib/queries';
import { PageTitle } from './ui';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function DataPage() {
  const [exported, setExported] = useState('');
  const [exporting, setExporting] = useState(false);
  const [toImport, setToImport] = useState('');
  const inv = useInvalidate();
  const doExport = async () => {
    setExporting(true);
    try {
      const data = await api<unknown>('/export');
      setExported(JSON.stringify(data, null, 2));
    } catch (e) {
      toast.error(`Export failed: ${message(e)}`);
    } finally {
      setExporting(false);
    }
  };
  /** Runs from the confirm dialog: rethrows so the dialog stays open on a failure. */
  const doImport = async () => {
    let body: unknown;
    try {
      body = JSON.parse(toImport);
    } catch {
      toast.error('That is not valid JSON. Paste the whole export, from the first { to the last }.');
      throw new Error('invalid json');
    }
    try {
      const r = await api<Record<string, number>>('/import', { method: 'POST', json: body });
      await inv(['courses'], ['settings'], ['widgets'], ['layout']);
      toast.success(`Imported: ${Object.entries(r).map(([k, v]) => `${v} ${k}`).join(', ')}`);
    } catch (e) {
      toast.error(`Import failed: ${message(e)}`);
      throw e;
    }
  };
  const clearDemo = async () => {
    try {
      const r = await api<{ items: number; content: number }>('/demo', { method: 'DELETE' });
      await inv(['items'], ['sources'], ['courses']);
      toast.success(`Removed ${r.items} demo items and ${r.content} content rows`);
    } catch (e) {
      toast.error(message(e));
      throw e;
    }
  };
  return (
    <div className="space-y-6">
      <PageTitle sub="Courses, settings, widget instances, and layouts. No credentials.">Export / import</PageTitle>
      <section className="space-y-2 rounded-2xl bg-well/60 p-4">
        <div className="text-sm font-medium">Demo data</div>
        <p className="text-xs text-muted-foreground">
          <code className="font-mono text-[11.5px] text-ink">pnpm cli demo …</code> loads fixture rows so widgets have something to show before accounts are connected. Once real sources are connected, remove them here.
        </p>
        <ConfirmDialog
          trigger={(open) => <Button variant="outline" onClick={open}>Remove demo data</Button>}
          title="Remove demo data?"
          description="Every row created by the demo loaders goes. Real syncs will refill anything that is genuinely there."
          confirmLabel="Remove"
          destructive
          onConfirm={clearDemo}
        />
      </section>
      <section className="space-y-2">
        <Button variant="outline" onClick={doExport} disabled={exporting}>{exporting ? 'Generating…' : 'Generate export'}</Button>
        {exported && <Textarea rows={12} readOnly className="font-mono text-xs" value={exported} onFocus={(e) => e.currentTarget.select()} />}
      </section>
      <section className="space-y-2">
        <Textarea rows={8} className="font-mono text-xs" placeholder="Paste an export here" value={toImport} onChange={(e) => setToImport(e.target.value)} />
        <ConfirmDialog
          trigger={(open) => <Button onClick={open} disabled={!toImport.trim()}>Import</Button>}
          title="Import this export?"
          description="Courses, settings, widgets and layouts in the export overwrite the ones here with the same id; anything not in it stays. Credentials are not touched. Generate an export first if you may want the current state back."
          confirmLabel="Import"
          destructive
          onConfirm={doImport}
        />
      </section>
    </div>
  );
}
