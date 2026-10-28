import { useEffect, useState, type ComponentType } from 'react';
import { Briefcase, CalendarDays, ClipboardCheck, FolderSync, GraduationCap, LayoutDashboard, ListChecks, ListTodo, Send, SquareTerminal } from 'lucide-react';
import { TickArc } from '@/widgets/instruments';
import { cn } from '@/lib/utils';
import { reducedMotion, useInView } from './motion';

/**
 * Where the data comes from and where it goes: six sources flow into collected, which feeds the board, the to-do
 * apps, folders on your laptop and the CLI. Accent particles travel the wires. Wide screens lay it out left to right;
 * phones stack it top to bottom. Node positions live in one coordinate box so the wires and the cards line up.
 */

type Icon = ComponentType<{ className?: string; strokeWidth?: number }>;
interface Node {
  name: string;
  note: string;
  icon: Icon;
}

const SOURCES: Node[] = [
  { name: 'Canvas', note: 'Assignments, grades, files', icon: GraduationCap },
  { name: 'Gradescope', note: 'Submissions and scores', icon: ClipboardCheck },
  { name: 'Google Calendar', note: 'Classes and events', icon: CalendarDays },
  { name: 'Todoist', note: 'Tasks and projects', icon: ListChecks },
  { name: 'Google Tasks', note: 'Tasks and lists', icon: ListTodo },
  { name: 'Job feed', note: 'Internship postings', icon: Briefcase },
];

const OUTPUTS: Node[] = [
  { name: 'Your board', note: 'Every widget, one grid', icon: LayoutDashboard },
  { name: 'To-do push', note: 'Into your to-do app', icon: Send },
  { name: 'Laptop folders', note: 'Course files, sorted', icon: FolderSync },
  { name: 'CLI and agents', note: 'Any shell, any harness', icon: SquareTerminal },
];

interface Geometry {
  w: number;
  h: number;
  hub: [number, number];
  hubR: number;
  src: [number, number][];
  out: [number, number][];
  /** Wire from a source node to the hub, and from the hub to an output node. */
  inPath(p: [number, number]): string;
  outPath(p: [number, number]): string;
}

const WIDE: Geometry = {
  w: 1120,
  h: 600,
  hub: [560, 300],
  hubR: 86,
  src: [70, 162, 254, 346, 438, 530].map((y) => [130, y] as [number, number]),
  out: [120, 240, 360, 480].map((y) => [985, y] as [number, number]),
  inPath: ([x, y]) => `M ${x + 112} ${y} C ${x + 260} ${y}, ${560 - 200} ${300}, ${560 - 86} ${300}`,
  outPath: ([x, y]) => `M ${560 + 86} ${300} C ${560 + 200} ${300}, ${x - 250} ${y}, ${x - 118} ${y}`,
};

const TALL: Geometry = {
  w: 400,
  h: 1010,
  hub: [200, 470],
  hubR: 74,
  src: [
    [104, 50],
    [296, 50],
    [104, 140],
    [296, 140],
    [104, 230],
    [296, 230],
  ],
  out: [
    [104, 730],
    [296, 730],
    [104, 830],
    [296, 830],
  ],
  inPath: ([x, y]) => `M ${x} ${y + 30} C ${x} ${y + 150}, 200 ${470 - 160}, 200 ${470 - 74}`,
  outPath: ([x, y]) => `M 200 ${470 + 74} C 200 ${470 + 150}, ${x} ${y - 130}, ${x} ${y - 32}`,
};

function NodeCard({ node, at, g, side, index }: { node: Node; at: [number, number]; g: Geometry; side: 'in' | 'out'; index: number }) {
  const Icon = node.icon;
  return (
    <div
      className={cn('hub-node absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-2.5 rounded-[18px] bg-surface p-2 pr-3 shadow-[var(--shadow-card)]', g === WIDE ? 'w-[214px]' : 'w-[46%]')}
      style={{ left: `${(at[0] / g.w) * 100}%`, top: `${(at[1] / g.h) * 100}%`, transitionDelay: `${(side === 'in' ? 0 : 520) + index * 70}ms` }}
    >
      <span className={cn('grid size-9 shrink-0 place-items-center rounded-[12px]', side === 'in' ? 'bg-well text-ink' : 'bg-brand-soft text-brand-ink')}>
        <Icon className="size-[18px]" strokeWidth={1.7} />
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-[13.5px] font-semibold tracking-[-0.01em]">{node.name}</span>
        <span className="block truncate text-[11.5px] text-sub">{node.note}</span>
      </span>
    </div>
  );
}

function Wires({ g, live }: { g: Geometry; live: boolean }) {
  const ins = g.src.map((p) => g.inPath(p));
  const outs = g.out.map((p) => g.outPath(p));
  const dot = (d: string, begin: number, key: string, dur = 2.6) => (
    <g key={key}>
      <circle r="3.4" fill="var(--brand)">
        <animateMotion dur={`${dur}s`} begin={`${begin}s`} repeatCount="indefinite" path={d} keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines=".45 0 .35 1" />
      </circle>
      <circle r="6" fill="var(--brand)" opacity="0.18">
        <animateMotion dur={`${dur}s`} begin={`${begin + 0.04}s`} repeatCount="indefinite" path={d} keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines=".45 0 .35 1" />
      </circle>
    </g>
  );
  return (
    <svg viewBox={`0 0 ${g.w} ${g.h}`} className="absolute inset-0 size-full" aria-hidden fill="none">
      {[...ins, ...outs].map((d, i) => (
        <path key={i} d={d} stroke="var(--line-mid)" strokeWidth="1.5" strokeLinecap="round" />
      ))}
      {live && ins.map((d, i) => [dot(d, i * 0.43, `a${i}`), dot(d, i * 0.43 + 1.3, `b${i}`)])}
      {live && outs.map((d, i) => dot(d, 0.9 + i * 0.5, `o${i}`, 2.2))}
    </svg>
  );
}

function HubCore({ g }: { g: Geometry }) {
  const d = g.hubR * 2;
  return (
    <div className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${(g.hub[0] / g.w) * 100}%`, top: `${(g.hub[1] / g.h) * 100}%`, width: d, height: d }}>
      <div className="hub-core absolute inset-0 rounded-full bg-surface shadow-[var(--shadow-lift)]" />
      <svg viewBox="0 0 100 100" className="hub-spin absolute inset-0 size-full" aria-hidden>
        <TickArc cx={50} cy={50} r={47} len={5} value={0.72} color="var(--brand)" ticks={60} width={1.4} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <span aria-hidden className="mx-auto grid size-9 place-items-center rounded-full bg-ink text-[15px] font-semibold text-ground">c</span>
          <span className="mt-1.5 block text-[15px] font-semibold tracking-[-0.01em]">collected</span>
          <span className="block text-[10.5px] text-sub">one SQLite file</span>
        </div>
      </div>
    </div>
  );
}

function Diagram({ g, className, live }: { g: Geometry; className?: string; live: boolean }) {
  return (
    <div className={cn('relative w-full', className)} style={{ aspectRatio: `${g.w} / ${g.h}` }}>
      <Wires g={g} live={live} />
      {SOURCES.map((n, i) => (
        <NodeCard key={n.name} node={n} at={g.src[i]!} g={g} side="in" index={i} />
      ))}
      <HubCore g={g} />
      {OUTPUTS.map((n, i) => (
        <NodeCard key={n.name} node={n} at={g.out[i]!} g={g} side="out" index={i} />
      ))}
    </div>
  );
}

export function Hub() {
  const [ref, seen] = useInView<HTMLDivElement>('0px 0px -10% 0px');
  const [live, setLive] = useState(false);
  useEffect(() => setLive(seen && !reducedMotion()), [seen]);
  return (
    <div ref={ref} className={cn('hub', seen && 'hub-in')}>
      <Diagram g={WIDE} className="hidden lg:block" live={live} />
      <Diagram g={TALL} className="mx-auto max-w-[460px] lg:hidden" live={live} />
    </div>
  );
}
