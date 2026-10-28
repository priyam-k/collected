import { useMemo } from 'react';
import { Link } from 'react-router';
import { ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { meetingLabel, type Course } from '@collected/shared';
import { WidgetHeader } from '@/dashboard/WidgetHeader';
import { useCourses, useGradesSummary, useItems } from '@/lib/queries';
import { friendlyDate } from '@/lib/time';
import { usePane } from '@/panes/PaneContext';
import { cn } from '@/lib/utils';
import { safeColor } from '@/lib/color';
import { TickArc } from '@/widgets/instruments';
import { EmptyState, ErrorState, ListSkeleton } from '@/widgets/Placeholder';
import type { WidgetProps } from '@/widgets/types';
import { meetingExceptions, nextMeeting, windowFromNow } from '@/widgets/shared';
import { useNow } from '@/widgets/useNow';

/**
 * A dial of ticks with the current grade inside; TA courses show "TA" on a full ring, ungraded ones a dash on an
 * unlit ring. Lit ticks take the course colour.
 */
export function GradeRing({ course, percent, size = 34 }: { course: Pick<Course, 'role' | 'color'>; percent: number | null | undefined; size?: number }) {
  const color = safeColor(course.color) ?? 'var(--brand)';
  const ta = course.role === 'ta';
  const pct = ta ? 100 : Math.max(0, Math.min(100, percent ?? 0));
  const big = size >= 56;
  const h = size / 2;
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="absolute inset-0" aria-hidden>
        <TickArc cx={h} cy={h} r={h - 0.8} len={big ? 6 : 4} value={pct / 100} color={color} ticks={big ? 48 : 30} width={big ? 1.8 : 1.5} />
      </svg>
      <span className="flex items-baseline font-[600] leading-none tabular-nums tracking-[-0.02em] text-ink" style={{ fontSize: big ? 18 : ta ? 9.5 : 10.5 }}>
        {ta ? 'TA' : percent == null ? <span className="text-ter">–</span> : Math.round(percent)}
        {big && percent != null && !ta && <span className="ml-px text-[10px] font-semibold text-sub">%</span>}
      </span>
    </div>
  );
}

/** One row per course: grade ring, code, what's next, hotlinks on wide tiers. Click opens the course pane. */
export function ClassesWidget({ size }: WidgetProps) {
  const coursesQ = useCourses();
  const { open } = usePane();
  const win = useMemo(() => windowFromNow(21), []);
  const itemsQ = useItems({ kind: ['assignment'], from: win.from, to: win.to, limit: 500 });
  const manualQ = useItems({ kind: ['event'], source: ['manual'], from: win.from, to: win.to, limit: 200 });
  const gradesQ = useGradesSummary();
  const now = useNow(60_000);

  if (coursesQ.isError) return <ErrorState error={coursesQ.error} onRetry={() => coursesQ.refetch()} />;
  if (coursesQ.isPending) return <ListSkeleton rows={3} rowHeight={48} />;
  const courses = (coursesQ.data ?? []).filter((c) => !c.archived);
  if (coursesQ.isSuccess && !courses.length)
    return (
      <EmptyState>
        No courses yet. <Link className="underline" to="/settings/courses">Add one.</Link>
      </EmptyState>
    );

  const byCourse = new Map<string, typeof itemsQ.data>();
  for (const it of itemsQ.data ?? []) {
    if (!it.courseId) continue;
    byCourse.set(it.courseId, [...(byCourse.get(it.courseId) ?? []), it]);
  }
  const todayKey = format(now, 'yyyy-MM-dd');
  const dueToday = (itemsQ.data ?? []).filter((it) => it.dueAt && format(new Date(it.dueAt), 'yyyy-MM-dd') === todayKey && !it.effectiveDone).length;
  const wide = size.tier === 'lg' || (size.tier === 'md' && size.aspect === 'wide');

  return (
    <div className="h-full overflow-auto p-1.5">
      <WidgetHeader>
        <span className="min-w-0 truncate text-[12.5px] text-sub">{itemsQ.isPending ? '' : dueToday ? `${dueToday} due today` : 'nothing due today'}</span>
      </WidgetHeader>
      <ul className="flex flex-col">
        {courses.map((c) => {
          const list = byCourse.get(c.id) ?? [];
          const next = list[0];
          const isToday = !!next?.dueAt && format(new Date(next.dueAt), 'yyyy-MM-dd') === todayKey;
          const meeting = nextMeeting(c.schedule, meetingExceptions((manualQ.data ?? []).filter((it) => it.courseId === c.id)), now);
          const grade = gradesQ.data?.[c.id];
          return (
            <li key={c.id}>
              <button
                type="button"
                className={cn('flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors', isToday ? 'bg-brand-soft hover:bg-brand-soft/70' : 'hover:bg-well')}
                title={`Open ${c.code}: assignments, grades, dates, files`}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => open({ kind: 'course', courseId: c.id })}
              >
                <GradeRing course={c} percent={grade?.current} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[13.5px] font-semibold">{c.code}</span>
                    {wide && c.name && <span className="truncate text-xs text-ter">{c.name}</span>}
                  </div>
                  {next ? (
                    <div className="mt-px truncate text-xs text-sub">
                      {next.title} · <span className={cn('font-medium', (isToday || (next.dueAt && new Date(next.dueAt) < now)) ? 'text-critical' : 'text-sub')}>{isToday ? `due ${next.dueAt ? format(new Date(next.dueAt), 'h:mm a') : 'today'}` : friendlyDate(next.dueAt, { withTime: false })}</span>
                    </div>
                  ) : (
                    <div className="mt-px text-xs text-ter">{itemsQ.isPending ? '…' : 'Nothing due in 3 weeks'}</div>
                  )}
                  {list.length > 1 ? (
                    <div className="mt-px text-[11.5px] text-ter">+{list.length - 1} more upcoming</div>
                  ) : meeting && wide ? (
                    <div className="mt-px truncate text-[11.5px] text-ter">{meetingLabel(meeting.kind)} {meeting.label}</div>
                  ) : null}
                </div>
                <ChevronRight className="size-3.5 shrink-0 text-ter" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
