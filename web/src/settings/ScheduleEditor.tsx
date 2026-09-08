import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { MEETING_KINDS, meetingLabel, type CourseSchedule, type Meeting } from '@collected/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

const TONES: Record<string, string> = {
  lecture: 'bg-sky-500/25 border-sky-500/60 text-sky-900 dark:text-sky-100',
  discussion: 'bg-violet-500/25 border-violet-500/60 text-violet-900 dark:text-violet-100',
  lab: 'bg-emerald-500/25 border-emerald-500/60 text-emerald-900 dark:text-emerald-100',
  office_hours: 'bg-amber-500/25 border-amber-500/60 text-amber-900 dark:text-amber-100',
};
const EXTRA_TONES = [
  'bg-rose-500/25 border-rose-500/60 text-rose-900 dark:text-rose-100',
  'bg-teal-500/25 border-teal-500/60 text-teal-900 dark:text-teal-100',
  'bg-fuchsia-500/25 border-fuchsia-500/60 text-fuchsia-900 dark:text-fuchsia-100',
  'bg-lime-500/25 border-lime-500/60 text-lime-900 dark:text-lime-100',
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
/** "Lab section" → "lab_section" */
const slug = (s: string): string => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^[^a-z]+/, '');

interface Block {
  kind: string;
  index: number;
  meeting: Meeting;
}

/**
 * Drag over a day column to add a meeting of the selected kind; click a block to adjust times, location, kind,
 * or remove it. 15-minute drag snap; the time fields accept any minute. Kinds are open: the built-in four plus
 * whatever the schedule already carries or you add here.
 */
export function ScheduleEditor({ value, onChange }: { value: CourseSchedule; onChange(next: CourseSchedule): void }) {
  const [extraKinds, setExtraKinds] = useState<string[]>([]);
  const kinds = useMemo(() => {
    const out: string[] = [...MEETING_KINDS];
    for (const k of [...Object.keys(value), ...extraKinds]) if (!out.includes(k)) out.push(k);
    return out;
  }, [value, extraKinds]);
  const toneFor = (kind: string): string => TONES[kind] ?? EXTRA_TONES[Math.max(0, kinds.indexOf(kind) - MEETING_KINDS.length) % EXTRA_TONES.length]!;
  const [kind, setKind] = useState<string>('lecture');
  const [newKind, setNewKind] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ day: Meeting['day']; from: number; to: number; moved: boolean } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const blocks = useMemo<Block[]>(() => {
    const out: Block[] = [];
    for (const k of kinds) (value[k] ?? []).forEach((m, i) => out.push({ kind: k, index: i, meeting: m }));
    return out;
  }, [value, kinds]);

  const update = (b: Block, patch: Partial<Meeting> | null, newKindKey?: string) => {
    const next: CourseSchedule = { ...value, [b.kind]: (value[b.kind] ?? []).filter((_, i) => i !== b.index) };
    if (patch !== null) {
      const meeting = { ...b.meeting, ...patch };
      const target = newKindKey ?? b.kind;
      next[target] = [...(next[target] ?? []), meeting].sort((a, c) => DAYS.indexOf(a.day) - DAYS.indexOf(c.day) || toMin(a.start) - toMin(c.start));
    }
    for (const k of Object.keys(next)) if (!next[k]?.length) delete next[k];
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
    // React bubbles events from portals (the block popover) up to this handler; only real grid cells start a drag.
    const target = e.target as HTMLElement;
    if (!gridRef.current?.contains(target) || target.closest('[data-block]') || e.button !== 0) return;
    const hit = slotAt(e);
    if (!hit) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ day: hit.day, from: hit.slot, to: hit.slot, moved: false });
  };
  const onMove = (e: ReactPointerEvent) => {
    if (!drag) return;
    const hit = slotAt(e);
    if (hit && hit.slot !== drag.to) setDrag({ ...drag, to: hit.slot, moved: true });
  };
  const onUp = () => {
    if (!drag) return;
    setDrag(null);
    if (!drag.moved) return; // a plain click adds nothing; drag to create
    const a = Math.min(drag.from, drag.to);
    const b = Math.max(drag.from, drag.to) + 1;
    const start = toHHMM(HOUR_START * 60 + a * SLOT_MIN);
    const end = toHHMM(HOUR_START * 60 + b * SLOT_MIN);
    onChange({ ...value, [kind]: [...(value[kind] ?? []), { day: drag.day, start, end }] });
  };

  const addKind = () => {
    const k = slug(newKind ?? '');
    setNewKind(null);
    if (!k) return;
    if (!kinds.includes(k)) setExtraKinds((x) => [...x, k]);
    setKind(k);
  };

  const top = (t: string) => ((toMin(t) - HOUR_START * 60) / SLOT_MIN) * SLOT_PX;
  const height = (m: Meeting) => Math.max(SLOT_PX, ((toMin(m.end) - toMin(m.start)) / SLOT_MIN) * SLOT_PX);
  const hours = Array.from({ length: HOUR_END - HOUR_START }, (_, i) => HOUR_START + i);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1 text-xs">
        <span className="text-muted-foreground">Drag on a day to add:</span>
        {kinds.map((k) => (
          <button key={k} type="button" onClick={() => setKind(k)} className={cn('rounded-md border px-2 py-0.5', kind === k ? toneFor(k) + ' font-medium' : 'text-muted-foreground hover:bg-secondary/60')}>
            {meetingLabel(k)}
          </button>
        ))}
        {newKind === null ? (
          <button type="button" onClick={() => setNewKind('')} className="rounded-md border border-dashed px-2 py-0.5 text-muted-foreground hover:bg-secondary/60" title="Add a kind of session: seminar, studio, recitation…">
            <Plus className="inline size-3" /> kind
          </button>
        ) : (
          <Input
            autoFocus
            className="h-6 w-32 text-xs"
            placeholder="seminar"
            value={newKind}
            onChange={(e) => setNewKind(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addKind(); } if (e.key === 'Escape') setNewKind(null); }}
            onBlur={addKind}
          />
        )}
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
            {drag && drag.moved && (
              <div
                className={cn('pointer-events-none absolute rounded border', toneFor(kind))}
                style={{ left: `${(DAYS.indexOf(drag.day) / 7) * 100}%`, width: `${100 / 7}%`, top: Math.min(drag.from, drag.to) * SLOT_PX, height: (Math.abs(drag.to - drag.from) + 1) * SLOT_PX }}
              />
            )}
            {blocks.map((b) => (
              <BlockEditor key={`${b.kind}-${b.index}`} block={b} kinds={kinds} toneFor={toneFor} onChange={update}>
                <button
                  type="button"
                  data-block
                  className={cn('absolute overflow-hidden rounded border px-1 text-left leading-tight hover:brightness-110', toneFor(b.kind))}
                  style={{ left: `calc(${(DAYS.indexOf(b.meeting.day) / 7) * 100}% + 2px)`, width: `calc(${100 / 7}% - 4px)`, top: top(b.meeting.start), height: height(b.meeting) }}
                  title={`${meetingLabel(b.kind)} ${fmt(b.meeting.start)}–${fmt(b.meeting.end)}${b.meeting.location ? ` · ${b.meeting.location}` : ''}`}
                >
                  <div className="truncate font-medium">{fmt(b.meeting.start)}–{fmt(b.meeting.end)}</div>
                  {height(b.meeting) > 2 * SLOT_PX && <div className="truncate">{b.meeting.location ?? meetingLabel(b.kind)}</div>}
                </button>
              </BlockEditor>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function BlockEditor({ block, kinds, toneFor, onChange, children }: { block: Block; kinds: string[]; toneFor(k: string): string; onChange(b: Block, patch: Partial<Meeting> | null, newKind?: string): void; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const m = block.meeting;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      {/* Stop pointer events here so the grid never sees clicks inside the editor (it would start a drag). */}
      <PopoverContent className="w-64 space-y-2 p-3 text-sm" onOpenAutoFocus={(e) => e.preventDefault()} onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onPointerMove={(e) => e.stopPropagation()}>
        <div className="flex flex-wrap gap-1">
          {kinds.map((k) => (
            <button key={k} type="button" onClick={() => onChange(block, {}, k)} className={cn('rounded-md border px-1.5 py-0.5 text-xs', block.kind === k ? toneFor(k) + ' font-medium' : 'text-muted-foreground hover:bg-secondary/60')}>
              {meetingLabel(k)}
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
        <Button type="button" size="xs" variant="ghost" className="text-destructive" onClick={() => { setOpen(false); onChange(block, null); }}>
          <Trash2 className="size-3" /> Remove
        </Button>
      </PopoverContent>
    </Popover>
  );
}
