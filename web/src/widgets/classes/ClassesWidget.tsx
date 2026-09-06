import { useMemo } from 'react';
import { Link } from 'react-router';
import { useCourses, useItems } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { EmptyState, ErrorState } from '@/widgets/Placeholder';
import type { WidgetProps } from '@/widgets/types';
import { CourseDot, DueLabel, HotLinks, StatusBadge, nextMeeting, windowFromNow } from '@/widgets/shared';

/** One row per course: next due, hotlinks, upcoming count. */
export function ClassesWidget({ size }: WidgetProps) {
  const coursesQ = useCourses();
  const win = useMemo(() => windowFromNow(21), []);
  const itemsQ = useItems({ kind: ['assignment'], from: win.from, to: win.to, limit: 500 });

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
            const meeting = nextMeeting(c.schedule);
            return (
              <tr key={c.id} className="border-b last:border-0">
                <td className="w-0 whitespace-nowrap py-1.5 pl-3 pr-2 align-top">
                  <div className="flex items-center gap-2">
                    <CourseDot color={c.color} />
                    <span className="font-medium">{c.code}</span>
                    {c.role === 'ta' && <span className="rounded bg-secondary px-1 text-[10px] uppercase text-muted-foreground">TA</span>}
                  </div>
                  {!compact && c.name && <div className="max-w-[16rem] truncate pl-4 text-xs text-muted-foreground">{c.name}</div>}
                </td>
                <td className="py-1.5 pr-2 align-top">
                  {next ? (
                    <a href={next.url ?? '#'} target="_blank" rel="noreferrer" className="flex items-center gap-2 hover:underline">
                      <span className="truncate">{next.title}</span>
                      <StatusBadge item={next} />
                      <DueLabel item={next} className="shrink-0 text-xs" />
                    </a>
                  ) : (
                    <span className="text-xs text-muted-foreground">nothing due in 3 weeks</span>
                  )}
                  {list.length > 1 && <div className="text-xs text-muted-foreground">+{list.length - 1} more upcoming</div>}
                </td>
                {!compact && (
                  <td className={cn('py-1.5 pr-3 align-top', size.tier === 'md' ? 'max-w-[14rem]' : 'max-w-[24rem]')}>
                    <HotLinks links={c.links} compact />
                    {meeting && <div className="mt-0.5 text-xs text-muted-foreground">{meeting.kind === 'discussion' ? 'Discussion' : meeting.kind === 'office_hours' ? 'Office hours' : 'Lecture'} {meeting.label}</div>}
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
