import { useState, type ReactNode } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { scopeGrantsAny, type TokenScopes } from '@collected/shared';
import { Logo } from '@/components/Logo';
import { Button } from '@/components/ui/button';
import { isSignedIn, useApproveOAuth, useMe } from '@/lib/queries';
import { TokenScopePicker } from '@/settings/TokenScopes';

const INCOMPLETE = 'This link is incomplete; go back to the app that sent you here.';

/** The card every state of this page sits in: the sign-in page's look, without the dashboard around it. */
function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="surface relative z-10 w-full max-w-lg p-7">
        <Link to="/" aria-label="collected home" className="inline-flex rounded-xl">
          <Logo size={26} />
        </Link>
        {children}
      </div>
    </main>
  );
}

function parseUrl(raw: string | null): URL | null {
  if (!raw) return null;
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/** Where the browser goes back to, as a person would read it: the host, or the scheme for an app's custom scheme. */
function destination(url: URL): string {
  return url.host || `${url.protocol}//`;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Plain http to a host other than this machine: the code would cross the network unencrypted. */
function insecure(url: URL): boolean {
  return url.protocol === 'http:' && !LOOPBACK.has(url.hostname);
}

/**
 * The OAuth consent screen for a remote MCP connector. The server's /oauth/authorize checks the client and sends the
 * browser here with its query intact; Allow posts the approval and follows the redirect the server answers with.
 */
export function OAuthConsentPage() {
  const me = useMe();
  const [params] = useSearchParams();
  const location = useLocation();
  const approve = useApproveOAuth();
  // null is Everything, matching the Account page's default.
  const [scopes, setScopes] = useState<TokenScopes | null>(null);

  const clientId = params.get('client_id');
  const clientName = params.get('client_name')?.trim() || 'An MCP client';
  const redirectRaw = params.get('redirect_uri');
  const state = params.get('state');
  const codeChallenge = params.get('code_challenge');
  const resource = params.get('resource');
  const redirect = parseUrl(redirectRaw);

  if (me.isPending) return null;
  if (me.isError) {
    return (
      <Shell>
        <p className="mt-6 text-[13px] text-sub">The server is not answering. Check that it is running, then reload.</p>
      </Shell>
    );
  }

  if (!clientId || !redirectRaw || !redirect || !codeChallenge) {
    return (
      <Shell>
        <p className="label mt-6">Connect</p>
        <p className="mt-2.5 text-[14px] text-sub">{INCOMPLETE}</p>
      </Shell>
    );
  }

  if (!isSignedIn(me.data)) {
    const next = location.pathname + location.search;
    return (
      <Shell>
        <p className="label mt-6">Connect</p>
        <h1 className="mt-2.5 text-[20px] font-[620] leading-snug">Sign in to connect {clientName}</h1>
        <p className="mt-1.5 text-[14px] text-sub">You will come back here to choose what it may access.</p>
        <Button asChild className="mt-6 w-full">
          <a href={`/api/auth/google/start?next=${encodeURIComponent(next)}`}>Sign in</a>
        </Button>
      </Shell>
    );
  }

  const who = me.data.user?.email ?? me.data.identity;
  const usable = scopeGrantsAny(scopes);

  const allow = () => {
    if (!usable || approve.isPending) return;
    approve.mutate(
      {
        clientId,
        redirectUri: redirectRaw,
        ...(state ? { state } : {}),
        codeChallenge,
        codeChallengeMethod: 'S256',
        scopes,
        ...(resource ? { resource } : {}),
      },
      { onSuccess: (res) => window.location.assign(res.redirect) },
    );
  };

  const cancel = () => {
    const back = new URL(redirect.href);
    back.searchParams.set('error', 'access_denied');
    if (state) back.searchParams.set('state', state);
    window.location.assign(back.href);
  };

  return (
    <Shell>
      <p className="label mt-6">Connect</p>
      <h1 className="mt-2.5 text-[20px] font-[620] leading-snug">{clientName} wants to use collected</h1>
      <p className="mt-1.5 text-[14px] text-sub">
        An MCP connector. It will act as you, within the access you give it, until you revoke its token in Settings → Account.
      </p>
      <div className="mt-6">
        <TokenScopePicker value={scopes} onChange={setScopes} />
        {!usable && <p className="mt-2 text-xs text-muted-foreground">Give it read or write on at least one area.</p>}
      </div>
      {approve.isError && (
        <p role="alert" className="mt-4 rounded-xl bg-[color-mix(in_srgb,var(--critical)_10%,var(--surface))] px-3.5 py-2.5 text-[13px] text-ink">
          <span className="font-semibold text-critical">Error: </span>
          {approve.error.message}
        </p>
      )}
      <div className="mt-6 space-y-1 text-xs text-muted-foreground">
        {who && (
          <p>
            Signed in as <span className="font-medium text-sub">{who}</span>
          </p>
        )}
        <p>
          You will be sent back to <span className="font-medium text-sub">{destination(redirect)}</span>.
          {insecure(redirect) && <span className="text-critical"> That address is not https; allow only if you expected it.</span>}
        </p>
      </div>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={cancel}>
          Cancel
        </Button>
        <Button onClick={allow} disabled={!usable || approve.isPending}>
          {approve.isPending ? 'Allowing…' : 'Allow'}
        </Button>
      </div>
    </Shell>
  );
}
