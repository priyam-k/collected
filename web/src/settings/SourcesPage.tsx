import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { SOURCE_LABELS, type Source, type SourceId } from '@collected/shared';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { isLocalOwner, useClearSourceConfig, useDisconnectTodoist, useMe, usePatchSourceMeta, useSaveSourceConfig, useSetSourceEnabled, useSourceSummary, useSources, useSyncSource } from '@/lib/queries';
import { canvasCookieBlocker, normalizeCanvasBaseUrl } from '@/lib/canvas';
import { safeColor } from '@/lib/color';
import { friendlyDate, relative } from '@/lib/time';
import { safeHref } from '@/lib/url';
import { Field, PageTitle, StatusTag, type StatusTone } from './ui';

/** Source status as a dot and a word; the raw ids ("needs_auth") are not for people. */
const STATUS: Record<Source['status'], { tone: StatusTone; word: string }> = {
  connected: { tone: 'ok', word: 'Connected' },
  needs_auth: { tone: 'bad', word: 'Needs sign-in' },
  error: { tone: 'bad', word: 'Error' },
  disconnected: { tone: 'off', word: 'Not connected' },
};

/** Code inside running text: a well chip, never literal backticks. */
const Cmd = ({ children }: { children: React.ReactNode }) => <code className="rounded-md bg-well px-1 py-px font-mono text-[11.5px] text-ink">{children}</code>;

/*
 * Local mode (`collected ui`, identity `local`) has no operator and no server `.env`: the Google client is the one
 * built into the CLI unless `~/.collected/.env` names another, and a build can ship without one. The cards say which
 * case this is; the controls are the same.
 */
const LOCAL_DOTENV = '~/.collected/.env';
const LOCAL_GOOGLE_BUILTIN = `Uses collected's built-in Google client; set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in ${LOCAL_DOTENV} to use your own.`;
const LOCAL_GOOGLE_MISSING = `This build ships without a Google client. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to ${LOCAL_DOTENV}`;
const LOCAL_TODOIST_NOTE = `Sign in with Todoist needs your own Todoist app: add TODOIST_CLIENT_ID and TODOIST_CLIENT_SECRET to ${LOCAL_DOTENV}. Pasting a token works without it.`;

/** The Google cards' description: the server's as written, or in local mode which client (if any) the build runs with. */
function googleDescription(local: boolean, source: Source, server: string, icalFallback: boolean): string {
  if (!local) return server;
  if (source.oauthAvailable === false) return `${LOCAL_GOOGLE_MISSING}${icalFallback ? ', or use the iCal source.' : '.'}`;
  return `${server} ${LOCAL_GOOGLE_BUILTIN}`;
}

export function SourcesPage() {
  const q = useSources();
  const local = isLocalOwner(useMe().data);
  if (q.isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (q.isError) return <p className="text-sm text-destructive">{q.error.message}</p>;
  const by = Object.fromEntries(q.data.map((s) => [s.id, s])) as Record<SourceId, Source>;
  return (
    <div className="space-y-4">
      <PageTitle sub="Credentials are encrypted at rest and never shown again after saving.">Sources</PageTitle>
      <SourceCard source={by.canvas} description="Signs in with your Canvas session cookie. The calendar feed keeps due dates coming while the cookie has expired.">
        <CanvasForm source={by.canvas} ical={by.canvas_ical} />
      </SourceCard>
      <SourceCard source={by.gradescope} description="Your Gradescope email and password. Use a Gradescope password, not the school sign-in button.">
        <GradescopeForm source={by.gradescope} />
      </SourceCard>
      <SourceCard source={by.gcal} description={googleDescription(local, by.gcal, 'Connect your Google account to see your calendars and add events to them.', true)}>
        <GoogleForm source={by.gcal} local={local} />
      </SourceCard>
      <SourceCard source={by.gcal_ical} description="Read-only and no Google sign-in: one calendar's secret iCal address, refreshed every 30 minutes.">
        <GcalIcalForm source={by.gcal_ical} />
      </SourceCard>
      <SourceCard
        source={by.todoist}
        description={
          by.todoist.oauthAvailable
            ? 'Sign in with Todoist, or paste an API token from Todoist → Settings → Integrations → Developer.'
            : local
              ? 'Paste an API token from Todoist → Settings → Integrations → Developer.'
              : 'Paste an API token from Todoist → Settings → Integrations → Developer. (Sign in with Todoist appears once this server has a Todoist app set up.)'
        }
      >
        <TodoistForm source={by.todoist} local={local} />
      </SourceCard>
      {by.gtasks && (
        <SourceCard source={by.gtasks} description={googleDescription(local, by.gtasks, local ? 'Connected separately from Calendar, and asks only for your tasks.' : "Connected separately from Calendar, and asks only for your tasks. (The server's Google project needs the Tasks API turned on.)", false)}>
          <GTasksForm source={by.gtasks} />
        </SourceCard>
      )}
      <SourceCard source={by.jobs} description="Public internship listings from SimplifyJobs on GitHub. Nothing to sign in to.">
        <p className="text-sm text-muted-foreground">
          Runs hourly. Tune what counts as a match under{' '}
          <Link to="/settings/jobs" className="font-medium text-brand-ink underline-offset-[3px] hover:underline">
            Jobs
          </Link>
          .
        </p>
      </SourceCard>
    </div>
  );
}

function SourceCard({ source, description, children }: { source: Source; description: string; children: React.ReactNode }) {
  const setEnabled = useSetSourceEnabled();
  const sync = useSyncSource();
  const status = STATUS[source.status];
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="mr-auto">{SOURCE_LABELS[source.id]}</CardTitle>
          <StatusTag tone={status.tone}>{status.word}</StatusTag>
          <span className="text-xs text-muted-foreground">synced {relative(source.lastSuccessAt)}</span>
          <Button
            size="sm"
            variant="outline"
            disabled={sync.isPending}
            onClick={() =>
              sync.mutate(source.id, {
                onSuccess: (r) => {
                  const o = r.outcome as { ok: boolean; error?: string; skipped?: string };
                  o.ok ? toast.success(`${SOURCE_LABELS[source.id]} synced`) : toast.error(o.error ?? o.skipped ?? 'Sync failed');
                },
                onError: (e) => toast.error(`${SOURCE_LABELS[source.id]} sync failed: ${e.message}`),
              })
            }
          >
            {sync.isPending ? 'Syncing…' : 'Sync now'}
          </Button>
          <label className="flex items-center gap-2 text-xs">
            <Switch
              checked={source.enabled}
              disabled={setEnabled.isPending}
              onCheckedChange={(enabled) => setEnabled.mutate({ id: source.id, enabled }, { onError: (e) => toast.error(`Could not ${enabled ? 'enable' : 'pause'} ${SOURCE_LABELS[source.id]}: ${e.message}`) })}
            />{' '}
            Enabled
          </label>
        </div>
        <CardDescription>{description}</CardDescription>
        {source.lastError && (
          <p className="text-xs text-critical">
            <span className="font-[560]">Last error:</span> {source.lastError}
          </p>
        )}
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
    <div className="overflow-hidden rounded-xl bg-well">
      <button type="button" aria-expanded={open} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-well2/60" onClick={() => setOpen((v) => !v)} title="Show what this source has pulled">
        {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        <span className="font-medium">Data pulled</span>
        {source.lastRunAt && <span className="text-xs text-muted-foreground">last run {relative(source.lastRunAt)}</span>}
      </button>
      {open && (
        <div className="space-y-3 px-3 pb-3 pt-1 text-sm">
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
                // The id column is for debugging matches; on a phone it would squeeze the counts to a sliver.
                <table className="w-full text-xs">
                  <thead className="text-left text-muted-foreground">
                    <tr><th className="py-1 pr-2 font-normal">Course</th><th className="hidden py-1 pr-2 font-normal sm:table-cell">{source.id === 'canvas' ? 'Canvas id' : 'Gradescope id'}</th><th className="py-1 pr-2 font-normal">Items</th><th className="py-1 font-normal">Content</th></tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {d.byCourse.map((c) => (
                      <tr key={c.courseId} className="align-top">
                        <td className="py-1 pr-2 font-medium">
                          {c.code}
                          {c.role === 'ta' && <span className="ml-1 text-muted-foreground">TA</span>}
                          {!c.linkedId && <span className="block font-normal text-caution sm:hidden">not matched</span>}
                        </td>
                        <td className="hidden py-1 pr-2 font-mono sm:table-cell">{c.linkedId ?? <span className="text-caution">not matched</span>}</td>
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
                        {/* Kind, labels and status are secondary; below sm they go so the title keeps its width. */}
                        <span className="hidden w-20 shrink-0 text-muted-foreground sm:inline">{r.kind}</span>
                        {safeHref(r.url) ? <a className="min-w-0 flex-1 truncate hover:underline" href={safeHref(r.url)} target="_blank" rel="noreferrer">{r.title}</a> : <span className="min-w-0 flex-1 truncate">{r.title}</span>}
                        <span className="hidden shrink-0 text-muted-foreground sm:inline">{r.courseId ? d.byCourse.find((c) => c.courseId === r.courseId)?.code : r.labels.length ? r.labels.join(',') : ''}</span>
                        <span className="shrink-0 text-right text-muted-foreground sm:w-24">{friendlyDate(r.dueAt ?? r.startsAt)}</span>
                        <span className="hidden w-16 shrink-0 text-right text-muted-foreground sm:inline">{r.status}</span>
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
    /** Resolves when cleared and rejects on failure, so the confirm dialog stays open to retry. */
    clear: () =>
      clear.mutateAsync(id, {
        onSuccess: () => toast.success(`${SOURCE_LABELS[id]} cleared`),
        onError: (e) => toast.error(`Could not clear ${SOURCE_LABELS[id]}: ${e.message}`),
      }),
    pending: save.isPending || clear.isPending,
  };
}

/** Removing a saved credential stops the source until it is entered again, so it asks first. */
function RemoveCredential({ source, label = 'Clear', what, onConfirm, pending, size = 'default' }: { source: SourceId; label?: string; what: string; onConfirm: () => Promise<unknown>; pending?: boolean; size?: 'default' | 'sm' }) {
  return (
    <ConfirmDialog
      trigger={(open) => (
        <Button type="button" size={size} variant="ghost" onClick={open} disabled={pending}>
          {label}
        </Button>
      )}
      title={`${label} ${SOURCE_LABELS[source]}?`}
      description={`${what} Syncing stops until you connect it again. What was already pulled stays.`}
      confirmLabel={label}
      destructive
      onConfirm={onConfirm}
    />
  );
}

function CanvasForm({ source, ical }: { source: Source; ical: Source }) {
  const canvas = useSave('canvas');
  const icalSave = useSave('canvas_ical');
  const [cookie, setCookie] = useState('');
  // No default host: every school has its own Canvas address. The server mirrors the saved one into meta (it is
  // not a secret), so a replaced cookie starts from it; the field stays editable.
  const saved = typeof source.meta.baseUrl === 'string' ? source.meta.baseUrl : '';
  const [baseUrl, setBaseUrl] = useState(saved);
  useEffect(() => setBaseUrl((v) => (v.trim() ? v : saved)), [saved]);
  const normalized = normalizeCanvasBaseUrl(baseUrl);
  const cookieNotCookie = cookie.trim() !== '' && !cookie.includes('=');
  const blocker = canvasCookieBlocker(normalized, cookie);
  const [icalUrl, setIcalUrl] = useState('');
  const submitCookie = (e: FormEvent) => {
    e.preventDefault();
    if (!normalized || blocker) return;
    canvas.save({ baseUrl: normalized, cookieHeader: cookie.trim() }, () => setCookie(''));
  };
  const submitIcal = (e: FormEvent) => {
    e.preventDefault();
    icalSave.save({ url: icalUrl.trim() }, () => setIcalUrl(''));
  };
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form onSubmit={submitCookie} className="space-y-3">
        <Field label="Canvas URL" hint="Your school's Canvas address: what the browser shows when you open Canvas. A bare host or a page address both work; it is saved as https://<host>.">
          <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="canvas.yourschool.edu" aria-invalid={baseUrl.trim() !== '' && !normalized ? true : undefined} />
        </Field>
        {baseUrl.trim() !== '' && !normalized && <p className="-mt-2 text-xs text-critical">That does not look like a Canvas address: a host like canvas.yourschool.edu or umd.instructure.com.</p>}
        <Field
          label="Session cookie"
          hint={
            <>
              Easiest: run <Cmd>collected connect canvas</Cmd> on your laptop, which reads it from your browser. By hand: DevTools → Application → Cookies → your Canvas domain, and paste
              the whole cookie header or at least <Cmd>canvas_session=…</Cmd> (older instances call it <Cmd>_normandy_session</Cmd>).
            </>
          }
        >
          <Textarea rows={3} value={cookie} onChange={(e) => setCookie(e.target.value)} placeholder="_normandy_session=…; canvas_session=…" aria-invalid={cookieNotCookie ? true : undefined} />
        </Field>
        {cookieNotCookie && (
          <p className="-mt-2 text-xs text-critical">
            That does not look like a cookie: there is no <Cmd>name=value</Cmd> in it. Copy the value column next to <Cmd>canvas_session</Cmd> as <Cmd>canvas_session=…</Cmd>, or the whole Cookie header.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={!!blocker || canvas.pending}>
            {source.hasConfig ? 'Replace cookie' : 'Save cookie'}
          </Button>
          {source.hasConfig && (
            <RemoveCredential source="canvas" what="The saved cookie is removed." onConfirm={canvas.clear} pending={canvas.pending} />
          )}
          {blocker && <span className="text-xs text-muted-foreground">{blocker}</span>}
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
          <RemoveCredential source={source.id} what="The saved credential is removed." onConfirm={s.clear} pending={s.pending} />
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
          <RemoveCredential source={source.id} what="The saved credential is removed." onConfirm={s.clear} pending={s.pending} />
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
        <RemoveCredential source={source.id} what="The saved token is removed." onConfirm={s.clear} pending={s.pending} />
      )}
    </form>
  );
}

/** Fixed messages for the `reason` codes the Todoist OAuth callback redirects with; anything else reads as `unknown`. */
const TODOIST_ERRORS: Record<string, string> = {
  denied: 'Todoist connect failed: access was denied on the consent screen',
  expired: 'Todoist connect failed: the sign-in link expired, try again',
  exchange: 'Todoist connect failed: Todoist rejected the token exchange',
  config: "Todoist connect failed: this server's Todoist app is not set up correctly (client id, secret or redirect URL)",
  unknown: 'Todoist connect failed',
};

/** OAuth connect when the operator registered a Todoist app, with the pasted token folded away as the fallback; the plain token form otherwise. */
function TodoistForm({ source, local }: { source: Source; local: boolean }) {
  const meta = (source.meta ?? {}) as { connectedVia?: 'oauth' | 'token' | null };
  const disconnect = useDisconnectTodoist();
  const [showToken, setShowToken] = useState(false);
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    const t = params.get('todoist');
    if (!t) return;
    if (t === 'connected') toast.success('Todoist connected');
    else toast.error(TODOIST_ERRORS[params.get('reason') ?? ''] ?? TODOIST_ERRORS.unknown);
    params.delete('todoist');
    params.delete('reason');
    setParams(params, { replace: true });
  }, [params, setParams]);

  if (!source.oauthAvailable) {
    return (
      <div className="space-y-2">
        <TokenForm source={source} field="token" label="API token" />
        {local && <p className="text-xs text-muted-foreground">{LOCAL_TODOIST_NOTE}</p>}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild size="sm">
          <a href="/api/todoist/connect">{source.hasConfig ? 'Reconnect Todoist' : 'Connect Todoist'}</a>
        </Button>
        {source.hasConfig && (
          <RemoveCredential
            source="todoist"
            label="Disconnect"
            size="sm"
            what="The Todoist token is removed, and a Todoist sign-in is revoked at Todoist too."
            pending={disconnect.isPending}
            onConfirm={() => disconnect.mutateAsync(undefined, { onSuccess: () => toast.success('Todoist disconnected'), onError: (e) => toast.error(`Could not disconnect Todoist: ${e.message}`) })}
          />
        )}
        {source.hasConfig && meta.connectedVia && <span className="text-xs text-muted-foreground">{meta.connectedVia === 'oauth' ? 'signed in with Todoist' : 'using a pasted API token'}</span>}
      </div>
      <div>
        <button type="button" className="flex items-center gap-1 text-xs text-muted-foreground hover:underline" onClick={() => setShowToken((v) => !v)}>
          {showToken ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          or paste an API token
        </button>
        {showToken && (
          <div className="mt-2">
            <TokenForm source={source} field="token" label="API token" />
          </div>
        )}
      </div>
    </div>
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
  config: "Google connect failed: this server's Google sign-in is not set up correctly (client id, secret or redirect URL)",
  unknown: 'Google connect failed',
};

function GoogleForm({ source, local }: { source: Source; local: boolean }) {
  const meta = (source.meta ?? {}) as GCalMeta;
  const patch = usePatchSourceMeta();
  const clear = useClearSourceConfig();
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    const g = params.get('google');
    if (!g) return;
    if (g === 'connected') toast.success(params.get('source') === 'gtasks' ? 'Google Tasks connected' : 'Google Calendar connected');
    else if (g === 'unconfigured') toast.error(local ? `${LOCAL_GOOGLE_MISSING}, or use the iCal source.` : 'Google sign-in is not set up on this server yet. The self-host guide covers it.');
    else if (params.get('source') === 'gtasks' && params.get('reason') === 'unknown') toast.error('Google Tasks: the first sync failed, see the Google Tasks card (is the Tasks API enabled?)');
    else toast.error(GOOGLE_ERRORS[params.get('reason') ?? ''] ?? GOOGLE_ERRORS.unknown);
    params.delete('google');
    params.delete('reason');
    params.delete('source');
    setParams(params, { replace: true });
  }, [params, setParams, local]);

  const selected = new Set(meta.selectedCalendars ?? (meta.calendars ?? []).filter((c) => c.primary).map((c) => c.id));
  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected);
    on ? next.add(id) : next.delete(id);
    patch.mutate({ id: 'gcal', meta: { selectedCalendars: [...next] } }, { onError: (e) => toast.error(`Could not change calendars: ${e.message}`) });
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild size="sm">
          <a href="/api/google/start">{source.hasConfig ? 'Reconnect Google' : 'Connect Google Calendar'}</a>
        </Button>
        {source.hasConfig && (
          <RemoveCredential
            source="gcal"
            label="Disconnect"
            size="sm"
            what="The Google Calendar sign-in is removed from this server."
            pending={clear.isPending}
            onConfirm={() => clear.mutateAsync('gcal', { onSuccess: () => toast.success('Google Calendar disconnected'), onError: (e) => toast.error(`Could not disconnect: ${e.message}`) })}
          />
        )}
        {meta.demo && <span className="text-xs text-muted-foreground">showing demo calendars</span>}
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
                  <button className="text-xs text-muted-foreground underline-offset-2 hover:underline" disabled={patch.isPending} onClick={() => patch.mutate({ id: 'gcal', meta: { defaultCalendarId: c.id } }, { onError: (e) => toast.error(`Could not change the default calendar: ${e.message}`) })}>
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
          <RemoveCredential
            source="gtasks"
            label="Disconnect"
            size="sm"
            what="The Google Tasks sign-in is removed from this server; Calendar stays connected."
            pending={clear.isPending}
            onConfirm={() => clear.mutateAsync('gtasks', { onSuccess: () => toast.success('Google Tasks disconnected'), onError: (e) => toast.error(`Could not disconnect: ${e.message}`) })}
          />
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
