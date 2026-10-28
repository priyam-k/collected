import { useEffect, useState, type ReactNode } from 'react';
import { Check, FileText, Folder } from 'lucide-react';
import { useLiquid } from '@/lib/liquid';
import { ACCENTS, useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { Meter, TickArc } from '@/widgets/instruments';
import { Reveal, reducedMotion, useInView } from './motion';

/** The feature grid: each card shows the thing working, in small, instead of describing it. */

function Card({ title, body, children, className, delay = 0 }: { title: string; body: string; children?: ReactNode; className?: string; delay?: number }) {
  return (
    <Reveal delay={delay} className={cn('surface flex flex-col overflow-hidden rounded-[26px] p-6 sm:p-7', className)}>
      <h3 className="text-[19px] font-semibold tracking-[-0.015em]">{title}</h3>
      <p className="mt-1.5 max-w-md text-[14.5px] leading-relaxed text-sub">{body}</p>
      {children && <div className="mt-6 flex min-h-0 flex-1 flex-col">{children}</div>}
    </Reveal>
  );
}

const TABS = ['Overview', 'Assignments', 'Grades', 'Dates', 'Files'];

function CoursePaneMini() {
  const [tab, setTab] = useState('Overview');
  const liquid = useLiquid();
  const rows: [string, string, boolean][] = [
    ['Problem set 6: dynamic programming', 'Tomorrow 11:59 PM', false],
    ['Problem set 7: network flow', 'Next week', false],
    ['Problem set 5: greedy algorithms', '46 / 50', true],
  ];
  return (
    <div className="rounded-[20px] bg-well p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <span className="size-2.5 rounded-full bg-[#5b6ee1]" />
        <span className="text-[22px] font-[620] tracking-[-0.02em]">CS351</span>
        <span className="text-[13px] text-sub">Algorithms</span>
      </div>
      <div className="seg mt-3.5 flex w-full overflow-x-auto [scrollbar-width:none]" ref={liquid}>
        {TABS.map((t) => (
          <button key={t} className={cn('!flex-none', tab === t && 'seg-on')} aria-pressed={tab === t} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-[auto_1fr]">
        <div className="flex items-center gap-3.5 rounded-[16px] bg-surface p-3.5 pr-5">
          <div className="relative grid size-16 place-items-center">
            <svg viewBox="0 0 64 64" className="absolute inset-0" aria-hidden>
              <TickArc cx={32} cy={32} r={31} len={6} value={0.92} color="#5b6ee1" ticks={48} width={1.8} />
            </svg>
            <span className="text-[17px] font-semibold">92<span className="text-[10px] text-sub">%</span></span>
          </div>
          <div>
            <div className="label">Grade</div>
            <div className="mt-0.5 text-[13px]">By points · 1 of 3 graded</div>
          </div>
        </div>
        <ul className="rounded-[16px] bg-surface p-1.5">
          {rows.map(([t, when, done]) => (
            <li key={t} className="flex items-center gap-2.5 rounded-[12px] px-2.5 py-2 text-[13px]">
              <span className={cn('grid size-4 shrink-0 place-items-center rounded-full border-[1.5px]', done ? 'border-positive bg-positive text-surface' : 'border-[#5b6ee1]')}>{done && <Check className="size-2.5" strokeWidth={3.5} />}</span>
              <span className={cn('min-w-0 flex-1 truncate', done && 'text-sub')}>{t}</span>
              <span className="shrink-0 text-[12px] text-sub">{when}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-[16px] bg-surface p-3.5">
          <div className="label">Schedule</div>
          <ul className="mt-2 space-y-1.5 text-[13px]">
            <li className="flex justify-between gap-3"><span>Lecture</span><span className="text-sub">Mon, Wed, Fri 10:00 · Sci 120</span></li>
            <li className="flex justify-between gap-3"><span>Discussion</span><span className="text-sub">Thu 2:00 · Eng 210</span></li>
          </ul>
        </div>
        <div className="rounded-[16px] bg-surface p-3.5">
          <div className="label">Coming up</div>
          <ul className="mt-2 space-y-1.5 text-[13px]">
            <li className="flex justify-between gap-3"><span>Midterm 2</span><span className="font-medium text-caution">in 10 days</span></li>
            <li className="flex justify-between gap-3"><span className="truncate">Office hours moved to Thursday</span><span className="shrink-0 text-sub">new</span></li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function PushMini() {
  const [ref, seen] = useInView<HTMLDivElement>();
  const items: [string, string, string][] = [
    ['Lab report 5: RC circuits', 'PHYS260', '#2f9e8f'],
    ['Homework 8: eigenvalues', 'MATH340', '#d1883a'],
    ['Reading response: ch. 4', 'LING200', '#c4566a'],
  ];
  return (
    <div ref={ref} className="space-y-2">
      {items.map(([t, code, color], i) => (
        <div key={t} className={cn('push-row flex items-center gap-3 rounded-[14px] bg-well px-3.5 py-2.5', seen && 'push-in')} style={{ '--d': `${i * 520}ms` } as React.CSSProperties}>
          <span className="push-check grid size-[18px] shrink-0 place-items-center rounded-full border-[1.5px]" style={{ borderColor: color, '--c': color } as React.CSSProperties}>
            <Check className="size-3 text-surface" strokeWidth={3.5} />
          </span>
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{t}</span>
          <span className="text-[11.5px] font-medium" style={{ color }}>{code}</span>
        </div>
      ))}
      <p className="pt-1 text-[12px] text-sub">Submitted on Canvas → closed in Todoist.</p>
    </div>
  );
}

function RingsMini() {
  const [ref, seen] = useInView<HTMLDivElement>();
  const [t, setT] = useState(() => (reducedMotion() ? 1 : 0));
  useEffect(() => {
    if (!seen || reducedMotion()) return;
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / 1400);
      setT(1 - Math.pow(1 - p, 3));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [seen]);
  const rings: [string, number, string][] = [
    ['CS351', 0.67, '#5b6ee1'],
    ['MATH340', 0.5, '#d1883a'],
    ['STAT400', 0.8, '#8a6cc8'],
  ];
  return (
    <div ref={ref} className="flex items-center gap-5">
      <svg viewBox="0 0 100 100" className="size-32 shrink-0" aria-hidden>
        {rings.map(([code, v, c], i) => (
          <TickArc key={code} cx={50} cy={50} r={48 - i * 10} len={6} value={v * t} color={c} width={1.7} />
        ))}
        <text x="50" y="50" textAnchor="middle" dominantBaseline="central" fill="var(--ink)" fontSize="15" fontWeight={560}>
          {Math.round(66 * t)}%
        </text>
      </svg>
      <ul className="min-w-0 flex-1 space-y-3 text-[13px]">
        {rings.map(([code, v, c]) => (
          <li key={code}>
            <span className="flex items-center gap-2">
              <span className="size-2 rounded-full" style={{ background: c }} />
              <span className="font-medium">{code}</span>
            </span>
            <Meter className="mt-1.5 w-full" value={v * 100 * t} color={c} height={9} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ExamsMini() {
  const rows: [string, string, string, string, boolean][] = [
    ['2', 'days', 'STAT400', 'Quiz 4', true],
    ['5', 'days', 'MATH340', 'Midterm 2', false],
    ['10', 'days', 'CS351', 'Midterm 2', false],
  ];
  return (
    <ul className="space-y-2">
      {rows.map(([n, unit, code, title, urgent]) => (
        <li key={code + title} className="flex items-center gap-3">
          <span className={cn('grid w-[52px] shrink-0 place-items-center rounded-[14px] py-2 leading-none', urgent ? 'bg-[color-mix(in_srgb,var(--caution)_12%,var(--well))] text-caution' : 'bg-well')}>
            <span className="text-[20px] font-[560]">{n}</span>
            <span className="mt-1 text-[10px] font-medium opacity-75">{unit}</span>
          </span>
          <span className="min-w-0">
            <span className="label !text-[10px]">{code}</span>
            <span className="block truncate text-[13.5px] font-medium">{title}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function FilesMini() {
  const tree: [number, string, boolean][] = [
    [0, 'CS351', true],
    [1, 'Lectures', true],
    [2, 'lecture14-dp.pdf', false],
    [2, 'lecture15-flow.pdf', false],
    [1, 'Assignments', true],
    [2, 'pset6.pdf', false],
    [1, 'Admin', true],
    [2, 'syllabus.pdf', false],
  ];
  return (
    <ul className="rounded-[16px] bg-well p-3 font-mono text-[12px]">
      {tree.map(([depth, name, folder], i) => (
        <li key={i} className="flex items-center gap-1.5 py-[3px]" style={{ paddingLeft: depth * 16 }}>
          {folder ? <Folder className="size-3.5 text-brand-ink" strokeWidth={1.8} /> : <FileText className="size-3.5 text-sub" strokeWidth={1.8} />}
          <span className={folder ? 'font-medium text-ink' : 'text-sub'}>{name}</span>
        </li>
      ))}
    </ul>
  );
}

function ThemeMini() {
  const { theme, setTheme, accent, setAccent } = useTheme();
  const liquid = useLiquid();
  return (
    <div className="space-y-4">
      <div className="seg flex w-full" role="group" aria-label="Theme" ref={liquid}>
        {(['system', 'light', 'dark'] as const).map((t) => (
          <button key={t} className={cn('flex-1 capitalize', theme === t && 'seg-on')} aria-pressed={theme === t} onClick={() => setTheme(t)}>
            {t === 'system' ? 'Auto' : t}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2" role="group" aria-label="Accent">
        {ACCENTS.map((a) => (
          <button
            key={a.id}
            aria-label={`${a.label} accent`}
            aria-pressed={accent === a.id}
            onClick={() => setAccent(a.id)}
            className={cn('grid size-11 place-items-center rounded-full transition-[box-shadow] duration-150', accent === a.id ? 'shadow-[inset_0_0_0_2px_var(--ink)]' : 'hover:shadow-[inset_0_0_0_2px_var(--line-mid)]')}
          >
            <span data-accent-swatch={a.id} className="grid size-8 place-items-center rounded-full">
              {accent === a.id && <Check className="size-4" strokeWidth={2.4} />}
            </span>
          </button>
        ))}
      </div>
      <p className="text-[12px] text-sub">Try it: this whole page follows.</p>
    </div>
  );
}

function TrackerMini() {
  const cols: [string, string, [string, string][]][] = [
    ['Saved', 'text-caution', [['Kestrel AI', 'ML Research'], ['Brightline', 'Infrastructure']]],
    ['Applied', 'text-ink', [['Tessellate', 'Frontend'], ['Waypoint', 'Platform']]],
    ['Screen', 'text-brand-ink', [['Fieldnote', 'Recruiter call tomorrow']]],
    ['Interviewing', 'text-brand-ink', [['Quarry Capital', 'Technical in 4 days']]],
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {cols.map(([stage, tone, jobs]) => (
        <div key={stage}>
          <div className={cn('label mb-2 px-1', tone)}>
            {stage} <span className="text-ter">{jobs.length}</span>
          </div>
          <div className="space-y-1.5">
            {jobs.map(([co, note]) => (
              <div key={co} className="rounded-[14px] bg-well p-3">
                <div className="truncate text-[13px] font-semibold">{co}</div>
                <div className="truncate text-[12px] text-sub">{note}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function Bento() {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      <Card className="md:col-span-2 lg:row-span-2" title="A pane for every course" body="Assignments from Canvas and Gradescope matched into one row, a running grade, exam dates, announcements and files, with your notes on top.">
        <CoursePaneMini />
      </Card>
      <Card delay={80} title="Progress you can read" body="What was due this week, done or not, one ring of ticks per course.">
        <RingsMini />
      </Card>
      <Card delay={140} title="Exams, counted down" body="Hand-entered dates and anything titled like a quiz or a midterm, in one countdown.">
        <ExamsMini />
      </Card>
      <Card title="Homework in your to-do app" body="Assignments push into Todoist or Google Tasks and close themselves when the source says submitted.">
        <PushMini />
      </Card>
      <Card delay={80} title="Files land in folders" body="Course files sync to folders you name on your laptop, sorted by rules you set.">
        <FilesMini />
      </Card>
      <Card delay={140} title="Make it yours" body="Light or dark, four accents, and a grid you arrange and resize however you like.">
        <ThemeMini />
      </Card>
      <Card className="md:col-span-2 lg:col-span-3" title="An internship tracker, too" body="A feed of new postings that match your filter, and every application by stage, with what to do next.">
        <TrackerMini />
      </Card>
    </div>
  );
}
