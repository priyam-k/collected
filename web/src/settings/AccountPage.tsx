import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCreateToken, useLogout, useMe, useRevokeToken, useTokens } from '@/lib/queries';
import { Field, PageTitle } from './ui';

function when(iso: string | null): string {
  if (!iso) return 'never';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** Who you are, sign out, and the tokens the CLI uses (`collected login` sends people here with ?cli=1&device=…). */
export function AccountPage() {
  const me = useMe();
  const tokens = useTokens();
  const create = useCreateToken();
  const revoke = useRevokeToken();
  const logout = useLogout();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const cli = params.get('cli') === '1';
  const [name, setName] = useState('');
  const [fresh, setFresh] = useState<{ name: string; token: string } | null>(null);
  useEffect(() => {
    if (!name) setName(params.get('device') ?? '');
  }, [params, name]);

  const user = me.data?.user;
  const person = !!user;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    try {
      const t = await create.mutateAsync(n);
      setFresh({ name: t.name, token: t.token });
      setName('');
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Copied');
    } catch {
      toast.error('Could not copy; select the text instead');
    }
  };

  return (
    <div className="space-y-6">
      <PageTitle sub={me.data?.authDisabled ? 'Authentication is off (AUTH_DISABLED); this is local development.' : 'Signed in with Google.'}>Account</PageTitle>

      {user && (
        <div className="flex items-center gap-3 rounded-xl border border-line2 bg-card p-3">
          {user.picture ? <img src={user.picture} alt="" className="size-10 rounded-full" referrerPolicy="no-referrer" /> : <div className="size-10 rounded-full bg-well2" />}
          <div className="min-w-0">
            <div className="truncate font-medium">{user.name ?? user.email}</div>
            <div className="truncate text-[13px] text-sub">{user.email}</div>
          </div>
          {!me.data?.authDisabled && (
            <Button
              variant="outline"
              className="ml-auto"
              onClick={() => logout.mutate(undefined, { onSuccess: () => navigate('/signin', { replace: true }), onError: (e) => toast.error(e.message) })}
            >
              Sign out
            </Button>
          )}
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-base font-semibold">CLI tokens</h2>
        <p className="text-[13px] text-sub">
          The <code className="rounded bg-well px-1">collected</code> command on your laptop signs in with a token. Create one per machine; revoke it here if the machine is lost.
          {cli && ' Paste the new token back into the terminal that sent you here.'}
        </p>
        {person && (
          <form onSubmit={submit} className="flex max-w-md items-end gap-2">
            <Field label="Token name" hint="Usually the machine, e.g. macbook-air.">
              <Input value={name} maxLength={80} placeholder="macbook-air" onChange={(e) => setName(e.target.value)} autoFocus={cli} />
            </Field>
            <Button type="submit" disabled={!name.trim() || create.isPending}>
              Create
            </Button>
          </form>
        )}
        {fresh && (
          <div role="status" className="space-y-2 rounded-xl border border-line2 bg-well p-3">
            <div className="text-[13px]">
              Token for <strong>{fresh.name}</strong>. It is shown once; copy it now.
            </div>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-card px-2 py-1 font-mono text-[12px]">{fresh.token}</code>
              <Button size="sm" variant="outline" onClick={() => copy(fresh.token)}>
                Copy
              </Button>
            </div>
            <div className="text-xs text-muted-foreground">
              In a terminal: <code className="rounded bg-card px-1">collected login</code> and paste it, or <code className="rounded bg-card px-1">collected auth token</code>.
            </div>
          </div>
        )}
        <ul className="divide-y divide-line2 rounded-xl border border-line2 bg-card">
          {(tokens.data ?? []).map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{t.name}</div>
                <div className="truncate text-xs text-sub">
                  <span className="font-mono">{t.prefix}…</span> · created {when(t.createdAt)} · last used {when(t.lastUsedAt)}
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => revoke.mutate(t.id, { onSuccess: () => toast.success(`Revoked ${t.name}`), onError: (e) => toast.error(e.message) })}>
                Revoke
              </Button>
            </li>
          ))}
          {tokens.data && tokens.data.length === 0 && <li className="px-3 py-3 text-[13px] text-sub">No tokens yet.</li>}
          {tokens.isError && <li className="px-3 py-3 text-[13px] text-sub">Tokens are managed by the signed-in person, not a token.</li>}
        </ul>
      </section>
    </div>
  );
}
