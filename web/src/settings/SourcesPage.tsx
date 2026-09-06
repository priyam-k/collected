import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { SOURCE_LABELS, type Source, type SourceId } from '@collected/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useClearSourceConfig, usePatchSourceMeta, useSaveSourceConfig, useSetSourceEnabled, useSources, useSyncSource } from '@/lib/queries';
import { useSearchParams } from 'react-router';
import { useEffect } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { relative } from '@/lib/time';
import { Field, PageTitle } from './ui';

const STATUS_VARIANT: Record<Source['status'], 'default' | 'secondary' | 'destructive' | 'outline'> = {
  connected: 'default',
  needs_auth: 'destructive',
  error: 'destructive',
  disconnected: 'outline',
};

export function SourcesPage() {
  const q = useSources();
  if (q.isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (q.isError) return <p className="text-sm text-destructive">{q.error.message}</p>;
  const by = Object.fromEntries(q.data.map((s) => [s.id, s])) as Record<SourceId, Source>;
  return (
    <div className="space-y-4">
      <PageTitle sub="Credentials are encrypted at rest and never shown again after saving.">Sources</PageTitle>
      <SourceCard source={by.canvas} description="Session cookie from your browser. The iCal feed is the fallback when the cookie expires.">
        <CanvasForm source={by.canvas} ical={by.canvas_ical} />
      </SourceCard>
      <SourceCard source={by.gradescope} description="Native email + password login (not the school SSO button).">
        <GradescopeForm source={by.gradescope} />
      </SourceCard>
      <SourceCard source={by.gcal} description="OAuth connect with read and write access. Needs GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in .env (artifacts/SETUP.md, Phase 1).">
        <GoogleForm source={by.gcal} />
      </SourceCard>
      <SourceCard source={by.todoist} description="API token from Todoist → Settings → Integrations → Developer.">
        <TokenForm source={by.todoist} field="token" label="API token" />
      </SourceCard>
      <SourceCard source={by.jobs} description="Public listings from SimplifyJobs on GitHub. No credentials.">
        <p className="text-sm text-muted-foreground">
          Runs hourly. Tune what counts as a match under <span className="font-medium">Jobs</span>.
        </p>
      </SourceCard>
    </div>
  );
}

function SourceCard({ source, description, children }: { source: Source; description: string; children: React.ReactNode }) {
  const setEnabled = useSetSourceEnabled();
  const sync = useSyncSource();
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="mr-auto">{SOURCE_LABELS[source.id]}</CardTitle>
          <Badge variant={STATUS_VARIANT[source.status]}>{source.status.replace('_', ' ')}</Badge>
          <span className="text-xs text-muted-foreground">synced {relative(source.lastSuccessAt)}</span>
          <Button
            size="sm"
            variant="outline"
            disabled={sync.isPending}
            onClick={() =>
              sync.mutate(source.id, {
                onSuccess: (r) => {
                  const o = r.outcome as { ok: boolean; error?: string; skipped?: string };
                  o.ok ? toast.success('Synced') : toast.error(o.error ?? o.skipped ?? 'failed');
                },
              })
            }
          >
            Sync now
          </Button>
          <label className="flex items-center gap-2 text-xs">
            <Switch checked={source.enabled} onCheckedChange={(enabled) => setEnabled.mutate({ id: source.id, enabled })} /> enabled
          </label>
        </div>
        <CardDescription>{description}</CardDescription>
        {source.lastError && <p className="text-xs text-destructive">{source.lastError}</p>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function useSave(id: SourceId) {
  const save = useSaveSourceConfig();
  const clear = useClearSourceConfig();
  return {
    save: (config: Record<string, unknown>, onDone?: () => void) =>
      save.mutate(
        { id, config },
        {
          onSuccess: () => {
            toast.success('Saved');
            onDone?.();
          },
          onError: (e) => toast.error(e.message),
        },
      ),
    clear: () => clear.mutate(id, { onSuccess: () => toast.success('Cleared') }),
    pending: save.isPending || clear.isPending,
  };
}

function CanvasForm({ source, ical }: { source: Source; ical: Source }) {
  const canvas = useSave('canvas');
  const icalSave = useSave('canvas_ical');
  const [cookie, setCookie] = useState('');
  const [baseUrl, setBaseUrl] = useState('https://umd.instructure.com');
  const [icalUrl, setIcalUrl] = useState('');
  const submitCookie = (e: FormEvent) => {
    e.preventDefault();
    canvas.save({ baseUrl, cookieHeader: cookie.trim() }, () => setCookie(''));
  };
  const submitIcal = (e: FormEvent) => {
    e.preventDefault();
    icalSave.save({ url: icalUrl.trim() }, () => setIcalUrl(''));
  };
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form onSubmit={submitCookie} className="space-y-3">
        <Field label="Canvas URL">
          <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
        </Field>
        <Field
          label="Session cookie"
          hint={
            <>
              DevTools → Application → Cookies → your Canvas domain. Paste the whole cookie header, or at least{' '}
              <code>_normandy_session=…</code>. Or run <code>local/canvas_cookie.py</code>.
            </>
          }
        >
          <Textarea rows={3} value={cookie} onChange={(e) => setCookie(e.target.value)} placeholder="_normandy_session=…; canvas_session=…" />
        </Field>
        <div className="flex gap-2">
          <Button type="submit" disabled={!cookie.trim() || canvas.pending}>
            {source.hasConfig ? 'Replace cookie' : 'Save cookie'}
          </Button>
          {source.hasConfig && (
            <Button type="button" variant="ghost" onClick={canvas.clear}>
              Clear
            </Button>
          )}
        </div>
      </form>
      <form onSubmit={submitIcal} className="space-y-3">
        <Field label="iCal feed URL (fallback)" hint="Canvas → Calendar → Calendar Feed. Used only while the cookie is dead.">
          <Input value={icalUrl} onChange={(e) => setIcalUrl(e.target.value)} placeholder="https://umd.instructure.com/feeds/calendars/user_….ics" />
        </Field>
        <div className="flex items-center gap-2">
          <Button type="submit" variant="secondary" disabled={!icalUrl.trim() || icalSave.pending}>
            {ical.hasConfig ? 'Replace feed URL' : 'Save feed URL'}
          </Button>
          {ical.hasConfig && <span className="text-xs text-muted-foreground">feed saved</span>}
        </div>
      </form>
    </div>
  );
}

function GradescopeForm({ source }: { source: Source }) {
  const s = useSave('gradescope');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        s.save({ email: email.trim(), password }, () => setPassword(''));
      }}
    >
      <Field label="Email">
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
      </Field>
      <Field label="Password">
        <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
      </Field>
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" disabled={!email || !password || s.pending}>
          {source.hasConfig ? 'Replace credentials' : 'Save credentials'}
        </Button>
        {source.hasConfig && (
          <Button type="button" variant="ghost" onClick={s.clear}>
            Clear
          </Button>
        )}
      </div>
    </form>
  );
}

function TokenForm({ source, field, label }: { source: Source; field: string; label: string }) {
  const s = useSave(source.id);
  const [value, setValue] = useState('');
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        s.save({ [field]: value.trim() }, () => setValue(''));
      }}
    >
      <div className="min-w-64 flex-1">
        <Field label={label}>
          <Input type="password" value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" />
        </Field>
      </div>
      <Button type="submit" disabled={!value.trim() || s.pending}>
        {source.hasConfig ? 'Replace' : 'Save'}
      </Button>
      {source.hasConfig && (
        <Button type="button" variant="ghost" onClick={s.clear}>
          Clear
        </Button>
      )}
    </form>
  );
}


interface GCalMeta {
  calendars?: { id: string; summary: string; primary: boolean; backgroundColor: string | null; accessRole: string | null }[];
  selectedCalendars?: string[];
  defaultCalendarId?: string | null;
  demo?: boolean;
}

function GoogleForm({ source }: { source: Source }) {
  const meta = (source.meta ?? {}) as GCalMeta;
  const patch = usePatchSourceMeta();
  const clear = useClearSourceConfig();
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    const g = params.get('google');
    if (!g) return;
    if (g === 'connected') toast.success('Google Calendar connected');
    else if (g === 'unconfigured') toast.error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env first');
    else toast.error(`Google connect failed: ${params.get('reason') ?? g}`);
    params.delete('google');
    params.delete('reason');
    setParams(params, { replace: true });
  }, [params, setParams]);

  const selected = new Set(meta.selectedCalendars ?? (meta.calendars ?? []).filter((c) => c.primary).map((c) => c.id));
  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected);
    on ? next.add(id) : next.delete(id);
    patch.mutate({ id: 'gcal', meta: { selectedCalendars: [...next] } });
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild size="sm">
          <a href="/api/google/start">{source.hasConfig ? 'Reconnect Google' : 'Connect Google Calendar'}</a>
        </Button>
        {source.hasConfig && (
          <Button size="sm" variant="ghost" onClick={() => clear.mutate('gcal', { onSuccess: () => toast.success('Disconnected') })}>
            Disconnect
          </Button>
        )}
        {meta.demo && <span className="text-xs text-muted-foreground">showing demo calendars from `cli demo gcal`</span>}
      </div>
      {meta.calendars && meta.calendars.length > 0 && (
        <div className="grid gap-1.5 sm:grid-cols-2">
          {meta.calendars.map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-sm">
              <Checkbox checked={selected.has(c.id)} onCheckedChange={(v) => toggle(c.id, v === true)} />
              <span className="inline-block size-2.5 rounded-full" style={{ background: c.backgroundColor ?? '#888' }} />
              <span className="truncate">{c.summary}</span>
              {c.primary && <span className="text-xs text-muted-foreground">primary</span>}
              {meta.defaultCalendarId === c.id ? (
                <span className="text-xs text-muted-foreground">· default for new events</span>
              ) : (
                (c.accessRole === 'owner' || c.accessRole === 'writer') && (
                  <button className="text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => patch.mutate({ id: 'gcal', meta: { defaultCalendarId: c.id } })}>
                    make default
                  </button>
                )
              )}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
