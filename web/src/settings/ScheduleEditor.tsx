import { useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { MEETING_KINDS, meetingLabel, type CourseSchedule, type Meeting } from '@collected/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { safeColor } from '@/lib/color';
import { cn } from '@/lib/utils';

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
const byTime = (a: Meeting, c: Meeting) => DAYS.indexOf(a.day) - DAYS.indexOf(c.day) || toMin(a.start) - toMin(c.start);

interface Block {
  /** Client-side identity that survives edits, re-sorting and kind changes, so an open popover stays on its block. */
  id: string;
  kind: string;
  index: number;
  meeting: Meeting;
}

let nextId = 0;
const newId = () => `m${++nextId}`;
/** Key order can change on the way through zod, so the signature sorts keys. */
const sig = (kind: string, m: Meeting) => `${kind}|${JSON.stringify(m, Object.keys(m).sort())}`;

/**
 * Give each meeting in `value` an id, reusing the previous render's ids: first an exact match (the value
 * round-trips through JSON, so an edit made here comes back equal), then the same kind and position (an
 * edit made in the JSON box), and a new id otherwise.
 */
function reconcile(value: CourseSchedule, kinds: string[], prev: Block[]): Block[] {
  const unused = new Set(prev);
  const take = (pred: (b: Block) => boolean): Block | undefined => {
    for (const b of unused) if (pred(b)) {
      unused.delete(b);
      return b;
    }
    return undefined;
  };
  const out: Block[] = [];
  for (const k of kinds)
    (value[k] ?? []).forEach((m, i) => {
      const s = sig(k, m);
      const hit = take((b) => sig(b.kind, b.meeting) === s) ?? take((b) => b.kind === k && b.index === i);
      out.push({ id: hit?.id ?? newId(), kind: k, index: i, meeting: m });
    });
  return out;
}

/** A meeting block, drawn like the calendar's events: a faint tint of the course colour with a hairline of it. Neutral without a colour. */
function blockStyle(color: string | undefined): CSSProperties {
  if (!color) return { background: 'var(--surface)', boxShadow: 'var(--shadow-card)' };
  return { background: `color-mix(in srgb, ${color} 16%, var(--surface))`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 22%, transparent)` };
}

/**
 * Drag over a day column to add a meeting of the selected kind; click a block to adjust times, location, kind,
 * or remove it. 15-minute drag snap; the time fields accept any minute. Kinds are open: the built-in four plus
 * whatever the schedule already carries or you add here.
 */
export function ScheduleEditor({ value, onChange, color }: { value: CourseSchedule; onChange(next: CourseSchedule): void; color?: string | null }) {
  const tint = safeColor(color) ?? undefined;
  const [extraKinds, setExtraKinds] = useState<string[]>([]);
  const kinds = useMemo(() => {
    const out: string[] = [...MEETING_KINDS];
    for (const k of [...Object.keys(value), ...extraKinds]) if (!out.includes(k)) out.push(k);
    return out;
  }, [value, extraKinds]);
  const [kind, setKind] = useState<string>('lecture');
  const [newKind, setNewKind] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ day: Meeting['day']; from: number; to: number; moved: boolean } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // Blocks used to be keyed by kind and index; the list re-sorts on every edit, so an open popover jumped to
  // another block or closed. The ids live in a ref and are matched up again against each new value.
  const blocksRef = useRef<Block[]>([]);
  const blocks = useMemo(() => (blocksRef.current = reconcile(value, kinds, blocksRef.current)), [value, kinds]);

  const update = (b: Block, patch: Partial<Meeting> | null, newKindKey?: string) => {
    // Edit the (id, meeting) pairs, then write the schedule and the ids it should come back with.
    const target = newKindKey ?? b.kind;
    const lists = new Map<string, Block[]>();
    for (const x of blocks) if (x.id !== b.id) lists.set(x.kind, [...(lists.get(x.kind) ?? []), x]);
    if (patch !== null) {
      const edited = { ...b, kind: target, meeting: { ...b.meeting, ...patch } };
      lists.set(target, [...(lists.get(target) ?? []), edited].sort((x, y) => byTime(x.meeting, y.meeting)));
    }
    const next: CourseSchedule = {};
    const pairs: Block[] = [];
    for (const [k, list] of lists) {
      if (!list.length) continue;
      next[k] = list.map((x) => x.meeting);
      list.forEach((x, i) => pairs.push({ ...x, index: i }));
    }
    blocksRef.current = pairs;
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
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="mr-0.5 text-sub">Drag on a day to add:</span>
        {kinds.map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className={cn('chip !h-6 !px-2.5 !text-xs', kind === k && 'chip-on')}>
            {meetingLabel(k)}
          </button>
        ))}
        {newKind === null ? (
          <button type="button" onClick={() => setNewKind('')} className="chip !h-6 !px-2.5 !text-xs" title="Add a kind of session: seminar, studio, recitation…">
            <span className="inline-flex items-center gap-0.5"><Plus className="size-3" /> kind</span>
          </button>
        ) : (
          <Input
            autoFocus
            className="h-6 w-32 text-xs"
            placeholder="seminar"
            value={newKind}
            onChange={(e) => setNewKind(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addKind(); } if (e.key === 'Escape') { e.stopPropagation(); setNewKind(null); } }}
            onBlur={addKind}
          />
        )}
        <span className="ml-auto text-ter">Click a block to edit.</span>
      </div>
      <div className="select-none overflow-hidden rounded-2xl bg-well/60 text-[10px]">
        <div className="grid grid-cols-[2.5rem_repeat(7,minmax(0,1fr))]">
          <div />
          {DAYS.map((d) => <div key={d} className="px-1 py-1.5 text-center font-[560] text-sub">{DAY_LABEL[d]}</div>)}
        </div>
        <div className="grid grid-cols-[2.5rem_repeat(7,minmax(0,1fr))] pb-2">
          <div className="relative" style={{ height: SLOTS * SLOT_PX }}>
            {hours.map((h) => (
              <div key={h} className="absolute right-1.5 -translate-y-1/2 tabular-nums text-ter" style={{ top: (h - HOUR_START) * 4 * SLOT_PX }}>
                {h % 12 || 12}{h >= 12 ? 'p' : 'a'}
              </div>
            ))}
          </div>
          <div ref={gridRef} className="relative col-span-7 grid cursor-crosshair grid-cols-7 touch-none" style={{ height: SLOTS * SLOT_PX }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => setDrag(null)}>
            {DAYS.map((d) => (
              <div key={d} className="relative border-l border-line">
                {hours.map((h) => <div key={h} className="absolute inset-x-0 border-t border-line" style={{ top: (h - HOUR_START) * 4 * SLOT_PX }} />)}
              </div>
            ))}
            {drag && drag.moved && (
              <div
                className="pointer-events-none absolute rounded-md opacity-70"
                style={{ ...blockStyle(tint), left: `calc(${(DAYS.indexOf(drag.day) / 7) * 100}% + 2px)`, width: `calc(${100 / 7}% - 4px)`, top: Math.min(drag.from, drag.to) * SLOT_PX, height: (Math.abs(drag.to - drag.from) + 1) * SLOT_PX }}
              />
            )}
            {blocks.map((b) => (
              <BlockEditor key={b.id} block={b} kinds={kinds} onChange={update}>
                <button
                  type="button"
                  data-block
                  className="absolute overflow-hidden rounded-[6px] py-px pl-[10px] pr-1 text-left leading-tight text-ink transition-[filter] hover:brightness-[.97] focus-visible:shadow-[var(--focus-ring)] focus-visible:outline-none dark:hover:brightness-110"
                  style={{ ...blockStyle(tint), left: `calc(${(DAYS.indexOf(b.meeting.day) / 7) * 100}% + 2px)`, width: `calc(${100 / 7}% - 4px)`, top: top(b.meeting.start), height: height(b.meeting) }}
                  title={`${meetingLabel(b.kind)} ${fmt(b.meeting.start)}–${fmt(b.meeting.end)}${b.meeting.location ? ` · ${b.meeting.location}` : ''}`}
                >
                  {/* the solid course-colour bar down the left edge, as on the calendar */}
                  {tint && <span aria-hidden className="absolute bottom-[3px] left-[3px] top-[3px] w-[3px] rounded-full" style={{ background: tint }} />}
                  <div className="truncate font-[560]">{meetingLabel(b.kind)}</div>
                  {height(b.meeting) > 2 * SLOT_PX && <div className="truncate text-sub">{fmt(b.meeting.start)}–{fmt(b.meeting.end)}</div>}
                  {height(b.meeting) > 4 * SLOT_PX && b.meeting.location && <div className="truncate text-sub">{b.meeting.location}</div>}
                </button>
              </BlockEditor>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function BlockEditor({ block, kinds, onChange, children }: { block: Block; kinds: string[]; onChange(b: Block, patch: Partial<Meeting> | null, newKind?: string): void; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const m = block.meeting;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      {/* Stop pointer events here so the grid never sees clicks inside the editor (it would start a drag). */}
      <PopoverContent className="w-64 space-y-2.5 p-3 text-sm" onOpenAutoFocus={(e) => e.preventDefault()} onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onPointerMove={(e) => e.stopPropagation()}>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Kind">
          {kinds.map((k) => (
            <button key={k} type="button" aria-pressed={block.kind === k} onClick={() => block.kind !== k && onChange(block, {}, k)} className={cn('chip !h-6 !px-2.5 !text-xs', block.kind === k && 'chip-on')}>
              {meetingLabel(k)}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1.5 text-xs">
          <span className="text-sub">Day</span>
          <select className="h-7 rounded-[10px] bg-well px-1.5 text-ink outline-none focus-visible:shadow-[var(--focus-ring)]" value={m.day} onChange={(e) => onChange(block, { day: e.target.value as Meeting['day'] })}>
            {DAYS.map((d) => <option key={d} value={d}>{DAY_LABEL[d]}</option>)}
          </select>
          <span className="text-sub">Start</span>
          <Input type="time" className="h-7 text-xs" value={m.start} onChange={(e) => e.target.value && onChange(block, { start: e.target.value })} />
          <span className="text-sub">End</span>
          <Input type="time" className="h-7 text-xs" value={m.end} onChange={(e) => e.target.value && onChange(block, { end: e.target.value })} />
          <span className="text-sub">Where</span>
          <Input className="h-7 text-xs" placeholder="IRB 0324" value={m.location ?? ''} onChange={(e) => onChange(block, { location: e.target.value || undefined })} />
        </div>
        <Button type="button" size="xs" variant="ghost" className="text-critical hover:text-critical" onClick={() => { setOpen(false); onChange(block, null); }}>
          <Trash2 className="size-3" /> Remove
        </Button>
      </PopoverContent>
    </Popover>
  );
}
