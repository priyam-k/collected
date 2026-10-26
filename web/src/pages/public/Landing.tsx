import { useState } from 'react';
import { Link } from 'react-router';
import { BookOpen, FolderSync, Layers, Server } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GITHUB_URL, LICENSE_URL, OPERATOR_EMAIL, PublicLayout, SELF_HOST_DOC_URL } from './PublicLayout';

/**
 * Produced by another stream. Served from the web root, so the file must live at web/public/docs/screenshots/
 * (Vite copies public/ to the dist root); until it exists the slot renders a quiet placeholder instead of a broken image.
 */
const SCREENSHOT_SRC = '/docs/screenshots/dashboard.png';

const ONE_LINE = 'Canvas, Gradescope, Google Calendar, Todoist and a job feed on one rearrangeable board.';

const FEATURES = [
  {
    icon: Layers,
    title: 'Every source in one place',
    body: 'Assignments, submissions, events, tasks and internship listings are pulled on a timer into one local copy. Each source degrades on its own; the board never goes blank because one of them did.',
  },
  {
    icon: BookOpen,
    title: 'A pane per course',
    body: 'Files, dates, grades and announcements for each class, with your own notes layered on top. A Canvas homework and its Gradescope submission are matched into one row.',
  },
  {
    icon: FolderSync,
    title: 'Files on your laptop, a CLI for your agents',
    body: 'Course files land in folders you name, sorted by rules. The same CLI reads your agenda, grades and announcements and adds tasks and dates, so the AI agents on your machine can use it too.',
  },
  {
    icon: Server,
    title: 'Self-host or hosted',
    body: 'One container, one SQLite file, your own domain. Or an invite to the hosted instance if you would rather not run a box.',
  },
] as const;

function Screenshot() {
  const [missing, setMissing] = useState(false);
  return (
    <figure className="surface mt-10 overflow-hidden border border-line2 p-1.5 sm:mt-14 sm:p-2">
      {missing ? (
        <div aria-hidden className="grid aspect-[16/10] grid-cols-6 grid-rows-4 gap-1.5 rounded-[14px] bg-well p-3 sm:gap-2 sm:p-4">
          {['col-span-3 row-span-2', 'col-span-2 row-span-2', 'col-span-1 row-span-1', 'col-span-1 row-span-1', 'col-span-2 row-span-2', 'col-span-2 row-span-2', 'col-span-2 row-span-2'].map((cls, i) => (
            <div key={i} className={`${cls} rounded-xl border border-line2 bg-card/70`} />
          ))}
        </div>
      ) : (
        <img
          src={SCREENSHOT_SRC}
          alt="The collected board: calendar, to-do list, course panes, sources and job feed widgets on one grid."
          className="block w-full rounded-[14px]"
          loading="eager"
          onError={() => setMissing(true)}
        />
      )}
      <figcaption className="sr-only">A screenshot of the dashboard.</figcaption>
    </figure>
  );
}

function Code({ lines }: { lines: string[] }) {
  return (
    <pre className="mt-4 overflow-x-auto rounded-xl bg-well px-4 py-3 text-[12.5px] leading-6 text-ink">
      <code>{lines.join('\n')}</code>
    </pre>
  );
}

export function Landing() {
  return (
    <PublicLayout>
      <section className="pt-14 sm:pt-24">
        <p className="text-[13px] font-medium uppercase tracking-[0.12em] text-ter">For students</p>
        <h1 className="mt-3 max-w-3xl text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl">Everything you juggle, on one board.</h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-sub">{ONE_LINE}</p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button asChild size="lg">
            <Link to="/signin">Sign in</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <a href="#get-started">Self-host</a>
          </Button>
        </div>
        <Screenshot />
      </section>

      <section className="py-16 sm:py-24" aria-labelledby="features">
        <h2 id="features" className="sr-only">
          What it does
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div key={title} className="surface border border-line p-6">
              <span className="grid size-9 place-items-center rounded-full bg-well text-ink">
                <Icon className="size-4" />
              </span>
              <h3 className="mt-4 text-[15px] font-semibold tracking-tight">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-sub">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="get-started" className="scroll-mt-20 border-t border-line py-16 sm:py-24" aria-labelledby="get-started-title">
        <h2 id="get-started-title" className="text-2xl font-semibold tracking-tight">
          Get started
        </h2>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <div className="surface min-w-0 border border-line p-6">
            <h3 className="text-[15px] font-semibold tracking-tight">Self-host</h3>
            <p className="mt-2 text-sm leading-relaxed text-sub">A Linux box with Docker and a domain. The guide covers TLS, the Google OAuth client, backups and updates.</p>
            <Code lines={['git clone https://github.com/priyam-k/collected.git', 'cd collected && cp .env.example .env', 'docker compose up -d']} />
            <a href={SELF_HOST_DOC_URL} target="_blank" rel="noreferrer" className="mt-4 inline-block text-sm font-medium underline underline-offset-4 hover:text-ink">
              Read the self-host guide
            </a>
          </div>
          <div className="surface min-w-0 border border-line p-6">
            <h3 className="text-[15px] font-semibold tracking-tight">Hosted</h3>
            <p className="mt-2 text-sm leading-relaxed text-sub">
              The hosted instance is an invite-only beta. Ask for an invite and say which school you are at; the sources it can connect to depend on it.
            </p>
            <Button asChild variant="outline" className="mt-4">
              <a href={`mailto:${OPERATOR_EMAIL}?subject=collected%20invite`}>Request an invite</a>
            </Button>
            <p className="mt-4 text-xs leading-relaxed text-ter">
              Already have an account? <Link to="/signin" className="underline underline-offset-4 hover:text-ink">Sign in</Link>.
            </p>
          </div>
        </div>
        <p className="mt-10 text-sm leading-relaxed text-sub">
          Open source under the{' '}
          <a href={LICENSE_URL} target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-ink">
            AGPL-3.0
          </a>
          . The code, the issue tracker and the docs are on{' '}
          <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-ink">
            GitHub
          </a>
          .
        </p>
      </section>
    </PublicLayout>
  );
}
