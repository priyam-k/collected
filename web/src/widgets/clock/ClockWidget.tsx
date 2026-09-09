import { useEffect, useMemo, useState } from 'react';
import { format, formatDistanceToNowStrict } from 'date-fns';
import { meetingLabel } from '@collected/shared';
import { WidgetHeader } from '@/dashboard/WidgetHeader';
import { useCourses, useItems, useUpsertWidget } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { meetingExceptions, nextMeeting, windowFromNow, type NextMeeting } from '@/widgets/shared';
import type { WidgetProps } from '@/widgets/types';

type Style = 'auto' | 'analog' | 'digital';
export interface ClockConfig {
  style?: Style;
  hour24?: boolean;
}

function useNow(everyMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), everyMs);
    return () => window.clearInterval(id);
  }, [everyMs]);
  return now;
}

/** The soonest scheduled session across every active course, honouring cancellations. */
function useNextClass(): (NextMeeting & { code: string; color: string | null }) | null {
  const courses = useCourses();
  const win = useMemo(() => windowFromNow(14), []);
  const manual = useItems({ kind: ['event'], source: ['manual'], from: win.from, to: win.to, limit: 200 });
  return useMemo(() => {
    let best: (NextMeeting & { code: string; color: string | null }) | null = null;
    for (const c of (courses.data ?? []).filter((c) => !c.archived)) {
      const m = nextMeeting(c.schedule, meetingExceptions((manual.data ?? []).filter((it) => it.courseId === c.id)));
      if (m && (!best || m.when < best.when)) best = { ...m, code: c.code, color: c.color };
    }
    return best;
  }, [courses.data, manual.data]);
}

function Analog({ now, size, accent }: { now: Date; size: number; accent: string | null }) {
  const h = now.getHours() % 12;
  const m = now.getMinutes();
  const s = now.getSeconds();
  const hourDeg = (h + m / 60) * 30;
  const minDeg = (m + s / 60) * 6;
  const secDeg = s * 6;
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={format(now, 'h:mm a')}>
      <circle cx="50" cy="50" r="48" fill="var(--well)" />
      <circle cx="50" cy="50" r="48" fill="none" stroke="var(--line2)" strokeWidth="1" />
      {Array.from({ length: 60 }, (_, i) => {
        const major = i % 5 === 0;
        return <line key={i} x1="50" y1={major ? 6 : 8} x2="50" y2={major ? 12 : 10} stroke={major ? 'var(--sub)' : 'var(--ter)'} strokeOpacity={major ? 1 : 0.5} strokeWidth={major ? 2 : 1} strokeLinecap="round" transform={`rotate(${i * 6} 50 50)`} />;
      })}
      <line x1="50" y1="52" x2="50" y2="28" stroke="var(--ink)" strokeWidth="4.5" strokeLinecap="round" transform={`rotate(${hourDeg} 50 50)`} />
      <line x1="50" y1="54" x2="50" y2="16" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" transform={`rotate(${minDeg} 50 50)`} />
      <line x1="50" y1="58" x2="50" y2="13" stroke={accent ?? 'var(--coral)'} strokeWidth="1.2" strokeLinecap="round" transform={`rotate(${secDeg} 50 50)`} />
      <circle cx="50" cy="50" r="2.6" fill={accent ?? 'var(--coral)'} />
    </svg>
  );
}

/** A clock. Analog when the box is roughly square, digital otherwise; the choice can be pinned. Shows the next class. */
export function ClockWidget({ instance, size }: WidgetProps<ClockConfig>) {
  const upsert = useUpsertWidget();
  const style: Style = instance.config.style ?? 'auto';
  const hour24 = !!instance.config.hour24;
  const now = useNow(1000);
  const next = useNextClass();
  const setConfig = (patch: Partial<ClockConfig>) => upsert.mutate({ id: instance.id, config: { ...instance.config, ...patch } });

  const squarish = size.width / Math.max(1, size.height) > 0.7 && size.width / Math.max(1, size.height) < 1.7;
  const analog = style === 'analog' || (style === 'auto' && squarish && Math.min(size.width, size.height) >= 150);
  const xs = size.tier === 'xs';
  const timeFmt = hour24 ? 'HH:mm' : 'h:mm';
  const nextLine = next && (
    <div className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-sub" title={next.label}>
      <span className="size-1.5 shrink-0 rounded-full" style={{ background: next.color ?? 'var(--indigo)' }} />
      <span className="truncate">
        <span className="font-medium text-ink">{next.code}</span> {meetingLabel(next.kind).toLowerCase()} {next.when.getTime() - now.getTime() < 36e5 * 18 ? `in ${formatDistanceToNowStrict(next.when)}` : format(next.when, 'EEE h:mm a')}
        {next.virtual ? ' · online' : ''}
      </span>
    </div>
  );

  return (
    <div className="flex h-full flex-col">
      {!xs && (
        <WidgetHeader>
          <span className="seg">
            {(['auto', 'analog', 'digital'] as Style[]).map((s) => (
              <button key={s} className={cn('capitalize', style === s && 'seg-on')} onClick={() => setConfig({ style: s })}>{s}</button>
            ))}
          </span>
        </WidgetHeader>
      )}
      {analog ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-3">
          <Analog now={now} size={Math.max(96, Math.min(size.width - 24, size.height - (next && !xs ? 56 : 24), 320))} accent={next?.color ?? null} />
          {!xs && nextLine}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 p-3 text-center">
          <button
            type="button"
            className="flex items-baseline gap-1.5 font-bold leading-none tracking-[-0.04em] tabular-nums"
            style={{ fontSize: Math.max(28, Math.min(size.width / 5.2, size.height * 0.42, 96)) }}
            title={hour24 ? 'Click for 12-hour time' : 'Click for 24-hour time'}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => setConfig({ hour24: !hour24 })}
          >
            {format(now, timeFmt)}
            {!hour24 && <span className="text-[0.32em] font-semibold text-sub">{format(now, 'a')}</span>}
            {size.tier !== 'sm' && !xs && <span className="text-[0.4em] font-semibold text-ter">{format(now, 'ss')}</span>}
          </button>
          {!xs && <div className="text-[13px] text-sub">{format(now, 'EEEE, MMMM d')}</div>}
          {!xs && size.height >= 120 && nextLine}
        </div>
      )}
    </div>
  );
}
