import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { useInvalidate } from '@/lib/queries';
import { PageTitle } from './ui';

export function DataPage() {
  const [exported, setExported] = useState('');
  const [toImport, setToImport] = useState('');
  const inv = useInvalidate();
  const doExport = async () => {
    const data = await api<unknown>('/export');
    setExported(JSON.stringify(data, null, 2));
  };
  const doImport = async () => {
    try {
      const r = await api<Record<string, number>>('/import', { method: 'POST', json: JSON.parse(toImport) });
      await inv(['courses'], ['settings'], ['widgets'], ['layout']);
      toast.success(`Imported: ${Object.entries(r).map(([k, v]) => `${v} ${k}`).join(', ')}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  const clearDemo = async () => {
    if (!window.confirm('Remove every row created by the demo loaders? Real syncs will refill anything that is genuinely there.')) return;
    try {
      const r = await api<{ items: number; content: number }>('/demo', { method: 'DELETE' });
      await inv(['items'], ['sources'], ['courses']);
      toast.success(`Removed ${r.items} demo items and ${r.content} content rows`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="space-y-6">
      <PageTitle sub="Courses, settings, widget instances, and layouts. No credentials.">Export / import</PageTitle>
      <section className="space-y-2 rounded-2xl bg-well/60 p-4">
        <div className="text-sm font-medium">Demo data</div>
        <p className="text-xs text-muted-foreground">`pnpm cli demo …` loads fixture rows so widgets have something to show before accounts are connected. Once real sources are connected, remove them here.</p>
        <Button variant="outline" onClick={clearDemo}>Remove demo data</Button>
      </section>
      <section className="space-y-2">
        <Button variant="outline" onClick={doExport}>Generate export</Button>
        {exported && <Textarea rows={12} readOnly className="font-mono text-xs" value={exported} onFocus={(e) => e.currentTarget.select()} />}
      </section>
      <section className="space-y-2">
        <Textarea rows={8} className="font-mono text-xs" placeholder="Paste an export here" value={toImport} onChange={(e) => setToImport(e.target.value)} />
        <Button onClick={doImport} disabled={!toImport.trim()}>Import</Button>
      </section>
    </div>
  );
}
