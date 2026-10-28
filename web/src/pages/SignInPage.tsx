import { Navigate, useLocation, useSearchParams } from 'react-router';
import { AsciiOrb } from '@/components/AsciiOrb';
import { Button } from '@/components/ui/button';
import { isSignedIn, useMe } from '@/lib/queries';

const ERRORS: Record<string, string> = {
  denied: 'Google sign-in was cancelled.',
  expired: 'That sign-in link expired. Try again.',
  exchange: 'Google did not complete the sign-in. Try again.',
  config: 'Google sign-in is not configured on this server. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.',
  not_allowed: 'This instance belongs to someone else. Ask them to add your email to ALLOWED_EMAILS.',
};

export function SignInPage() {
  const me = useMe();
  const [params] = useSearchParams();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  if (me.data && isSignedIn(me.data)) return <Navigate to={from && from !== '/signin' ? from : '/'} replace />;
  const error = params.get('error');
  const next = from && from.startsWith('/') ? from : '/';
  const google = me.data?.signIn.google ?? true;
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="surface w-full max-w-sm p-7">
        <div className="grid h-[132px] place-items-center overflow-hidden rounded-[16px] bg-well">
          <AsciiOrb className="h-[120px] w-[200px]" />
        </div>
        <p className="label mt-6">Sign in</p>
        <h1 className="mt-1.5 text-[30px] font-[620] leading-tight tracking-[-0.028em]">collected</h1>
        <p className="mt-1.5 text-[14px] text-sub">Your courses, calendar, tasks and jobs on one board.</p>
        {error && ERRORS[error] && (
          <p role="alert" className="mt-4 rounded-xl bg-[color-mix(in_srgb,var(--critical)_10%,var(--surface))] px-3.5 py-2.5 text-[13px] text-ink">
            <span className="font-semibold text-critical">Error: </span>
            {ERRORS[error]}
          </p>
        )}
        <div className="mt-6">
          {google ? (
            <Button asChild size="lg" className="w-full">
              <a href={`/api/auth/google/start?next=${encodeURIComponent(next)}`}>Sign in with Google</a>
            </Button>
          ) : (
            <p className="text-[13px] text-sub">This server has no sign-in method configured.</p>
          )}
        </div>
        <p className="mt-4 text-xs leading-relaxed text-muted-foreground">Google is used for your identity only. Calendar access is a separate, optional step in Settings.</p>
      </div>
    </main>
  );
}
