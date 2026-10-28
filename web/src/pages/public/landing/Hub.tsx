import { useEffect, useState, type ComponentType } from 'react';
import { Briefcase, CalendarDays, ClipboardCheck, FolderSync, GraduationCap, LayoutDashboard, ListChecks, ListTodo, Send, SquareTerminal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TickArc } from '@/widgets/instruments';
import { reducedMotion, useInView } from './motion';

/**
 * How it works, as a pipeline in three panels: the sources going in, what collected does with them, and where it all
 * comes back out. Tick rails between the panels carry a lit band left to right (top to bottom on phones), and the
 * middle panel lights its four steps in turn. Compact enough to sit on one screen with its heading.
 */

type Icon = ComponentType<{ className?: string; strokeWidth?: number }>;

const SOURCES: [string, Icon][] = [
  ['Canvas', GraduationCap],
  ['Gradescope', ClipboardCheck],
  ['Google Calendar', CalendarDays],
  ['Todoist', ListChecks],
  ['Google Tasks', ListTodo],
  ['Job feed', Briefcase],
];

const OUTPUTS: [string, string, Icon][] = [
  ['Your board', 'Every widget, one grid', LayoutDashboard],
  ['To-do push', 'Homework into Todoist or Google Tasks', Send],
  ['Laptop folders', 'Course files, sorted by your rules', FolderSync],
  ['CLI and agents', 'Any shell, any agent harness', SquareTerminal],
];

const STEPS: [string, string][] = [
  ['Pull', 'Every account, on a timer, into a local copy.'],
  ['Match', 'A Canvas homework and its Gradescope submission become one row.'],
  ['Layer', 'Your done, hidden and notes sit on top; a re-sync never wipes them.'],
  ['Serve', 'Everything reads from the copy, so it is fast.'],
];

function Panel({ label, caption, children, className }: { label: string; caption: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('surface rounded-[26px] p-5', className)}>
      <div className="flex items-baseline justify-between gap-3 px-0.5">
        <span className="label">{label}</span>
        <span className="text-[12px] text-ter">{caption}</span>
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

/** A rail of ticks with a lit band travelling along it. */
function Rail() {
  return (
    <div className="grid place-items-center" aria-hidden>
      <span className="flow flow-x hidden lg:block" />
      <span className="flow flow-y lg:hidden" />
    </div>
  );
}

function Core() {
  const [ref, seen] = useInView<HTMLDivElement>();
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!seen || reducedMotion()) return;
    const id = window.setInterval(() => setStep((s) => (s + 1) % STEPS.length), 1800);
    return () => window.clearInterval(id);
  }, [seen]);
  return (
    <div ref={ref} className="surface relative rounded-[26px] p-5 shadow-[var(--shadow-lift)]">
      <div className="flex items-center gap-3 px-0.5">
        <div className="relative grid size-12 shrink-0 place-items-center">
          <svg viewBox="0 0 48 48" className="hub-spin absolute inset-0" aria-hidden>
            <TickArc cx={24} cy={24} r={23} len={4} value={0.7} color="var(--brand)" ticks={36} width={1.5} />
          </svg>
          <span aria-hidden className="grid size-8 place-items-center rounded-full bg-ink text-[13px] font-semibold text-ground">c</span>
        </div>
        <div className="leading-tight">
          <div className="text-[17px] font-semibold tracking-[-0.01em]">collected</div>
          <div className="text-[12px] text-sub">One SQLite file you own</div>
        </div>
      </div>
      <ol className="mt-4 space-y-1">
        {STEPS.map(([name, body], i) => {
          const on = i === step;
          return (
            <li key={name} className={cn('flex gap-3 rounded-[14px] px-2.5 py-2 transition-colors duration-300', on ? 'bg-brand-soft' : 'bg-transparent')}>
              <span className={cn('mt-px grid size-6 shrink-0 place-items-center rounded-full text-[11.5px] font-semibold transition-colors duration-300', on ? 'bg-brand text-on-brand' : 'bg-well text-sub')}>{i + 1}</span>
              <span className="min-w-0">
                <span className={cn('block text-[13.5px] font-semibold transition-colors duration-300', on ? 'text-brand-ink' : 'text-ink')}>{name}</span>
                <span className="block text-[12.5px] leading-snug text-sub">{body}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function Hub() {
  return (
    <div className="grid items-center gap-3 lg:grid-cols-[minmax(0,1fr)_56px_minmax(0,1.1fr)_56px_minmax(0,1fr)] lg:gap-0">
      <Panel label="In" caption="Six sources">
        <ul className="grid grid-cols-2 gap-2">
          {SOURCES.map(([name, Icon]) => (
            <li key={name} className="flex min-w-0 items-center gap-2.5 rounded-[14px] bg-well p-2.5">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface shadow-[var(--shadow-card)]">
                <Icon className="size-4" strokeWidth={1.7} />
              </span>
              <span className="min-w-0 text-[13px] font-semibold leading-tight tracking-[-0.005em]">{name}</span>
            </li>
          ))}
        </ul>
      </Panel>
      <Rail />
      <Core />
      <Rail />
      <Panel label="Out" caption="Four ways back">
        <ul className="space-y-2">
          {OUTPUTS.map(([name, note, Icon]) => (
            <li key={name} className="flex min-w-0 items-center gap-2.5 rounded-[14px] bg-well p-2.5">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-soft text-brand-ink">
                <Icon className="size-4" strokeWidth={1.7} />
              </span>
              <span className="min-w-0 leading-tight">
                <span className="block truncate text-[13px] font-semibold">{name}</span>
                <span className="block truncate text-[11.5px] text-sub">{note}</span>
              </span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
