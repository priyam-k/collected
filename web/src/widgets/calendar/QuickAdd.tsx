import { useState } from 'react';
import { Plus } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useCreateEvent, useSources } from '@/lib/queries';

interface GCalMeta {
  calendars?: { id: string; summary: string; primary: boolean; backgroundColor: string | null; accessRole: string | null }[];
  selectedCalendars?: string[];
  defaultCalendarId?: string | null;
}

export function QuickAdd({ defaultDate }: { defaultDate?: Date }) {
  const sources = useSources();
  const gcal = sources.data?.find((s) => s.id === 'gcal');
  const meta = (gcal?.meta ?? {}) as GCalMeta;
  const create = useCreateEvent();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(format(defaultDate ?? new Date(), 'yyyy-MM-dd'));
  const [time, setTime] = useState('');
  const [duration, setDuration] = useState('60');
  const [calendarId, setCalendarId] = useState<string>('');
  const writable = (meta.calendars ?? []).filter((c) => c.accessRole === 'owner' || c.accessRole === 'writer');
  const connected = gcal?.status === 'connected' && !!gcal.hasConfig;

  const submit = () => {
    const allDay = !time;
    const start = allDay ? date : new Date(`${date}T${time}:00`).toISOString();
    const end = allDay ? undefined : new Date(new Date(`${date}T${time}:00`).getTime() + Number(duration) * 60_000).toISOString();
    create.mutate(
      { title: title.trim(), allDay, start, end, calendarId: calendarId || undefined },
      {
        onSuccess: () => {
          toast.success('Event added');
          setTitle('');
          setOpen(false);
        },
        onError: (e) => toast.error(e.message),
      },
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="orb size-[30px] border border-line text-base disabled:opacity-40" aria-label="Add event" title={connected ? 'Add event' : 'Connect Google Calendar to add events'} disabled={!connected}>
          <Plus className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-2">
        <Input autoFocus placeholder="Event title" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && title.trim() && submit()} />
        <div className="flex gap-2">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} placeholder="all day" />
        </div>
        <div className="flex gap-2">
          <select className="h-8 flex-1 rounded-[10px] border border-line2 bg-well px-2 text-sm" value={duration} onChange={(e) => setDuration(e.target.value)} disabled={!time}>
            <option value="30">30 min</option>
            <option value="60">1 hour</option>
            <option value="90">1.5 hours</option>
            <option value="120">2 hours</option>
          </select>
          {writable.length > 1 && (
            <select className="h-8 flex-1 rounded-[10px] border border-line2 bg-well px-2 text-sm" value={calendarId} onChange={(e) => setCalendarId(e.target.value)}>
              <option value="">{writable.find((c) => c.id === meta.defaultCalendarId)?.summary ?? 'Default calendar'}</option>
              {writable.map((c) => <option key={c.id} value={c.id}>{c.summary}</option>)}
            </select>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button size="sm" disabled={!title.trim() || create.isPending} onClick={submit}>Add</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
