import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Trash2 } from 'lucide-react';
import type { CourseSchedule, Meeting } from '@collected/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

type Kind = keyof CourseSchedule;
const KINDS: { key: Kind; label: string; tone: string }[] = [
  { key: 'lecture', label: 'Lecture', tone: 'bg-sky-500/25 border-sky-500/60 text-sky-900 dark:text-sky-100' },
  { key: 'discussion', label: 'Discussion', tone: 'bg-violet-500/25 border-violet-500/60 text-violet-900 dark:text-violet-100' },
  { key: 'office_hours', label: 'Office hours', tone: 'bg-amber-500/25 border-amber-500/60 text-amber-900 dark:text-amber-100' },
];
const DAYS: Meeting['day'][] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABEL: Record<Meeting['day'], string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
const HOUR_START = 7;
const HOUR_END = 22; // exclusive
const SLOT_MIN = 15;
const SLOT_PX = 9;
const SLOTS = ((HOUR_END - HOUR_START) * 60) / SLOT_MIN;

const toMin = (t: string): number => {
  const [h, m] = t.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
const toHHMM = (min: number): string => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const fmt = (t: string): string => {
  const m = toMin(t);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h % 12 || 12}${mm ? `:${String(mm).padStart(2, '0')}` : ''}${h >= 12 ? 'p' : 'a'}`;
};

interface Block {
  kind: Kind;
  index: number;
  meeting: Meeting;
}

/**
 * Drag over a day column to add a meeting of the selected kind; click a block to adjust times, location, kind,
 * or remove it. 15-minute drag snap; the time fields accept any minute.
 */
export function ScheduleEditor({ value, onChange }: { value: CourseSchedule; onChange(next: CourseSchedule): void }) {
  const [kind, setKind] = useState<Kind>('lecture');
  const [drag, setDrag] = useState<{ day: Meeting['day']; from: number; to: number } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const blocks = useMemo<Block[]>(() => {
    const out: Block[] = [];
    for (const k of KINDS) (value[k.key] ?? []).forEach((m, i) => out.push({ kind: k.key, index: i, meeting: m }));
    return out;
  }, [value]);

  const update = (b: Block, patch: Partial<Meeting> | null, newKind?: Kind) => {
    const next: CourseSchedule = { ...value, [b.kind]: (value[b.kind] ?? []).filter((_, i) => i !== b.index) };
    if (patch !== null) {
      const meeting = { ...b.meeting, ...patch };
      const target = newKind ?? b.kind;
      next[target] = [...(next[target] ?? []), meeting].sort((a, c) => DAYS.indexOf(a.day) - DAYS.indexOf(c.day) || toMin(a.start) - toMin(c.start));
    }
    for (const k of KINDS) if (!next[k.key]?.length) delete next[k.key];
    onChange(next);
  };

  const slotAt = (e: ReactPointerEvent): { day: Meeting['day']; slot: number } | null => {
    const el = gridRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    if (x < 0 || y < 0 || x > r.width || y > r.height) return null;
    const day = DAYS[Math.min(6, Math.floor((x / r.width) * 7))]!;
    const slot = Math.max(0, Math.min(SLOTS - 1, Math.floor(y / SLOT_PX)));
    return { day, slot };
  };

  const onDown = (e: ReactPointerEvent) => {
    if ((e.target as HTMLElement).closest('[data-block]')) return;
    const hit = slotAt(e);
    if (!hit) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ day: hit.day, from: hit.slot, to: hit.slot });
  };
  const onMove = (e: ReactPointerEvent) => {
    if (!drag) return;
    const hit = slotAt(e);
    if (hit) setDrag({ ...drag, to: hit.slot });
  };
  const onUp = () => {
    if (!drag) return;
    const a = Math.min(drag.from, drag.to);
    const b = Math.max(drag.from, drag.to) + 1;
    const start = toHHMM(HOUR_START * 60 + a * SLOT_MIN);
    const end = toHHMM(HOUR_START * 60 + b * SLOT_MIN);
    onChange({ ...value, [kind]: [...(value[kind] ?? []), { day: drag.day, start, end }] });
    setDrag(null);
  };

  const top = (t: string) => ((toMin(t) - HOUR_START * 60) / SLOT_MIN) * SLOT_PX;
  const height = (m: Meeting) => Math.max(SLOT_PX, ((toMin(m.end) - toMin(m.start)) / SLOT_MIN) * SLOT_PX);
  const hours = Array.from({ length: HOUR_END - HOUR_START }, (_, i) => HOUR_START + i);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1 text-xs">
        <span className="text-muted-foreground">Drag on a day to add:</span>
        {KINDS.map((k) => (
          <button key={k.key} type="button" onClick={() => setKind(k.key)} className={cn('rounded-md border px-2 py-0.5', kind === k.key ? k.tone + ' font-medium' : 'text-muted-foreground hover:bg-secondary/60')}>
            {k.label}
          </button>
        ))}
        <span className="ml-auto text-muted-foreground">Click a block to edit.</span>
      </div>
      <div className="select-none overflow-hidden rounded-md border text-[10px]">
        <div className="grid grid-cols-[2.5rem_repeat(7,minmax(0,1fr))] border-b bg-muted/40">
          <div />
          {DAYS.map((d) => <div key={d} className="border-l px-1 py-1 text-center font-medium text-muted-foreground">{DAY_LABEL[d]}</div>)}
        </div>
        <div className="grid grid-cols-[2.5rem_repeat(7,minmax(0,1fr))]">
          <div className="relative" style={{ height: SLOTS * SLOT_PX }}>
            {hours.map((h) => (
              <div key={h} className="absolute right-1 -translate-y-1/2 tabular-nums text-muted-foreground" style={{ top: (h - HOUR_START) * 4 * SLOT_PX }}>
                {h % 12 || 12}{h >= 12 ? 'p' : 'a'}
              </div>
            ))}
          </div>
          <div ref={gridRef} className="relative col-span-7 grid cursor-crosshair grid-cols-7 touch-none" style={{ height: SLOTS * SLOT_PX }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => setDrag(null)}>
            {DAYS.map((d) => (
              <div key={d} className="relative border-l">
                {hours.map((h) => <div key={h} className="absolute inset-x-0 border-t border-border/60" style={{ top: (h - HOUR_START) * 4 * SLOT_PX }} />)}
              </div>
            ))}
            {drag && (
              <div
                className={cn('pointer-events-none absolute rounded border', KINDS.find((k) => k.key === kind)!.tone)}
                style={{ left: `${(DAYS.indexOf(drag.day) / 7) * 100}%`, width: `${100 / 7}%`, top: Math.min(drag.from, drag.to) * SLOT_PX, height: (Math.abs(drag.to - drag.from) + 1) * SLOT_PX }}
              />
            )}
            {blocks.map((b) => (
              <BlockEditor key={`${b.kind}-${b.index}-${b.meeting.day}-${b.meeting.start}`} block={b} onChange={update}>
                <button
                  type="button"
                  data-block
                  className={cn('absolute overflow-hidden rounded border px-1 text-left leading-tight hover:brightness-110', KINDS.find((k) => k.key === b.kind)!.tone)}
                  style={{ left: `calc(${(DAYS.indexOf(b.meeting.day) / 7) * 100}% + 2px)`, width: `calc(${100 / 7}% - 4px)`, top: top(b.meeting.start), height: height(b.meeting) }}
                  title={`${KINDS.find((k) => k.key === b.kind)!.label} ${fmt(b.meeting.start)}–${fmt(b.meeting.end)}${b.meeting.location ? ` · ${b.meeting.location}` : ''}`}
                >
                  <div className="truncate font-medium">{fmt(b.meeting.start)}–{fmt(b.meeting.end)}</div>
                  {height(b.meeting) > 2 * SLOT_PX && <div className="truncate">{b.meeting.location ?? KINDS.find((k) => k.key === b.kind)!.label}</div>}
                </button>
              </BlockEditor>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function BlockEditor({ block, onChange, children }: { block: Block; onChange(b: Block, patch: Partial<Meeting> | null, newKind?: Kind): void; children: React.ReactNode }) {
  const m = block.meeting;
  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-64 space-y-2 p-3 text-sm" onOpenAutoFocus={(e) => e.preventDefault()}>
        <div className="flex gap-1">
          {KINDS.map((k) => (
            <button key={k.key} type="button" onClick={() => onChange(block, {}, k.key)} className={cn('rounded-md border px-1.5 py-0.5 text-xs', block.kind === k.key ? k.tone + ' font-medium' : 'text-muted-foreground hover:bg-secondary/60')}>
              {k.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1.5 text-xs">
          <span className="text-muted-foreground">Day</span>
          <select className="h-7 rounded-md border bg-background px-1.5" value={m.day} onChange={(e) => onChange(block, { day: e.target.value as Meeting['day'] })}>
            {DAYS.map((d) => <option key={d} value={d}>{DAY_LABEL[d]}</option>)}
          </select>
          <span className="text-muted-foreground">Start</span>
          <Input type="time" className="h-7 text-xs" value={m.start} onChange={(e) => e.target.value && onChange(block, { start: e.target.value })} />
          <span className="text-muted-foreground">End</span>
          <Input type="time" className="h-7 text-xs" value={m.end} onChange={(e) => e.target.value && onChange(block, { end: e.target.value })} />
          <span className="text-muted-foreground">Where</span>
          <Input className="h-7 text-xs" placeholder="IRB 0324" value={m.location ?? ''} onChange={(e) => onChange(block, { location: e.target.value || undefined })} />
        </div>
        <Button type="button" size="xs" variant="ghost" className="text-destructive" onClick={() => onChange(block, null)}>
          <Trash2 className="size-3" /> Remove
        </Button>
      </PopoverContent>
    </Popover>
  );
}
