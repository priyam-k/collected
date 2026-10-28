import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Moon, Sun, SunMoon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useGlass } from '@/lib/liquid';
import { useTheme } from '@/lib/theme';

export const GITHUB_URL = 'https://github.com/priyam-k/collected';
export const SELF_HOST_DOC_URL = `${GITHUB_URL}/blob/main/docs/self-host.md`;
export const LICENSE_URL = `${GITHUB_URL}/blob/main/LICENSE`;
/** Replaced by the operator of a hosted instance; also used verbatim in the privacy policy text. */
/** Operators of a self-hosted copy: change these two lines (see README.md in this folder). */
export const OPERATOR_EMAIL = 'admin@priyamkabra.com';
export const GOVERNING_JURISDICTION = 'the State of Maryland, United States';

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

/** The small round mark the dashboard header uses, so the public pages read as the same product. */
export function Brand({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <span aria-hidden className="grid size-7 place-items-center rounded-full bg-ink text-[12px] font-semibold text-ground">
        c
      </span>
      <span className="text-[15px] font-semibold tracking-[-0.01em]">collected</span>
    </span>
  );
}

const SECTIONS: [string, string][] = [
  ['Demo', '/#demo'],
  ['How it works', '/#how'],
  ['Agents', '/#agents'],
  ['Features', '/#features'],
  ['Self-host', '/#self-host'],
];

/**
 * Chrome for the signed-out pages: a floating glass bar with the product name, the landing page's sections and a
 * Sign in link, the page, and a footer. `wide` lets the landing page run full width; legal pages keep a measure.
 */
export function PublicLayout({ children, wide }: { children: ReactNode; wide?: boolean }) {
  const glass = useGlass<HTMLDivElement>();
  return (
    <div className="flex min-h-full flex-col text-foreground">
      <header className="pointer-events-none sticky top-0 z-30 px-3 pt-3 sm:px-6 sm:pt-4">
        <div ref={glass} className="glass pointer-events-auto mx-auto flex h-[52px] w-full max-w-6xl items-center gap-2 p-1.5 pl-4">
          <Link to="/" className="rounded-full" aria-label="collected home">
            <Brand />
          </Link>
          <nav aria-label="Sections" className="mx-auto hidden items-center gap-0.5 lg:flex">
            {SECTIONS.map(([label, href]) => (
              <a key={href} href={href} className="glass-btn px-3.5 text-[14px] font-medium text-sub hover:text-ink">
                {label}
              </a>
            ))}
          </nav>
          <nav className="ml-auto flex items-center gap-0.5 lg:ml-0">
            <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="glass-btn hidden px-3.5 text-[14px] font-medium text-sub hover:text-ink sm:inline-flex">
              GitHub
            </a>
            <ThemeButton />
            <Button asChild>
              <Link to="/signin">Sign in</Link>
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
