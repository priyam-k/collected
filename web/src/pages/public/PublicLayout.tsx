import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Moon, Sun, SunMoon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/lib/theme';

export const GITHUB_URL = 'https://github.com/priyam-k/collected';
export const SELF_HOST_DOC_URL = `${GITHUB_URL}/blob/main/docs/self-host.md`;
export const LICENSE_URL = `${GITHUB_URL}/blob/main/LICENSE`;
/** Replaced by the operator of a hosted instance; also used verbatim in the privacy policy text. */
export const OPERATOR_EMAIL = '{{OPERATOR_EMAIL}}';

function ThemeButton() {
  const { theme, resolved, setTheme } = useTheme();
  const Icon = theme === 'system' ? SunMoon : resolved === 'dark' ? Sun : Moon;
  const next = theme === 'system' ? (resolved === 'dark' ? 'light' : 'dark') : theme === 'dark' ? 'light' : 'dark';
  return (
    <Button variant="ghost" size="icon-sm" aria-label="Toggle theme" title={`Theme: ${theme}`} onClick={() => setTheme(next)}>
      <Icon className="size-4" />
    </Button>
  );
}

/** The small round mark the dashboard header uses, so the public pages read as the same product. */
export function Brand({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <span aria-hidden className="grid size-7 place-items-center rounded-full bg-ink text-[11px] font-semibold text-background shadow-[var(--shadow)]">
        c
      </span>
      <span className="text-[15px] font-semibold tracking-tight">collected</span>
    </span>
  );
}

/**
 * Chrome for the signed-out pages: a one-line header with the product name and a Sign in link, the page, and a
 * footer with Privacy, Terms, and GitHub. Pages wrap themselves in it, so each route is a single element.
 */
export function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-line bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-3 px-4 sm:px-6">
          <Link to="/" className="rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" aria-label="collected home">
            <Brand />
          </Link>
          <nav className="ml-auto flex items-center gap-1 sm:gap-2">
            <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="hidden rounded-full px-3 py-1.5 text-[13px] font-medium text-sub hover:text-ink sm:inline">
              GitHub
            </a>
            <ThemeButton />
            <Button asChild size="sm">
              <Link to="/signin">Sign in</Link>
            </Button>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 sm:px-6">{children}</main>
      <footer className="border-t border-line">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-6 text-[13px] text-sub sm:px-6">
          <Brand className="mr-auto opacity-80" />
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
      <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
      <p className="!mt-2 text-sm text-sub">Last updated: {updated}</p>
      {children}
    </article>
  );
}
