import { Link, useSearchParams } from 'react-router';
import { isSignedIn, useMe } from '@/lib/queries';
import { DASHBOARD } from '@/lib/routes';
import { DemoBoard } from '@/demo/DemoBoard';
import { PublicLayout } from './PublicLayout';

/**
 * The live demo on its own page, full width, for anyone who wants more room than the landing page's window.
 * `?bare` drops the site chrome and shows the board alone (the README screenshots are taken that way).
 */
export function DemoPage() {
  const [params] = useSearchParams();
  const signedIn = isSignedIn(useMe().data);
  if (params.has('bare')) {
    return (
      <div className="mx-auto max-w-[1600px] px-1 sm:px-3">
        <DemoBoard height="auto" />
      </div>
    );
  }
  return (
    <PublicLayout wide>
      <div className="mx-auto max-w-[1600px] px-1 pt-6 sm:px-3">
        <div className="mx-3 mb-2 flex flex-wrap items-baseline justify-between gap-2 rounded-[18px] bg-brand-soft px-4 py-3 text-[13.5px] text-brand-ink">
          <span>
            <span className="font-semibold">Live demo.</span> A made-up semester on the real dashboard. Press Edit to rearrange; nothing is saved.
          </span>
          <Link to={signedIn ? DASHBOARD : '/signin'} className="font-semibold underline underline-offset-[3px]">
            {signedIn ? 'Back to your board' : 'Sign in to use your own'}
          </Link>
        </div>
        <DemoBoard height="auto" />
      </div>
    </PublicLayout>
  );
}
