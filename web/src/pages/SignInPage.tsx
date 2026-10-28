import { Link, Navigate, useLocation, useSearchParams } from 'react-router';
import { AsciiOrb } from '@/components/AsciiOrb';
import { Logo } from '@/components/Logo';
import { isSignedIn, useMe } from '@/lib/queries';
import { DASHBOARD } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { INVITE_ONLY_NOTICE, OPERATOR_EMAIL } from '@/pages/public/PublicLayout';

const ERRORS: Record<string, string> = {
  denied: 'Google sign-in was cancelled.',
  expired: 'That sign-in link expired. Try again.',
  exchange: 'Google did not complete the sign-in. Try again.',
  config: 'Google sign-in is not configured on this server. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.',
  not_allowed: 'This instance belongs to someone else. Ask them to add your email to ALLOWED_EMAILS.',
};

/** Google's four-colour "G", as its sign-in branding guidelines ask for on a Sign in with Google button. */
function GoogleG() {
  return (
    <svg viewBox="0 0 48 48" className="size-5 shrink-0" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

const noticeLink = 'font-semibold underline decoration-[color-mix(in_srgb,var(--brand-ink)_40%,transparent)] underline-offset-[3px] hover:decoration-current';

export function SignInPage() {
  const me = useMe();
  const [params] = useSearchParams();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  // Signing in lands on the board, or back on the page that sent the person here.
  if (me.data && isSignedIn(me.data)) return <Navigate to={from && from !== '/signin' ? from : DASHBOARD} replace />;
  const error = params.get('error');
  const next = from && from.startsWith('/') ? from : DASHBOARD;
  const google = me.data?.signIn.google ?? true;
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      {/* The notice sits behind the card like the next card in a stack. It tucks 56px under, past both cards' 22px corners, so its own bottom curves never show in the card's corner notches. */}
      {INVITE_ONLY_NOTICE && (
        <p className="flex w-full max-w-sm gap-2.5 rounded-[22px] bg-brand-soft px-5 pb-[66px] pt-2.5 text-[13.5px] leading-relaxed text-brand-ink">
          <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-brand" />
          <span>
            Hosted collected is an invite-only beta for now. In the meantime,{' '}
            <Link to="/#self-host" className={noticeLink}>
              self-host it
            </Link>{' '}
            or{' '}
            <a href={`mailto:${OPERATOR_EMAIL}?subject=collected%20waitlist`} className={noticeLink}>
              join the waitlist
            </a>
            .
          </span>
        </p>
      )}
      <div className={cn('surface relative z-10 w-full max-w-sm p-7', INVITE_ONLY_NOTICE && '-mt-14')}>
        <div className="grid h-[132px] place-items-center overflow-hidden rounded-[16px] bg-well">
          <AsciiOrb className="h-[120px] w-[200px]" />
        </div>
        <p className="label mt-6">Sign in</p>
        <h1 className="mt-2.5">
          <Link to="/" aria-label="collected home" className="inline-flex rounded-xl">
            <Logo size={30} />
          </Link>
        </h1>
        <p className="mt-1.5 text-[14px] text-sub">Your courses, calendar, tasks and jobs on one board.</p>
        {error && ERRORS[error] && (
          <p role="alert" className="mt-4 rounded-xl bg-[color-mix(in_srgb,var(--critical)_10%,var(--surface))] px-3.5 py-2.5 text-[13px] text-ink">
            <span className="font-semibold text-critical">Error: </span>
            {ERRORS[error]}
          </p>
        )}
        <div className="mt-6">
          {google ? (
            // Google's neutral button: white with a grey rim in light, near-black in dark, never the app's accent.
            <a
              href={`/api/auth/google/start?next=${encodeURIComponent(next)}`}
              className="flex h-12 w-full items-center justify-center gap-3 rounded-full bg-white text-[15px] font-[560] text-[#1f1f1f] shadow-[inset_0_0_0_1px_#747775] transition-[background-color,transform] duration-150 hover:bg-[#f7f8f8] active:scale-[.98] dark:bg-[#131314] dark:text-[#e3e3e3] dark:shadow-[inset_0_0_0_1px_#8e918f] dark:hover:bg-[#1c1c1e]"
            >
              <GoogleG />
              Sign in with Google
            </a>
          ) : (
            <p className="text-[13px] text-sub">This server has no sign-in method configured.</p>
          )}
        </div>
      </div>
      <Link to="/" className="mt-5 text-[13.5px] font-medium text-sub transition-colors hover:text-ink">
        ← Back to the home page
      </Link>
    </main>
  );
}
