import { useMemo, useState, type FormEvent } from 'react';
import { addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, parseISO, startOfMonth, startOfWeek } from 'date-fns';
import { ChevronLeft, ChevronRight, ExternalLink, MapPin, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { COURSE_EVENT_KINDS, COURSE_EVENT_LABELS, MEETING_KINDS, type Course, type CourseEventKind, type EffectiveItem, type ManualEventInput, type Meeting, type MeetingKind } from '@collected/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useCreateManualEvent, useDeleteManualEvent, useItems, useUpdateManualEvent } from '@/lib/queries';
import { friendlyDate } from '@/lib/time';
import { cn } from '@/lib/utils';
import { ItemPopover } from '@/widgets/ItemPopover';
import { manualRaw } from '@/widgets/shared';

const DAY_INDEX: Record<Meeting['day'], number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const MEETING_LABEL: Record<MeetingKind, string> = { lecture: 'Lecture', discussion: 'Discussion', office_hours: 'Office hours' };
const KIND_TONE: Record<CourseEventKind, string> = {
  exam: 'bg-red-500',
  final: 'bg-red-600',
  quiz: 'bg-orange-500',
  cancelled: 'bg-muted-foreground',
  virtual: 'bg-sky-500',
  other: 'bg-emerald-500',
};
const EXAMISH = /\b(exam|midterm|final|quiz|test)\b/i;
const today = () => format(new Date(), 'yyyy-MM-dd');

function fmtTime(t: string): string {
  const [h, m] = t.split(':').map(Number);
  return `${(h ?? 0) % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${(h ?? 0) >= 12 ? 'PM' : 'AM'}`;
}

/** Scheduled sessions on a given date, from the weekly schedule. */
function sessionsOn(course: Course, date: Date): { kind: MeetingKind; meeting: Meeting }[] {
  const out: { kind: MeetingKind; meeting: Meeting }[] = [];
  for (const kind of MEETING_KINDS) for (const m of course.schedule[kind] ?? []) if (DAY_INDEX[m.day] === date.getDay()) out.push({ kind, meeting: m });
  return out;
}

type Draft = ManualEventInput & { externalId?: string; allDay: boolean };

const blankDraft = (courseId: string, date: string): Draft => ({ courseId, kind: 'exam', title: '', date, start: null, end: null, location: null, note: null, meetingKind: null, allDay: true });

function EventForm({ course, draft, onChange, onSaved, onCancel }: { course: Course; draft: Draft; onChange(d: Draft): void; onSaved(): void; onCancel(): void }) {
  const create = useCreateManualEvent();
  const update = useUpdateManualEvent();
  const sessions = sessionsOn(course, parseISO(draft.date));
  const sessionTag = draft.kind === 'cancelled' || draft.kind === 'virtual';
  const pickSession = (kind: CourseEventKind, s?: { kind: MeetingKind; meeting: Meeting }) => {
    const label = s ? MEETING_LABEL[s.kind].toLowerCase() : 'class';
    onChange({
      ...draft,
      kind,
      meetingKind: s?.kind ?? null,
      title: `${course.code} ${label} ${kind === 'cancelled' ? 'cancelled' : 'online'}`,
      allDay: !s,
      start: s?.meeting.start ?? null,
      end: s?.meeting.end ?? null,
      location: kind === 'virtual' ? (draft.location ?? null) : null,
    });
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const body: ManualEventInput = {
      courseId: course.id,
      kind: draft.kind,
      title: draft.title.trim(),
      date: draft.date,
      start: draft.allDay ? null : draft.start || null,
      end: draft.allDay ? null : draft.end || null,
      location: draft.location?.trim() || null,
      note: draft.note?.trim() || null,
      meetingKind: sessionTag ? draft.meetingKind : null,
    };
    const opts = { onSuccess: () => { toast.success(draft.externalId ? 'Saved' : 'Added'); onSaved(); }, onError: (err: Error) => toast.error(err.message) };
    if (draft.externalId) update.mutate({ externalId: draft.externalId, ...body }, opts);
    else create.mutate(body, opts);
  };
  return (
    <form onSubmit={submit} className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap gap-1">
        {COURSE_EVENT_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => (k === 'cancelled' || k === 'virtual' ? pickSession(k, sessions[0]) : onChange({ ...draft, kind: k, meetingKind: null }))}
            className={cn('flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs', draft.kind === k ? 'bg-secondary font-medium' : 'text-muted-foreground hover:bg-secondary/60')}
          >
            <span className={cn('inline-block size-1.5 rounded-full', KIND_TONE[k])} /> {COURSE_EVENT_LABELS[k]}
          </button>
        ))}
      </div>
      {sessionTag && sessions.length > 1 && (
        <div className="flex flex-wrap items-center gap-1 text-xs">
          <span className="text-muted-foreground">Which session:</span>
          {sessions.map((s) => (
            <button key={s.kind + s.meeting.start} type="button" onClick={() => pickSession(draft.kind, s)} className={cn('rounded-md border px-2 py-0.5', draft.meetingKind === s.kind && draft.start === s.meeting.start ? 'bg-secondary font-medium' : 'text-muted-foreground hover:bg-secondary/60')}>
              {MEETING_LABEL[s.kind]} {fmtTime(s.meeting.start)}
            </button>
          ))}
        </div>
      )}
      {sessionTag && !sessions.length && <p className="text-xs text-muted-foreground">No scheduled session on this day; the tag applies to the whole day.</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1 sm:col-span-2">
          <Label className="text-xs text-muted-foreground">Title</Label>
          <Input required autoFocus value={draft.title} onChange={(e) => onChange({ ...draft, title: e.target.value })} className="h-8 text-sm" placeholder={draft.kind === 'exam' ? 'Midterm 1' : draft.kind === 'quiz' ? 'Quiz 3' : draft.kind === 'final' ? 'Final exam' : 'Guest lecture'} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Date</Label>
          <Input type="date" required value={draft.date} onChange={(e) => onChange({ ...draft, date: e.target.value })} className="h-8 text-sm" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Time</Label>
          <div className="flex items-center gap-1">
            <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={draft.allDay} onChange={(e) => onChange({ ...draft, allDay: e.target.checked })} /> all day</label>
            {!draft.allDay && (
              <>
                <Input type="time" value={draft.start ?? ''} onChange={(e) => onChange({ ...draft, start: e.target.value || null })} className="h-8 text-sm" />
                <span className="text-xs text-muted-foreground">–</span>
                <Input type="time" value={draft.end ?? ''} onChange={(e) => onChange({ ...draft, end: e.target.value || null })} className="h-8 text-sm" />
              </>
            )}
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Location</Label>
          <Input value={draft.location ?? ''} onChange={(e) => onChange({ ...draft, location: e.target.value || null })} className="h-8 text-sm" placeholder={draft.kind === 'virtual' ? 'Zoom link' : 'IRB 0324'} />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label className="text-xs text-muted-foreground">Note</Label>
          <Textarea rows={2} value={draft.note ?? ''} onChange={(e) => onChange({ ...draft, note: e.target.value || null })} className="text-sm" placeholder="Covers chapters 1–4, bring a calculator…" />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" size="sm" disabled={create.isPending || update.isPending || !draft.title.trim()}>{draft.externalId ? 'Save' : 'Add'}</Button>
      </div>
    </form>
  );
}

/**
 * A month of the course: scheduled session days are shaded, dates carry a dot per event. Click a day to add
 * or tag a session; the list below is every date, editable.
 */
export function CourseDates({ course, assignments }: { course: Course; assignments: EffectiveItem[] }) {
  const manualQ = useItems({ kind: ['event'], source: ['manual'], course: course.id, limit: 300, includeDone: true });
  const canvasQ = useItems({ kind: ['event'], source: ['canvas'], course: course.id, limit: 100, includeDone: true });
  const del = useDeleteManualEvent();
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [selected, setSelected] = useState<string>(today());
  const [draft, setDraft] = useState<Draft | null>(null);

  const manual = manualQ.data ?? [];
  const examish = useMemo(() => assignments.filter((a) => EXAMISH.test(a.title) && a.dueAt), [assignments]);
  const dated = useMemo(() => {
    const rows: { date: string; item: EffectiveItem; from: 'manual' | 'canvas' | 'assignment' }[] = [];
    for (const it of manual) rows.push({ date: manualRaw(it)!.date, item: it, from: 'manual' });
    for (const it of canvasQ.data ?? []) if (it.startsAt) rows.push({ date: format(new Date(it.startsAt), 'yyyy-MM-dd'), item: it, from: 'canvas' });
    for (const it of examish) rows.push({ date: format(new Date(it.dueAt!), 'yyyy-MM-dd'), item: it, from: 'assignment' });
    return rows.sort((a, b) => a.date.localeCompare(b.date) || (a.item.startsAt ?? '').localeCompare(b.item.startsAt ?? ''));
  }, [manual, canvasQ.data, examish]);
  const byDate = useMemo(() => {
    const m = new Map<string, typeof dated>();
    for (const r of dated) m.set(r.date, [...(m.get(r.date) ?? []), r]);
    return m;
  }, [dated]);

  const days = eachDayOfInterval({ start: startOfWeek(startOfMonth(month), { weekStartsOn: 0 }), end: endOfWeek(endOfMonth(month), { weekStartsOn: 0 }) });
  const selectedDate = parseISO(selected);
  const selectedRows = byDate.get(selected) ?? [];
  const sessions = sessionsOn(course, selectedDate);
  const upcoming = dated.filter((r) => r.date >= today());
  const past = dated.filter((r) => r.date < today());

  const startDraft = (d: Partial<Draft> = {}) => setDraft({ ...blankDraft(course.id, selected), ...d });
  const editRow = (it: EffectiveItem) => {
    const raw = manualRaw(it)!;
    setSelected(raw.date);
    setDraft({ externalId: it.externalId, courseId: course.id, kind: raw.eventKind, title: it.title, date: raw.date, start: raw.start, end: raw.end, location: raw.location, note: raw.note, meetingKind: raw.meetingKind, allDay: !raw.start });
  };
  const remove = (it: EffectiveItem) => del.mutate(it.externalId, { onSuccess: () => toast.success('Removed'), onError: (e) => toast.error(e.message) });

  const dotFor = (r: (typeof dated)[number]): string => (r.from === 'manual' ? KIND_TONE[manualRaw(r.item)!.eventKind] : r.from === 'assignment' ? 'bg-red-500/70' : 'bg-primary/60');
  const kindOf = (r: (typeof dated)[number]): string => (r.from === 'manual' ? COURSE_EVENT_LABELS[manualRaw(r.item)!.eventKind] : r.from === 'assignment' ? 'Canvas assignment' : 'Canvas event');

  const Row = ({ r }: { r: (typeof dated)[number] }) => {
    const raw = manualRaw(r.item);
    const when = raw ? (raw.start ? `${fmtTime(raw.start)}${raw.end ? `–${fmtTime(raw.end)}` : ''}` : 'all day') : r.item.allDay ? 'all day' : r.item.startsAt ? format(new Date(r.item.kind === 'event' ? r.item.startsAt : r.item.dueAt!), 'h:mm a') : r.item.dueAt ? `due ${format(new Date(r.item.dueAt), 'h:mm a')}` : '';
    return (
      <li className="group/row flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-accent/60">
        <span className={cn('inline-block size-2 shrink-0 rounded-full', dotFor(r))} title={kindOf(r)} />
        <span className="w-16 shrink-0 text-xs text-muted-foreground">{friendlyDate(`${r.date}T12:00:00`)}</span>
        <ItemPopover item={r.item} className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 flex-1 truncate">{r.item.title}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{when}</span>
            {raw?.location && <span className="hidden shrink-0 items-center gap-0.5 text-xs text-muted-foreground sm:flex"><MapPin className="size-3" />{raw.location}</span>}
          </span>
        </ItemPopover>
        {raw ? (
          <span className="flex shrink-0 items-center opacity-0 group-hover/row:opacity-100">
            <Button size="icon-xs" variant="ghost" aria-label="Edit" onClick={() => editRow(r.item)}><Pencil className="size-3" /></Button>
            <Button size="icon-xs" variant="ghost" aria-label="Remove" className="text-destructive" onClick={() => remove(r.item)}><Trash2 className="size-3" /></Button>
          </span>
        ) : (
          r.item.url && <a href={r.item.url} target="_blank" rel="noreferrer" className="shrink-0 text-muted-foreground opacity-0 group-hover/row:opacity-100" title="Open in Canvas"><ExternalLink className="size-3" /></a>
        )}
      </li>
    );
  };

  return (
    <div className="space-y-4">
      <div className="rounded-md border">
        <div className="flex items-center gap-1 border-b px-2 py-1">
          <Button size="icon-xs" variant="ghost" aria-label="Previous month" onClick={() => setMonth((m) => addMonths(m, -1))}><ChevronLeft className="size-3.5" /></Button>
          <Button size="icon-xs" variant="ghost" aria-label="Next month" onClick={() => setMonth((m) => addMonths(m, 1))}><ChevronRight className="size-3.5" /></Button>
          <span className="ml-1 text-sm font-medium">{format(month, 'MMMM yyyy')}</span>
          <span className="ml-auto flex items-center gap-2 text-[10px] text-muted-foreground">
            <span className="inline-flex items-center gap-1"><span className="inline-block size-2 rounded-sm bg-primary/15 ring-1 ring-primary/30" /> class day</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block size-1.5 rounded-full bg-red-500" /> exam</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block size-1.5 rounded-full bg-orange-500" /> quiz</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block size-1.5 rounded-full bg-muted-foreground" /> cancelled</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block size-1.5 rounded-full bg-sky-500" /> virtual</span>
          </span>
        </div>
        <div className="grid grid-cols-7 text-center text-[10px] text-muted-foreground">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <div key={i} className="py-1">{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-px border-t bg-border">
          {days.map((d) => {
            const key = format(d, 'yyyy-MM-dd');
            const inMonth = isSameMonth(d, month);
            const isClass = sessionsOn(course, d).length > 0;
            const rows = byDate.get(key) ?? [];
            const cancelled = rows.some((r) => manualRaw(r.item)?.eventKind === 'cancelled');
            return (
              <button
                key={key}
                type="button"
                onClick={() => { setSelected(key); setDraft(null); }}
                className={cn(
                  'flex h-12 flex-col items-start bg-card p-1 text-left text-xs hover:bg-accent/60',
                  !inMonth && 'text-muted-foreground/50',
                  isClass && inMonth && !cancelled && 'bg-primary/[0.06]',
                  isSameDay(d, new Date()) && 'font-semibold text-primary',
                  key === selected && 'ring-2 ring-inset ring-ring',
                )}
              >
                <span className={cn('tabular-nums', cancelled && 'line-through decoration-muted-foreground')}>{format(d, 'd')}</span>
                <span className="mt-auto flex flex-wrap gap-0.5">
                  {rows.slice(0, 4).map((r, i) => <span key={i} className={cn('inline-block size-1.5 rounded-full', dotFor(r))} />)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-1">
          <h4 className="text-sm font-medium">{friendlyDate(`${selected}T12:00:00`)}, {format(selectedDate, 'MMM d')}</h4>
          {sessions.map((s) => (
            <span key={s.kind + s.meeting.start} className="rounded bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground">
              {MEETING_LABEL[s.kind]} {fmtTime(s.meeting.start)}–{fmtTime(s.meeting.end)}
            </span>
          ))}
          <span className="ml-auto flex items-center gap-1">
            {sessions.length > 0 && (
              <>
                <Button size="xs" variant="secondary" onClick={() => startDraft({ kind: 'cancelled', meetingKind: sessions[0]!.kind, title: `${course.code} ${MEETING_LABEL[sessions[0]!.kind].toLowerCase()} cancelled`, allDay: false, start: sessions[0]!.meeting.start, end: sessions[0]!.meeting.end })}>Cancelled</Button>
                <Button size="xs" variant="secondary" onClick={() => startDraft({ kind: 'virtual', meetingKind: sessions[0]!.kind, title: `${course.code} ${MEETING_LABEL[sessions[0]!.kind].toLowerCase()} online`, allDay: false, start: sessions[0]!.meeting.start, end: sessions[0]!.meeting.end })}>Virtual</Button>
              </>
            )}
            <Button size="xs" onClick={() => startDraft()}><Plus className="size-3" /> Add date</Button>
          </span>
        </div>
        {draft && <EventForm course={course} draft={draft} onChange={setDraft} onSaved={() => setDraft(null)} onCancel={() => setDraft(null)} />}
        {selectedRows.length > 0 && <ul className="-mx-1">{selectedRows.map((r) => <Row key={r.item.id} r={r} />)}</ul>}
        {!selectedRows.length && !draft && <p className="px-1 text-xs text-muted-foreground/80">Nothing on this day.</p>}
      </section>

      <section className="space-y-1">
        <h4 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Upcoming · {upcoming.length}</h4>
        {upcoming.length ? <ul className="-mx-1">{upcoming.map((r) => <Row key={r.item.id} r={r} />)}</ul> : <p className="px-1 text-xs text-muted-foreground/80">No dates yet. Exams, quizzes, and finals go here; assignments whose title says exam or quiz show up automatically.</p>}
      </section>
      {past.length > 0 && (
        <details className="space-y-1">
          <summary className="cursor-pointer text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Past · {past.length}</summary>
          <ul className="-mx-1 opacity-70">{past.slice().reverse().map((r) => <Row key={r.item.id} r={r} />)}</ul>
        </details>
      )}
    </div>
  );
}
