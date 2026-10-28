import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { SOURCE_LABELS, type Source, type SourceId } from '@collected/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useClearSourceConfig, usePatchSourceMeta, useSaveSourceConfig, useSetSourceEnabled, useSourceSummary, useSources, useSyncSource } from '@/lib/queries';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { friendlyDate } from '@/lib/time';
import { useSearchParams } from 'react-router';
import { useEffect } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { relative } from '@/lib/time';
import { safeHref } from '@/lib/url';
import { safeColor } from '@/lib/color';
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
      <SourceCard source={by.gcal_ical} description="Read-only, no Google Cloud project needed: one calendar's secret iCal address, refreshed every 30 minutes.">
        <GcalIcalForm source={by.gcal_ical} />
      </SourceCard>
      <SourceCard source={by.todoist} description="API token from Todoist → Settings → Integrations → Developer.">
        <TokenForm source={by.todoist} field="token" label="API token" />
      </SourceCard>
      {by.gtasks && (
        <SourceCard source={by.gtasks} description="OAuth connect with the tasks scope, asked for separately from Calendar. Same Google client; the Tasks API must be enabled in the Google Cloud project (artifacts/SETUP.md).">
          <GTasksForm source={by.gtasks} />
        </SourceCard>
      )}
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
      <CardContent className="space-y-4">
        {children}
        <DataViewer source={source} />
      </CardContent>
    </Card>
  );
}

/** Expandable "what did we actually pull" panel: last run counts, rows per course, recent items. */
function DataViewer({ source }: { source: Source }) {
  const [open, setOpen] = useState(false);
  const q = useSourceSummary(source.id, open);
  const d = q.data;
  return (
    <div className="rounded-xl border border-line">
      <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent/50" onClick={() => setOpen((v) => !v)} title="Show what this source has pulled">
        {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        <span className="font-medium">Data pulled</span>
        {source.lastRunAt && <span className="text-xs text-muted-foreground">last run {relative(source.lastRunAt)}</span>}
      </button>
      {open && (
        <div className="space-y-3 border-t px-3 py-2 text-sm">
          {q.isPending && <p className="text-xs text-muted-foreground">Loading…</p>}
          {d && (
            <>
              {d.lastRun ? (
                <p className="text-xs text-muted-foreground">
                  Last run {friendlyDate(d.lastRun.at, { withTime: true })} in {(d.lastRun.ms / 1000).toFixed(1)}s ·{' '}
                  {Object.entries(d.lastRun.counts).map(([k, v]) => `${k} ${v}`).join(' · ') || 'no counts'}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">No completed run yet.</p>
              )}
              {d.jobs && <p className="text-xs text-muted-foreground">{d.jobs.total} listings stored · {d.jobs.matched} active matches</p>}
              {(source.id === 'canvas' || source.id === 'gradescope') && (
                <table className="w-full text-xs">
                  <thead className="text-left text-muted-foreground">
                    <tr><th className="py-1 pr-2 font-normal">Course</th><th className="py-1 pr-2 font-normal">{source.id === 'canvas' ? 'Canvas id' : 'Gradescope id'}</th><th className="py-1 pr-2 font-normal">Items</th><th className="py-1 font-normal">Content</th></tr>
                  </thead>
                  <tbody>
                    {d.byCourse.map((c) => (
                      <tr key={c.courseId} className="border-t">
                        <td className="py-1 pr-2 font-medium">{c.code}{c.role === 'ta' && <span className="ml-1 text-muted-foreground">TA</span>}</td>
                        <td className="py-1 pr-2 font-mono">{c.linkedId ?? <span className="text-caution">not matched</span>}</td>
                        <td className="py-1 pr-2">{Object.entries(c.kinds).map(([k, n]) => `${n} ${k}${n === 1 ? '' : 's'}`).join(', ') || '—'}</td>
                        <td className="py-1">{Object.entries(c.content).map(([k, n]) => `${n} ${k.replace('_', ' ')}`).join(', ') || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {Object.keys(d.unassigned).length > 0 && source.id !== 'canvas' && source.id !== 'gradescope' && (
                <p className="text-xs text-muted-foreground">{Object.entries(d.unassigned).map(([k, n]) => `${n} ${k}${n === 1 ? '' : 's'}`).join(' · ')}</p>
              )}
              {d.recent.length > 0 ? (
                <div>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">Most recently updated rows</div>
                  <ul className="max-h-64 space-y-0.5 overflow-auto">
                    {d.recent.map((r) => (
                      <li key={r.id} className="flex items-baseline gap-2 text-xs">
                        <span className="w-20 shrink-0 text-muted-foreground">{r.kind}</span>
                        {safeHref(r.url) ? <a className="min-w-0 flex-1 truncate hover:underline" href={safeHref(r.url)} target="_blank" rel="noreferrer">{r.title}</a> : <span className="min-w-0 flex-1 truncate">{r.title}</span>}
                        <span className="shrink-0 text-muted-foreground">{r.courseId ? d.byCourse.find((c) => c.courseId === r.courseId)?.code : r.labels.length ? r.labels.join(',') : ''}</span>
                        <span className="w-24 shrink-0 text-right text-muted-foreground">{friendlyDate(r.dueAt ?? r.startsAt)}</span>
                        <span className="w-16 shrink-0 text-right text-muted-foreground">{r.status}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No rows from this source yet.</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
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
  // No default host: every school has its own Canvas address, so the user types it when connecting.
  const [baseUrl, setBaseUrl] = useState('');
  const baseUrlOk = /^https:\/\/[^\s/]+/.test(baseUrl.trim());
  const [icalUrl, setIcalUrl] = useState('');
  const submitCookie = (e: FormEvent) => {
    e.preventDefault();
    canvas.save({ baseUrl: baseUrl.trim(), cookieHeader: cookie.trim() }, () => setCookie(''));
  };
  const submitIcal = (e: FormEvent) => {
    e.preventDefault();
    icalSave.save({ url: icalUrl.trim() }, () => setIcalUrl(''));
  };
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form onSubmit={submitCookie} className="space-y-3">
        <Field label="Canvas URL" hint="Your school's Canvas address: what the browser shows when you open Canvas.">
          <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://umd.instructure.com" required />
        </Field>
        <Field
          label="Session cookie"
          hint={
            <>
              DevTools → Application → Cookies → your Canvas domain. Paste the whole cookie header, or at least{' '}
              <code>canvas_session=…</code> (older instances call it <code>_normandy_session</code>). Or run <code>pnpm canvas-cookie</code>.
            </>
          }
        >
          <Textarea rows={3} value={cookie} onChange={(e) => setCookie(e.target.value)} placeholder="_normandy_session=…; canvas_session=…" />
        </Field>
        <div className="flex gap-2">
          <Button type="submit" disabled={!baseUrlOk || !cookie.trim() || canvas.pending}>
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

function GcalIcalForm({ source }: { source: Source }) {
  const s = useSave('gcal_ical');
  const [url, setUrl] = useState('');
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        s.save({ url: url.trim() }, () => setUrl(''));
      }}
    >
      <Field
        label="Secret address in iCal format"
        hint="Google Calendar on the web → Settings (gear) → the calendar under Settings for my calendars → Integrate calendar → Secret address in iCal format. Anyone with this URL can read the calendar; it is stored encrypted. Events show up as read-only."
      >
        <Input type="password" value={url} onChange={(e) => setUrl(e.target.value)} autoComplete="off" placeholder="https://calendar.google.com/calendar/ical/…/private-…/basic.ics" />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" disabled={!url.trim() || s.pending}>
          {source.hasConfig ? 'Replace address' : 'Save address'}
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

/** Fixed messages for the `reason` codes the OAuth callback redirects with; anything else reads as `unknown`. */
const GOOGLE_ERRORS: Record<string, string> = {
  denied: 'Google connect failed: access was denied on the consent screen',
  expired: 'Google connect failed: the sign-in link expired, try again',
  exchange: 'Google connect failed: Google rejected the token exchange',
  config: 'Google connect failed: check GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and the redirect URL',
  unknown: 'Google connect failed',
};

function GoogleForm({ source }: { source: Source }) {
  const meta = (source.meta ?? {}) as GCalMeta;
  const patch = usePatchSourceMeta();
  const clear = useClearSourceConfig();
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    const g = params.get('google');
    if (!g) return;
    if (g === 'connected') toast.success(params.get('source') === 'gtasks' ? 'Google Tasks connected' : 'Google Calendar connected');
    else if (g === 'unconfigured') toast.error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env first');
    else if (params.get('source') === 'gtasks' && params.get('reason') === 'unknown') toast.error('Google Tasks: the first sync failed, see the Google Tasks card (is the Tasks API enabled?)');
    else toast.error(GOOGLE_ERRORS[params.get('reason') ?? ''] ?? GOOGLE_ERRORS.unknown);
    params.delete('google');
    params.delete('reason');
    params.delete('source');
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
              <span className="inline-block size-2.5 rounded-full" style={{ background: safeColor(c.backgroundColor) ?? '#888' }} />
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

/** Google Tasks: its own consent (tasks scope only, incremental), so connecting it never touches the Calendar grant. */
function GTasksForm({ source }: { source: Source }) {
  const meta = (source.meta ?? {}) as { lists?: { id: string; title: string }[]; defaultListId?: string | null };
  const clear = useClearSourceConfig();
  const lists = meta.lists ?? [];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild size="sm">
          <a href="/api/google/start?source=gtasks">{source.hasConfig ? 'Reconnect Google Tasks' : 'Connect Google Tasks'}</a>
        </Button>
        {source.hasConfig && (
          <Button size="sm" variant="ghost" onClick={() => clear.mutate('gtasks', { onSuccess: () => toast.success('Disconnected') })}>
            Disconnect
          </Button>
        )}
      </div>
      {source.hasConfig && lists.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {lists.length} {lists.length === 1 ? 'list' : 'lists'}: {lists.map((l) => l.title).join(', ')} · new tasks go to {lists.find((l) => l.id === meta.defaultListId)?.title ?? lists[0]!.title}
        </p>
      )}
    </div>
  );
}
