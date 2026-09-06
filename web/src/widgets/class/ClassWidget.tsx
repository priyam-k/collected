import { useMemo } from 'react';
import { Link } from 'react-router';
import { FileText, Megaphone } from 'lucide-react';
import { useCourseContent, useCourses, useItems } from '@/lib/queries';
import { friendlyDate } from '@/lib/time';
import { EmptyState } from '@/widgets/Placeholder';
import type { WidgetProps } from '@/widgets/types';
import { HotLinks, ItemRow, nextMeeting, windowFromNow } from '@/widgets/shared';

export interface ClassWidgetConfig {
  courseId?: string;
  courseCode?: string;
}

export function ClassWidget({ instance, size }: WidgetProps<ClassWidgetConfig>) {
  const courseId = instance.config.courseId;
  const coursesQ = useCourses();
  const course = coursesQ.data?.find((c) => c.id === courseId);
  const win = useMemo(() => windowFromNow(14), []);
  const upcoming = useItems({ kind: ['assignment'], course: courseId, from: win.from, to: win.to, limit: 50 }, !!courseId);
  const announcements = useItems({ kind: ['announcement'], course: courseId, limit: 5 }, !!courseId && size.tier !== 'xs' && size.tier !== 'sm');
  const content = useCourseContent(courseId);

  if (!courseId) return <EmptyState>This widget has no course. Remove it and add it again from the tray.</EmptyState>;
  if (coursesQ.isSuccess && !course)
    return (
      <EmptyState>
        Course not found. <Link className="underline" to="/settings/courses">Check settings.</Link>
      </EmptyState>
    );
  if (!course) return null;

  const meeting = nextMeeting(course.schedule);
  const files = (content.data ?? []).filter((r) => r.kind === 'file').slice(0, 5);
  const syllabus = (content.data ?? []).find((r) => r.kind === 'syllabus');
  const isTa = course.role === 'ta';
  const showAnnouncements = size.tier !== 'xs' && size.tier !== 'sm';
  const showContent = size.tier === 'lg' || size.tier === 'md' || size.aspect === 'tall';

  return (
    <div className="flex h-full flex-col gap-2 overflow-auto p-2.5 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        {course.name && size.tier !== 'xs' && <span className="truncate text-muted-foreground">{course.name}</span>}
        {meeting && (
          <span className="text-xs text-muted-foreground">
            {isTa && meeting.kind === 'discussion' ? 'Your discussion' : meeting.kind === 'office_hours' ? 'Office hours' : 'Next'} · {meeting.label}
          </span>
        )}
      </div>
      {(course.links.length > 0 || syllabus) && (
        <HotLinks links={[...(syllabus?.url ? [{ label: 'Syllabus', url: syllabus.url }] : []), ...course.links]} compact={size.tier === 'xs'} />
      )}

      <section>
        <h4 className="mb-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{isTa ? 'Course assignments' : 'Up next'}</h4>
        {upcoming.isPending ? (
          <div className="h-8 animate-pulse rounded bg-muted/40" />
        ) : upcoming.data?.length ? (
          <div className="-mx-1">{upcoming.data.slice(0, size.tier === 'xs' ? 3 : 8).map((it) => <ItemRow key={it.id} item={it} />)}</div>
        ) : (
          <p className="text-xs text-muted-foreground">Nothing due in the next two weeks.</p>
        )}
      </section>

      {showAnnouncements && announcements.data && announcements.data.length > 0 && (
        <section>
          <h4 className="mb-0.5 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <Megaphone className="size-3" /> Announcements
          </h4>
          <ul className="space-y-0.5">
            {announcements.data
              .slice()
              .sort((a, b) => (b.startsAt ?? '').localeCompare(a.startsAt ?? ''))
              .slice(0, 3)
              .map((a) => (
                <li key={a.id} className="flex items-baseline gap-2">
                  <a href={a.url ?? '#'} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:underline">
                    {a.title}
                  </a>
                  <span className="shrink-0 text-xs text-muted-foreground">{friendlyDate(a.startsAt)}</span>
                </li>
              ))}
          </ul>
        </section>
      )}

      {showContent && files.length > 0 && (
        <section>
          <h4 className="mb-0.5 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <FileText className="size-3" /> Recent files
          </h4>
          <ul className="space-y-0.5">
            {files.map((f) => (
              <li key={f.id} className="flex items-baseline gap-2">
                <a href={f.url ?? '#'} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:underline">
                  {f.title}
                </a>
                <span className="shrink-0 text-xs text-muted-foreground">{friendlyDate(String(f.raw.updatedAt ?? f.updatedAt))}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
