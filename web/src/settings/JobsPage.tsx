import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { jobsFilterSchema, type JobsFilter } from '@collected/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { useInvalidate, useJobStats, useSaveSetting, useSettings } from '@/lib/queries';
import { Field, PageTitle } from './ui';

export function JobsPage() {
  const settings = useSettings();
  const stats = useJobStats();
  const save = useSaveSetting();
  const inv = useInvalidate();
  const [f, setF] = useState<JobsFilter | null>(null);

  useEffect(() => {
    if (settings.data && !f) setF(jobsFilterSchema.parse(settings.data['jobs.filter'] ?? {}));
  }, [settings.data, f]);

  if (!f) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const submit = () => {
    save.mutate(
      { key: 'jobs.filter', value: f },
      {
        onSuccess: async () => {
          const r = await api<{ total: number; matched: number }>('/jobs/recompute', { method: 'POST' });
          await inv(['jobs']);
          toast.success(`Saved. ${r.matched} of ${r.total} stored listings match.`);
        },
        onError: (e) => toast.error(e.message),
      },
    );
  };

  const list = (v: string[]) => v.join(', ');
  const parseList = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

  return (
    <div className="space-y-4">
      <PageTitle sub="Which listings count as a match. Regexes are case-insensitive; a broken regex is ignored and reported.">Jobs</PageTitle>
      {stats.data && (
        <p className="text-sm text-muted-foreground">
          {stats.data.total} stored · {stats.data.active} active · <span className="font-medium text-foreground">{stats.data.matched} match</span> · {stats.data.unseen} unseen
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={f.require_active} onCheckedChange={(v) => setF({ ...f, require_active: v })} /> Only active listings
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={f.require_visible} onCheckedChange={(v) => setF({ ...f, require_visible: v })} /> Only visible listings
        </label>
        <Field label="Categories (comma-separated, empty = any)" hint="Simplify categories: Software, AI/ML/Data, Hardware, Product, Quant">
          <Input value={list(f.categories_include)} onChange={(e) => setF({ ...f, categories_include: parseList(e.target.value) })} />
        </Field>
        <Field label="Terms (comma-separated, empty = any)" hint="e.g. Summer 2027">
          <Input value={list(f.terms_include)} onChange={(e) => setF({ ...f, terms_include: parseList(e.target.value) })} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Title must match">
            <Textarea rows={3} className="font-mono text-xs" value={f.title_include} onChange={(e) => setF({ ...f, title_include: e.target.value })} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Title must not match">
            <Textarea rows={3} className="font-mono text-xs" value={f.title_exclude} onChange={(e) => setF({ ...f, title_exclude: e.target.value })} />
          </Field>
        </div>
        <Field label="Location must match (any location)">
          <Textarea rows={2} className="font-mono text-xs" value={f.locations_include} onChange={(e) => setF({ ...f, locations_include: e.target.value })} />
        </Field>
        <Field label="Location excluded (all locations)">
          <Textarea rows={2} className="font-mono text-xs" value={f.locations_exclude} onChange={(e) => setF({ ...f, locations_exclude: e.target.value })} />
        </Field>
      </div>
      <Button onClick={submit} disabled={save.isPending}>Save and re-run filter</Button>
    </div>
  );
}
