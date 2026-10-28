import { useMemo } from 'react';
import { format, formatDistanceStrict } from 'date-fns';
import { meetingLabel } from '@collected/shared';
import { WidgetHeader } from '@/dashboard/WidgetHeader';
import { useLiquid } from '@/lib/liquid';
import { useCourses, useItems, useUpsertWidget } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { safeColor } from '@/lib/color';
import { meetingExceptions, nextMeeting, windowFromNow, type NextMeeting } from '@/widgets/shared';
import type { WidgetProps } from '@/widgets/types';
import { useNow } from '@/widgets/useNow';

type Style = 'auto' | 'analog' | 'digital';
export interface ClockConfig {
  style?: Style;
  hour24?: boolean;
}

/**
 * The soonest scheduled session across every active course, honouring cancellations; one in progress counts until it
 * ends. Recomputed each minute of `now`, not each second.
 */
function useNextClass(now: Date): (NextMeeting & { code: string; color: string | null }) | null {
  const courses = useCourses();
  const win = useMemo(() => windowFromNow(14), []);
  const manual = useItems({ kind: ['event'], source: ['manual'], from: win.from, to: win.to, limit: 200 });
  const minute = Math.floor(now.getTime() / 60_000);
  return useMemo(() => {
    const at = new Date(minute * 60_000);
    let best: (NextMeeting & { code: string; color: string | null }) | null = null;
    for (const c of (courses.data ?? []).filter((c) => !c.archived)) {
      const m = nextMeeting(c.schedule, meetingExceptions((manual.data ?? []).filter((it) => it.courseId === c.id)), at);
      if (m && (!best || m.when < best.when)) best = { ...m, code: c.code, color: safeColor(c.color) ?? null };
    }
    return best;
  }, [courses.data, manual.data, minute]);
}

/** "now" for a session that started under a minute ago, "started 12 minutes ago" while it runs, "in 20 minutes", or "Thu 2:00 PM". */
function whenLabel(when: Date, now: Date): string {
  const ms = when.getTime() - now.getTime();
  if (ms <= 0) return -ms < 60_000 ? 'now' : `started ${formatDistanceStrict(when, now)} ago`;
  return ms < 36e5 * 18 ? `in ${formatDistanceStrict(when, now)}` : format(when, 'EEE h:mm a');
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
      {Array.from({ length: 60 }, (_, i) => {
        const major = i % 5 === 0;
        return <line key={i} x1="50" y1={major ? 5.5 : 6} x2="50" y2={major ? 12 : 9.5} stroke={major ? 'var(--ink-muted)' : 'var(--line-strong)'} strokeOpacity={major ? 1 : 0.45} strokeWidth={major ? 1.8 : 1} strokeLinecap="round" transform={`rotate(${i * 6} 50 50)`} />;
      })}
      <line x1="50" y1="52" x2="50" y2="28" stroke="var(--ink)" strokeWidth="4.5" strokeLinecap="round" transform={`rotate(${hourDeg} 50 50)`} />
      <line x1="50" y1="54" x2="50" y2="16" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" transform={`rotate(${minDeg} 50 50)`} />
      <line x1="50" y1="58" x2="50" y2="13" stroke={accent ?? 'var(--brand)'} strokeWidth="1.2" strokeLinecap="round" transform={`rotate(${secDeg} 50 50)`} />
      <circle cx="50" cy="50" r="2.6" fill={accent ?? 'var(--brand)'} stroke="var(--well)" strokeWidth="1" />
    </svg>
  );
}

/** A clock. Analog when the box is roughly square, digital otherwise; the choice can be pinned. Shows the next class. */
export function ClockWidget({ instance, size }: WidgetProps<ClockConfig>) {
  const upsert = useUpsertWidget();
  const style: Style = instance.config.style ?? 'auto';
  const hour24 = !!instance.config.hour24;
  const now = useNow(1000);
  const liquid = useLiquid();
  const next = useNextClass(now);
  const setConfig = (patch: Partial<ClockConfig>) => upsert.mutate({ id: instance.id, config: { ...instance.config, ...patch } });

  const squarish = size.width / Math.max(1, size.height) > 0.7 && size.width / Math.max(1, size.height) < 1.7;
  const analog = style === 'analog' || (style === 'auto' && squarish && Math.min(size.width, size.height) >= 150);
  const xs = size.tier === 'xs';
  const timeFmt = hour24 ? 'HH:mm' : 'h:mm';
  const nextLine = next && (
    <div className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-sub" title={next.label}>
      <span className="size-1.5 shrink-0 rounded-full" style={{ background: next.color ?? 'var(--brand)' }} />
      <span className="truncate">
        <span className="font-medium text-ink">{next.code}</span> {meetingLabel(next.kind).toLowerCase()} {whenLabel(next.when, now)}
        {next.virtual ? ' · online' : ''}
      </span>
    </div>
  );

  return (
    <div className="flex h-full flex-col">
      {!xs && (
        <WidgetHeader>
          <span className="seg" ref={liquid}>
            {(['auto', 'analog', 'digital'] as Style[]).map((s) => (
              <button key={s} className={cn('capitalize', style === s && 'seg-on')} aria-pressed={style === s} onClick={() => setConfig({ style: s })}>{s}</button>
            ))}
          </span>
        </WidgetHeader>
      )}
      {analog ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-3">
          <Analog now={now} size={Math.max(96, Math.min(size.width - 24, size.height - (next && !xs ? 56 : 24), 320))} accent={null} />
          {!xs && nextLine}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 p-3 text-center">
          <button
            type="button"
            className="flex items-baseline gap-1.5 font-[560] leading-none tracking-[-0.035em] tabular-nums"
            style={{ fontSize: Math.max(28, Math.min(size.width / 5.2, size.height * 0.42, 96)) }}
            title={hour24 ? 'Click for 12-hour time' : 'Click for 24-hour time'}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => setConfig({ hour24: !hour24 })}
          >
            {format(now, timeFmt)}
            {!hour24 && <span className="text-[0.32em] font-semibold text-sub">{format(now, 'a')}</span>}
            {size.tier !== 'sm' && !xs && <span className="text-[0.4em] font-semibold text-ter">{format(now, 'ss')}</span>}
          </button>
          {!xs && <div className="label mt-1">{format(now, 'EEEE · MMMM d')}</div>}
          {!xs && size.height >= 120 && nextLine}
        </div>
      )}
    </div>
  );
}
