import { useMemo } from 'react';
import { Link } from 'react-router';
import { ChevronRight } from 'lucide-react';
import { meetingLabel } from '@collected/shared';
import { useCourses, useGradesSummary, useItems } from '@/lib/queries';
import { usePane } from '@/panes/PaneContext';
import { cn } from '@/lib/utils';
import { EmptyState, ErrorState } from '@/widgets/Placeholder';
import type { WidgetProps } from '@/widgets/types';
import { ItemPopover } from '@/widgets/ItemPopover';
import { CourseDot, DueLabel, HotLinks, StatusBadge, meetingExceptions, nextMeeting, windowFromNow } from '@/widgets/shared';

/** One row per course: next due, hotlinks, upcoming count. */
export function ClassesWidget({ size }: WidgetProps) {
  const coursesQ = useCourses();
  const { open } = usePane();
  const win = useMemo(() => windowFromNow(21), []);
  const itemsQ = useItems({ kind: ['assignment'], from: win.from, to: win.to, limit: 500 });
  const manualQ = useItems({ kind: ['event'], source: ['manual'], from: win.from, to: win.to, limit: 200 });
  const gradesQ = useGradesSummary();

  if (coursesQ.isError) return <ErrorState error={coursesQ.error} onRetry={() => coursesQ.refetch()} />;
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
  const compact = size.tier === 'xs' || size.tier === 'sm';

  return (
    <div className="h-full overflow-auto">
      <table className="w-full text-sm">
        <tbody>
          {courses.map((c) => {
            const list = byCourse.get(c.id) ?? [];
            const next = list[0];
            const meeting = nextMeeting(c.schedule, meetingExceptions((manualQ.data ?? []).filter((it) => it.courseId === c.id)));
            return (
              <tr key={c.id} className="border-b last:border-0">
                <td className="w-0 whitespace-nowrap py-1 pl-1.5 pr-2 align-top">
                  <button
                    className="group/course block w-full rounded px-1.5 py-0.5 text-left hover:bg-accent/60"
                    title={`Open ${c.code}: assignments, files, announcements`}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => open({ kind: 'course', courseId: c.id })}
                  >
                    <div className="flex items-center gap-2">
                      <CourseDot color={c.color} />
                      <span className="font-medium">{c.code}</span>
                      {c.role === 'ta' && <span className="rounded bg-secondary px-1 text-[10px] uppercase text-muted-foreground">TA</span>}
                      {gradesQ.data?.[c.id]?.current != null && (
                        <span className="rounded bg-secondary px-1 text-[10px] tabular-nums text-muted-foreground" title={`Current grade (${gradesQ.data[c.id]!.weighted ? 'weighted' : 'by points'}, ${gradesQ.data[c.id]!.graded} graded)`}>
                          {gradesQ.data[c.id]!.current!.toFixed(1)}%
                        </span>
                      )}
                      <ChevronRight className="size-3 text-muted-foreground opacity-0 group-hover/course:opacity-100" />
                    </div>
                    {!compact && c.name && <div className="max-w-[16rem] truncate pl-4 text-xs text-muted-foreground">{c.name}</div>}
                  </button>
                </td>
                <td className="py-1.5 pr-2 align-top">
                  {next ? (
                    <ItemPopover item={next}>
                      <span className="flex items-center gap-2 rounded hover:bg-accent/60">
                        <span className="truncate">{next.title}</span>
                        <StatusBadge item={next} />
                        <DueLabel item={next} className="shrink-0 text-xs" />
                      </span>
                    </ItemPopover>
                  ) : (
                    <span className="text-xs text-muted-foreground">nothing due in 3 weeks</span>
                  )}
                  {list.length > 1 && <div className="text-xs text-muted-foreground">+{list.length - 1} more upcoming</div>}
                </td>
                {!compact && (
                  <td className={cn('py-1.5 pr-3 align-top', size.tier === 'md' ? 'max-w-[14rem]' : 'max-w-[24rem]')}>
                    <HotLinks links={c.links} compact />
                    {meeting && <div className="mt-0.5 text-xs text-muted-foreground">{meetingLabel(meeting.kind)} {meeting.label}</div>}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
