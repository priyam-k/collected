import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowDown, ArrowRight, Bot, Briefcase, CalendarDays, ClipboardCheck, Database, GraduationCap, Laptop, ListChecks, ListTodo, MousePointerClick, Server, ShieldCheck, SquareTerminal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DemoBoard } from '@/demo/DemoBoard';
import { isSignedIn, useMe } from '@/lib/queries';
import { DASHBOARD } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { AgentPrompt } from './landing/AgentPrompt';
import { AsciiLogo } from './landing/AsciiLogo';
import { Bento } from './landing/Bento';
import { DotField } from './landing/DotField';
import { Hub } from './landing/Hub';
import { Reveal, useScrollProgress } from './landing/motion';
import { Terminal } from './landing/Terminal';
import { GITHUB_URL, LICENSE_URL, LOCAL_MODE_DOC_URL, OPERATOR_EMAIL, PublicLayout, SELF_HOST_DOC_URL } from './PublicLayout';

const PITCH = 'Canvas, Gradescope, Google Calendar, Todoist, Google Tasks and an internship feed, pulled into one dashboard you arrange yourself.';
const PITCH_2 = 'Open source, on your laptop or server, readable by your AI agents.';

const WORKS_WITH: [string, typeof GraduationCap][] = [
  ['Canvas', GraduationCap],
  ['Gradescope', ClipboardCheck],
  ['Google Calendar', CalendarDays],
  ['Todoist', ListChecks],
  ['Google Tasks', ListTodo],
  ['Job feeds', Briefcase],
];

/**
 * A section's heading. `id` is the nav anchor: it sits on a plain wrapper (the heading itself starts its reveal
 * offset) so a jump lands the heading just under the floating nav, not the section's top padding.
 */
function SectionHead({ id, eyebrow, title, sub, className }: { id?: string; eyebrow: string; title: ReactNode; sub?: string; className?: string }) {
  return (
    <div id={id} className="scroll-mt-24">
    <Reveal className={cn('mx-auto max-w-3xl text-center', className)}>
      <p className="label">{eyebrow}</p>
      <h2 className="mt-3 text-[clamp(32px,4.6vw,56px)] font-[640] leading-[1.02] tracking-[-0.035em]">{title}</h2>
      {sub && <p className="mx-auto mt-5 max-w-2xl text-[17px] leading-relaxed text-sub sm:text-[18px]">{sub}</p>}
    </Reveal>
    </div>
  );
}

function Hero() {
  return (
    <section className="relative isolate">
      <DotField className="absolute inset-x-0 -top-24 -z-10 h-[820px] w-full opacity-80 [mask-image:radial-gradient(ellipse_62%_58%_at_50%_34%,#000_10%,transparent_72%)]" />
      <div className="mx-auto max-w-6xl px-5 pt-14 text-center sm:pt-20">
        <Reveal>
          <a href="#self-host" className="glass inline-flex h-9 items-center gap-2 px-3.5 text-[13px] font-medium text-ink transition-transform hover:scale-[1.02]">
            <span className="size-1.5 rounded-full bg-brand" />
            Now runs on your laptop
            <ArrowRight className="size-3.5 text-sub" />
          </a>
        </Reveal>
        <Reveal delay={60}>
          <h1 className="mx-auto mt-7 text-[clamp(40px,6.6vw,98px)] font-[660] leading-[0.96] tracking-[-0.046em]">
            Everything you juggle,
            <br />
            <span className="text-sub">on one board.</span>
          </h1>
        </Reveal>
        <Reveal delay={120}>
          <p className="mx-auto mt-7 max-w-2xl text-[clamp(17px,1.7vw,21px)] leading-[1.55] text-sub">
            {PITCH} <br className="hidden sm:block" />
            {PITCH_2}
          </p>
        </Reveal>
        <Reveal delay={180}>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg" className="h-12 px-6 text-[15px]">
              <a href="#demo">
                Try the live demo <ArrowDown className="size-4" />
              </a>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-12 px-6 text-[15px]">
              <a href="#self-host">Run it yourself</a>
            </Button>
          </div>
          <p className="mt-5 text-[13px] text-ter">Free and open source · AGPL-3.0 · No ads, no tracking</p>
        </Reveal>
        <Reveal delay={210}>
          <AgentPrompt />
        </Reveal>
        <Reveal delay={240}>
          <ul className="mx-auto mt-14 flex max-w-4xl flex-wrap items-center justify-center gap-x-7 gap-y-3 text-[14px] font-medium text-sub">
            {WORKS_WITH.map(([name, Icon]) => (
              <li key={name} className="flex items-center gap-2">
                <Icon className="size-4" strokeWidth={1.7} />
                {name}
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </section>
  );
}

/** The real dashboard on demo data, in a window that tilts back and flattens as it scrolls up into view. */
function DemoShowcase() {
  const [ref, p] = useScrollProgress<HTMLDivElement>(0.34);
  const [editing, setEditing] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(720);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(Math.round(Math.max(380, Math.min(780, el.clientWidth * 0.62)))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // flat once it is well into view, and always while someone is rearranging it (drags must land where they point)
  const flat = p >= 0.999 || editing;
  const tilt = 1 - p;
  return (
    <section className="px-3 pt-16 sm:px-6 sm:pt-20">
      <div id="demo" ref={ref} className="mx-auto max-w-[1240px] scroll-mt-24 [perspective:1800px]">
        <div
          className="demo-frame rounded-[30px] p-2 sm:p-2.5"
          style={flat ? undefined : { transform: `rotateX(${tilt * 18}deg) scale(${0.9 + 0.1 * p}) translateY(${tilt * -24}px)`, transformOrigin: '50% 0%' }}
        >
          <div className="flex h-10 items-center gap-2 px-3">
            <span className="size-3 rounded-full bg-[#ff5f57]" />
            <span className="size-3 rounded-full bg-[#febc2e]" />
            <span className="size-3 rounded-full bg-[#28c840]" />
            <span className="mx-auto hidden h-7 w-[min(360px,50%)] items-center justify-center rounded-full bg-well text-[12px] text-sub sm:flex">collected.priyamkabra.com</span>
            <span className="ml-auto flex items-center gap-1.5 rounded-full bg-brand-soft px-2.5 py-1 text-[11.5px] font-semibold text-brand-ink sm:ml-0">
              <span className="size-1.5 animate-pulse rounded-full bg-brand" /> Live demo
            </span>
          </div>
          <div ref={box} className="overflow-hidden rounded-[22px] bg-ground">
            <DemoBoard height={height} onEditModeChange={setEditing} />
          </div>
        </div>
      </div>
      <Reveal className="mx-auto mt-6 flex max-w-3xl flex-wrap items-center justify-center gap-x-5 gap-y-2 text-center text-[13.5px] text-sub">
        <span className="flex items-center gap-1.5">
          <MousePointerClick className="size-4" strokeWidth={1.7} /> This is the actual dashboard, running on sample data. Drag and resize cards in Edit, check things off, open a course.
        </span>
        <span className="text-ter">Nothing is saved; reload to reset.</span>
        <Link to="/demo" className="font-medium text-ink underline decoration-line-strong underline-offset-[3px] hover:decoration-brand">
          Open it full screen
        </Link>
      </Reveal>
    </section>
  );
}

function Agents() {
  const harnesses = ['Claude Code', 'Codex', 'Gemini CLI', 'Cursor'];
  const chip = 'flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium';
  return (
    <section className="px-5 py-24 sm:py-32">
      <div id="agents" className="mx-auto grid max-w-6xl scroll-mt-28 items-center gap-12 lg:grid-cols-[1fr_1.15fr]">
        <Reveal>
          <p className="label">Built for agents</p>
          <h2 className="mt-3 text-[clamp(32px,4.4vw,52px)] font-[640] leading-[1.03] tracking-[-0.035em]">Your agents can read the board too.</h2>
          <p className="mt-5 max-w-lg text-[17px] leading-relaxed text-sub">
            The <code className="rounded-md bg-well px-1.5 py-0.5 font-mono text-[14px] text-ink">collected</code> CLI puts every view on the dashboard behind a command: your agenda, what is due, grades,
            announcements, the job tracker. Add <code className="rounded-md bg-well px-1.5 py-0.5 font-mono text-[14px] text-ink">--json</code> and any agent that can run a shell command can plan your week
            with you.
          </p>
          <ul className="mt-7 flex flex-wrap gap-2" aria-label="Works with">
            {harnesses.map((h) => (
              <li key={h} className={cn(chip, 'bg-surface shadow-[var(--shadow-card)]')}>
                <Bot className="size-3.5 text-sub" strokeWidth={1.8} />
                {h}
              </li>
            ))}
            {/* The catch-all: an outline chip, so it reads as "or anything else", not a fifth product. */}
            <li className={cn(chip, 'border border-dashed border-line-strong text-sub')}>
              <SquareTerminal className="size-3.5" strokeWidth={1.8} />
              or anything with a shell
            </li>
          </ul>
        </Reveal>
        <Reveal delay={100} className="relative">
          <Terminal reserve />
          <div className="agent-bubble absolute -bottom-8 -left-2 hidden max-w-[300px] rounded-[20px] p-4 sm:block lg:-left-10">
            <div className="flex items-center gap-2 text-[12px] font-semibold">
              <span className="grid size-6 place-items-center rounded-full bg-brand text-on-brand">
                <Bot className="size-3.5" />
              </span>
              Your agent
            </div>
            <p className="mt-2 text-[13px] leading-relaxed">
              Two things are due before Friday: <b>Problem set 6</b> for CS351 tomorrow night and <b>Homework 8</b> for MATH340. Want me to block out time for both?
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/** A run of shell commands in a well, one per line, each behind a muted prompt. Grows to fill its card. */
function Commands({ lines }: { lines: string[] }) {
  return (
    <pre className="mt-5 flex-1 overflow-x-auto rounded-[16px] bg-well px-4 py-4 font-mono text-[12px] leading-7 text-ink sm:px-5 sm:text-[13px]">
      <code>
        {lines.map((line, i) => (
          <span key={line}>
            <span className="text-ter">$ </span>
            {line}
            {i < lines.length - 1 ? '\n' : null}
          </span>
        ))}
      </code>
    </pre>
  );
}

function CardHead({ icon, title, tone = 'well', badge }: { icon: ReactNode; title: string; tone?: 'well' | 'positive'; badge?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className={cn('grid size-9 place-items-center rounded-full', tone === 'positive' ? 'bg-[color-mix(in_srgb,var(--positive)_14%,var(--surface))] text-positive' : 'bg-well')}>{icon}</span>
      <h3 className="text-[19px] font-semibold tracking-[-0.015em]">{title}</h3>
      {badge && <span className="ml-auto rounded-full bg-brand-soft px-2.5 py-1 text-[11.5px] font-semibold text-brand-ink">{badge}</span>}
    </div>
  );
}

const docLink = 'mt-5 inline-flex items-center gap-1.5 self-start text-[14px] font-medium text-ink underline decoration-line-strong underline-offset-4 hover:decoration-brand';

/** The three ways to run it: the laptop (local mode), a server of your own, the hosted beta. `#self-host` is linked from the nav and the sign-in page. */
function RunIt() {
  return (
    <section className="px-5 py-24 sm:py-28">
      <SectionHead
        id="self-host"
        eyebrow="Yours to run"
        title={
          <>
            Your laptop, your server,{' '}
            <br className="hidden sm:block" />
            <span className="text-sub">or ours.</span>
          </>
        }
        sub="Run the whole thing on one machine with nothing but Node, put it on a small server you control, or ask for an invite to the hosted instance."
      />
      <div className="mx-auto mt-14 grid max-w-6xl gap-4 lg:grid-cols-2">
        <Reveal className="surface flex min-w-0 flex-col rounded-[26px] p-6 sm:p-7">
          <CardHead icon={<Laptop className="size-[18px]" strokeWidth={1.7} />} title="On your laptop" badge="New" />
          <p className="mt-3 max-w-xl text-[14.5px] leading-relaxed text-sub">
            The whole backend runs inside the CLI, over a SQLite database on this machine, and{' '}
            <code className="rounded-md bg-well px-1.5 py-0.5 font-mono text-[13px] text-ink">collected ui</code> opens the same dashboard. Sources keep syncing while it is open.
          </p>
          <Commands lines={['npm i -g collected-cli', 'collected init --local', 'collected connect canvas', 'collected connect google calendar', 'collected ui']} />
          <p className="mt-4 text-[13.5px] text-ter">
            No server. No Google Cloud project. Data stays in <span className="font-mono text-[12.5px] text-sub">~/.collected</span>.
          </p>
          <a href={LOCAL_MODE_DOC_URL} target="_blank" rel="noreferrer" className={docLink}>
            Read the CLI guide <ArrowRight className="size-3.5" />
          </a>
        </Reveal>
        <Reveal delay={80} className="surface flex min-w-0 flex-col rounded-[26px] p-6 sm:p-7">
          <CardHead icon={<Server className="size-[18px]" strokeWidth={1.7} />} title="Self-host" />
          <p className="mt-3 max-w-xl text-[14.5px] leading-relaxed text-sub">A Linux box with Docker and a domain, so every device you own sees the board. The guide covers TLS, the Google OAuth client, backups and updates, and the app tells you when a new version is out.</p>
          <Commands lines={[`git clone ${GITHUB_URL}.git`, 'cd collected && cp .env.example .env', 'mkdir -p data && sudo chown 1000:1000 data', 'docker compose pull', 'docker compose up -d']} />
          <p className="mt-4 text-[13.5px] text-ter">
            One container, one SQLite file, the prebuilt image from <span className="font-mono text-[12.5px] text-sub">ghcr.io</span>.
          </p>
          <a href={SELF_HOST_DOC_URL} target="_blank" rel="noreferrer" className={docLink}>
            Read the self-host guide <ArrowRight className="size-3.5" />
          </a>
        </Reveal>
        <Reveal delay={140} className="surface flex min-w-0 flex-col rounded-[26px] p-6 sm:p-7">
          <CardHead icon={<Database className="size-[18px]" strokeWidth={1.7} />} title="Hosted" />
          <p className="mt-3 text-[14.5px] leading-relaxed text-sub">An invite-only beta, for when you would rather not run anything. Say which school you are at; what it can connect to depends on it.</p>
          <Button asChild variant="outline" className="mt-5 self-start">
            <a href={`mailto:${OPERATOR_EMAIL}?subject=collected%20invite`}>Request an invite</a>
          </Button>
        </Reveal>
        <Reveal delay={200} className="surface flex min-w-0 flex-col rounded-[26px] p-6 sm:p-7">
          <CardHead icon={<ShieldCheck className="size-[18px]" strokeWidth={1.7} />} title="Your data stays yours" tone="positive" />
          <p className="mt-3 text-[14.5px] leading-relaxed text-sub">
            Never sold, never used for ads or to train models, no tracking cookies. Open source under the{' '}
            <a href={LICENSE_URL} target="_blank" rel="noreferrer" className="text-ink underline decoration-line-strong underline-offset-[3px] hover:decoration-brand">
              AGPL-3.0
            </a>
            .
          </p>
        </Reveal>
      </div>
    </section>
  );
}

/**
 * The foot of the page, a sign-off: the headline and the two ways on, plain on the page ground with room around them,
 * then the logo in characters as a band edge to edge across the full width, assembling as the page runs out and
 * running straight into the footer.
 */
function Closing() {
  const signedIn = isSignedIn(useMe().data);
  return (
    <section>
      <Reveal className="px-5 py-20 text-center sm:py-24">
        <h2 className="text-[clamp(30px,3.6vw,48px)] font-[650] leading-[1.04] tracking-[-0.04em]">
          Put the whole semester
          <br />
          <span className="text-sub">on one board.</span>
        </h2>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button asChild size="lg" className="h-12 px-6 text-[15px]">
            <Link to={signedIn ? DASHBOARD : '/signin'}>{signedIn ? 'Open dashboard' : 'Sign in'}</Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="h-12 px-6 text-[15px]">
            <a href={GITHUB_URL} target="_blank" rel="noreferrer">
              View on GitHub
            </a>
          </Button>
        </div>
      </Reveal>
      <AsciiLogo className="h-[118vw] w-full text-ink opacity-30 sm:h-[17vw] dark:text-ink-muted dark:opacity-55" />
    </section>
  );
}

export function Landing() {
  return (
    <PublicLayout wide nav="sections">
      <div className="landing">
        <Hero />
        <DemoShowcase />
        <section className="px-5 pt-24 sm:pt-28">
          <SectionHead id="how" eyebrow="How it works" title="Six sources in. One board out." sub="Everything you already use, gathered into one copy that is yours, and handed back wherever you want it." />
          <Reveal className="mx-auto mt-10 max-w-6xl">
            <Hub />
          </Reveal>
        </section>
        <Agents />
        <section className="px-5 pb-8">
          <SectionHead id="features" eyebrow="On the board" title="Everything a semester throws at you." />
          <div className="mx-auto mt-14 max-w-6xl">
            <Bento />
          </div>
        </section>
        <RunIt />
        <Closing />
      </div>
    </PublicLayout>
  );
}
