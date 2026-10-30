import type { ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import { Moon, Sun, SunMoon } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { Button } from '@/components/ui/button';
import { useGlass, useLiquid } from '@/lib/liquid';
import { isSignedIn, useMe } from '@/lib/queries';
import { DASHBOARD } from '@/lib/routes';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';

export const GITHUB_URL = 'https://github.com/priyam-k/collected';
export const SELF_HOST_DOC_URL = `${GITHUB_URL}/blob/main/docs/self-host.md`;
export const LOCAL_MODE_DOC_URL = `${GITHUB_URL}/blob/main/agent/README.md#local-mode`;
export const LICENSE_URL = `${GITHUB_URL}/blob/main/LICENSE`;
/** Replaced by the operator of a hosted instance; also used verbatim in the privacy policy text. */
/** Operators of a self-hosted copy: change these two lines (see README.md in this folder). */
export const OPERATOR_EMAIL = 'admin@priyamkabra.com';
export const GOVERNING_JURISDICTION = 'the State of Maryland, United States';
/** The sign-in page says hosting is invite-only and points to self-hosting and the waitlist. Set false on your own copy. */
export const INVITE_ONLY_NOTICE = true;

function ThemeButton() {
  const { theme, resolved, setTheme } = useTheme();
  const Icon = theme === 'system' ? SunMoon : resolved === 'dark' ? Sun : Moon;
  const next = theme === 'system' ? (resolved === 'dark' ? 'light' : 'dark') : theme === 'dark' ? 'light' : 'dark';
  return (
    <button className="glass-btn" aria-label="Toggle theme" title={`Theme: ${theme}`} onClick={() => setTheme(next)}>
      <Icon className="size-[18px]" strokeWidth={1.7} />
    </button>
  );
}

/** The logo as the public pages show it: the board mark and "collected.". */
export function Brand({ className = '' }: { className?: string }) {
  return <Logo size={17} className={className} />;
}

/** The other public pages, linked from everywhere but the landing page (which links its own sections). */
const PAGES: [string, string][] = [
  ['Home', '/'],
  ['Live demo', '/demo'],
  ['Privacy', '/privacy'],
  ['Terms', '/terms'],
];

const SECTIONS: [string, string][] = [
  ['Demo', '/#demo'],
  ['How it works', '/#how'],
  ['Agents', '/#agents'],
  ['Features', '/#features'],
  ['Run it', '/#self-host'],
];

/**
 * Chrome for the signed-out pages: a floating glass bar with the product name, links and a Sign in button, the page,
 * and a footer. The landing page links its own sections (`nav="sections"`); every other page links the public pages,
 * the current one marked by a springing thumb. `wide` lets a page run full width; legal pages keep a measure.
 */
export function PublicLayout({ children, wide, nav = 'pages' }: { children: ReactNode; wide?: boolean; nav?: 'sections' | 'pages' }) {
  const glass = useGlass<HTMLDivElement>();
  const liquid = useLiquid<HTMLElement>();
  const { pathname } = useLocation();
  const signedIn = isSignedIn(useMe().data);
  // On the home page the logo is "back to the top": the route is already '/', so scroll there and drop any #section.
  const toTop = (e: React.MouseEvent) => {
    if (pathname !== '/') return;
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    history.replaceState(history.state, '', '/');
  };
  return (
    <div className="flex min-h-full flex-col text-foreground">
      <header className="pointer-events-none sticky top-0 z-30 px-3 pt-3 sm:px-6 sm:pt-4">
        <div ref={glass} className="glass pointer-events-auto mx-auto flex h-[52px] w-full max-w-6xl items-center gap-2 p-1.5 pl-4">
          {/* flex, not a plain block: a block gives the inline-flex logo a text line, whose descender space below
              it sat the logo 3px above the pill's centre. */}
          <Link to="/" className="flex rounded-full" aria-label="collected home" onClick={toTop}>
            <Brand />
          </Link>
          {nav === 'sections' ? (
            <nav aria-label="Sections" className="mx-auto hidden items-center gap-0.5 lg:flex">
              {SECTIONS.map(([label, href]) => (
                <a key={href} href={href} className="glass-btn px-3.5 text-[14px] font-medium text-sub hover:text-ink">
                  {label}
                </a>
              ))}
            </nav>
          ) : (
            <nav ref={liquid} aria-label="Pages" className="relative mx-auto hidden items-center gap-0.5 md:flex">
              {PAGES.map(([label, to]) => (
                <NavLink key={to} to={to} end className={({ isActive }) => cn('glass-btn relative z-[1] px-3.5 text-[14px] font-medium', isActive ? 'text-ink' : 'text-sub hover:text-ink')}>
                  {label}
                </NavLink>
              ))}
            </nav>
          )}
          <nav className="ml-auto flex items-center gap-0.5 lg:ml-0">
            <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="glass-btn hidden px-3.5 text-[14px] font-medium text-sub hover:text-ink sm:inline-flex">
              GitHub
            </a>
            <ThemeButton />
            <Button asChild>
              {/* Someone already signed in, reading the demo or the legal pages, gets their board instead. */}
              <Link to={signedIn ? DASHBOARD : '/signin'}>{signedIn ? 'Open dashboard' : 'Sign in'}</Link>
            </Button>
          </nav>
        </div>
      </header>
      <main className={wide ? 'w-full flex-1' : 'mx-auto w-full max-w-5xl flex-1 px-4 sm:px-6'}>{children}</main>
      <footer className="mt-8 border-t border-line">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-5 py-7 text-[13px] text-sub sm:px-6">
          <Brand className="opacity-80" />
          <span className="mr-auto text-ter">© {new Date().getFullYear()} Priyam Kabra</span>
          <Link to="/demo" className="hover:text-ink">
            Live demo
          </Link>
          <Link to="/privacy" className="hover:text-ink">
            Privacy
          </Link>
          <Link to="/terms" className="hover:text-ink">
            Terms
          </Link>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="hover:text-ink">
            GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}

/** Long-form legal text: a readable measure, spaced headings, plain lists. */
export function Prose({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <article className="mx-auto max-w-prose py-10 sm:py-14 [&_a]:underline [&_a]:underline-offset-4 [&_a:hover]:text-ink [&_h2]:mt-10 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:tracking-tight [&_h3]:mt-6 [&_h3]:text-[15px] [&_h3]:font-semibold [&_li]:mt-1.5 [&_li]:leading-relaxed [&_p]:mt-3 [&_p]:leading-relaxed [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5 [&_code]:rounded [&_code]:bg-well [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.9em]">
      <h1 className="text-[40px] font-[620] leading-[1.06] tracking-[-0.03em]">{title}</h1>
      <p className="label !mt-3">Last updated · {updated}</p>
      {children}
    </article>
  );
}
