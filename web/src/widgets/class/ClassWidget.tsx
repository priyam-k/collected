import { useMemo } from 'react';
import { Link } from 'react-router';
import { ClipboardCheck, Download, FileText, Maximize2, Megaphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WidgetHeader } from '@/dashboard/WidgetHeader';
import { usePane } from '@/panes/PaneContext';
import { canvasFileUrl } from '@/lib/canvas';
import { FileLink } from '@/widgets/FileLink';
import { meetingLabel } from '@collected/shared';
import { useCourseContent, useCourses, useItems } from '@/lib/queries';
import { friendlyDate } from '@/lib/time';
import { safeHref } from '@/lib/url';
import { EmptyState, ErrorState, ListSkeleton } from '@/widgets/Placeholder';
import { Meter } from '@/widgets/instruments';
import { useNow } from '@/widgets/useNow';
import type { WidgetProps } from '@/widgets/types';
import { ItemPopover } from '@/widgets/ItemPopover';
import { cn } from '@/lib/utils';
import { HOVER_REVEAL, HotLinks, ItemRow, meetingExceptions, nextMeeting, windowFromNow } from '@/widgets/shared';

const FILES_SHOWN = 5;
const ANNOUNCEMENTS_SHOWN = 3;

/** A section eyebrow with an optional "All …" action that opens the course pane on the full list. */
function SectionHead({ icon, children, action }: { icon?: React.ReactNode; children: React.ReactNode; action?: { label: string; onClick(): void } }) {
  return (
    <h4 className="label mb-1 flex items-center gap-1 px-1 !text-ter">
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {action && (
        <button type="button" className="shrink-0 rounded-md px-1 text-[11.5px] font-medium normal-case tracking-normal text-sub [font-stretch:100%] transition-colors hover:text-ink" onMouseDown={(e) => e.stopPropagation()} onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </h4>
  );
}

export interface ClassWidgetConfig {
  courseId?: string;
  courseCode?: string;
}

export function ClassWidget({ instance, size }: WidgetProps<ClassWidgetConfig>) {
  const courseId = instance.config.courseId;
  const { open } = usePane();
  const coursesQ = useCourses();
  const course = coursesQ.data?.find((c) => c.id === courseId);
  const win = useMemo(() => windowFromNow(14), []);
  const upcoming = useItems({ kind: ['assignment'], course: courseId, from: win.from, to: win.to, limit: 50, includeInformational: true }, !!courseId);
  const announcements = useItems({ kind: ['announcement'], course: courseId, limit: 5 }, !!courseId && size.tier !== 'xs' && size.tier !== 'sm');
  const content = useCourseContent(courseId);
  const manual = useItems({ kind: ['event'], source: ['manual'], course: courseId, from: win.from, to: win.to, limit: 50 }, !!courseId);
  const now = useNow(60_000);

  if (!courseId) return <EmptyState>This widget has no course. Remove it and add it again from the tray.</EmptyState>;
  if (coursesQ.isSuccess && !course)
    return (
      <EmptyState>
        Course not found. <Link className="underline" to="/settings/courses">Check settings.</Link>
      </EmptyState>
    );
  if (coursesQ.isError) return <ErrorState error={coursesQ.error} onRetry={() => coursesQ.refetch()} />;
  if (!course) return <ListSkeleton rows={size.tier === 'xs' ? 2 : 4} />;

  const meeting = nextMeeting(course.schedule, meetingExceptions(manual.data ?? []), now);
  const allFiles = (content.data ?? []).filter((r) => r.kind === 'file');
  const files = allFiles.slice(0, FILES_SHOWN);
  const grading = (content.data ?? []).filter((r) => r.kind === 'grading');
  const syllabus = (content.data ?? []).find((r) => r.kind === 'syllabus');
  const isTa = course.role === 'ta';
  const showAnnouncements = size.tier !== 'xs' && size.tier !== 'sm';
  const showContent = size.tier === 'lg' || size.tier === 'md' || size.aspect === 'tall';

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-3 text-sm">
      <WidgetHeader>
        {meeting && size.tier !== 'xs' && (
          <span className="min-w-0 truncate text-[12.5px] text-sub" title={meeting.label}>
            {isTa && meeting.kind === 'discussion' ? 'Your discussion' : meeting.kind === 'lecture' ? 'Next' : meetingLabel(meeting.kind)} · {meeting.label}
          </span>
        )}
        <Button size="icon-xs" variant="ghost" className="shrink-0" aria-label="Open course" title="Open the course pane" onMouseDown={(e) => e.stopPropagation()} onClick={() => open({ kind: 'course', courseId: course.id })}>
          <Maximize2 className="size-3.5" />
        </Button>
      </WidgetHeader>
      {course.name && size.tier !== 'xs' && (
        <button className="truncate text-left text-[13px] text-sub hover:text-ink" title="Open the course: every assignment, module, file, and announcement" onMouseDown={(e) => e.stopPropagation()} onClick={() => open({ kind: 'course', courseId: course.id })}>
          {course.name}
        </button>
      )}
      {(course.links.length > 0 || syllabus) && (
        <HotLinks links={[...(syllabus?.url ? [{ label: 'Syllabus', url: syllabus.url }] : []), ...course.links]} compact={size.tier === 'xs'} />
      )}

      <section>
        <SectionHead>{isTa ? 'Course assignments' : 'Up next'}</SectionHead>
        {upcoming.isPending ? (
          <div className="h-8 animate-pulse rounded-xl bg-well" />
        ) : upcoming.data?.length ? (
          <div className="-mx-1">{upcoming.data.map((it) => <ItemRow key={it.id} item={it} />)}</div>
        ) : (
          <p className="px-1 text-xs text-ter">Nothing due in the next two weeks.</p>
        )}
      </section>

      {isTa && grading.length > 0 && (
        <section>
          <SectionHead icon={<ClipboardCheck className="size-3" />}>Grading</SectionHead>
          <ul className="space-y-1">
            {grading.map((g) => {
              const raw = g.raw as { gradingProgress?: number; submissions?: number; dueAt?: string | null; openRegradeRequests?: number; published?: boolean };
              const pct = Math.round(raw.gradingProgress ?? 0);
              return (
                <li key={g.id} className="text-sm">
                  <div className="flex items-center gap-2">
                    {safeHref(g.url) ? <a href={safeHref(g.url)} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:underline">{g.title}</a> : <span className="min-w-0 flex-1 truncate">{g.title}</span>}
                    <span className="text-xs text-muted-foreground">{raw.submissions ?? 0} subs · {pct}% graded{raw.openRegradeRequests ? ` · ${raw.openRegradeRequests} regrades` : ''}{raw.published ? '' : ' · unpublished'}</span>
                  </div>
                  <Meter className="mt-1" value={pct} color="var(--course, var(--brand))" height={8} />
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {showAnnouncements && announcements.data && announcements.data.length > 0 && (
        <section>
          <SectionHead icon={<Megaphone className="size-3" />} action={{ label: 'All announcements', onClick: () => open({ kind: 'course', courseId: course.id, tab: 'announcements' }) }}>
            Announcements
          </SectionHead>
          <ul className="space-y-0.5">
            {announcements.data
              .slice()
              .sort((a, b) => (b.startsAt ?? '').localeCompare(a.startsAt ?? ''))
              .slice(0, ANNOUNCEMENTS_SHOWN)
              .map((a) => (
                <li key={a.id}>
                  <ItemPopover item={a}>
                    <span className="flex items-baseline gap-2 rounded-lg px-1 py-0.5 transition-colors hover:bg-well">
                      <span className="min-w-0 flex-1 truncate">{a.title}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{friendlyDate(a.startsAt)}</span>
                    </span>
                  </ItemPopover>
                </li>
              ))}
          </ul>
        </section>
      )}

      {showContent && files.length > 0 && (
        <section>
          <SectionHead icon={<FileText className="size-3" />} action={{ label: allFiles.length > FILES_SHOWN ? `All ${allFiles.length} files` : 'All files', onClick: () => open({ kind: 'course', courseId: course.id, tab: 'files' }) }}>
            Recent files
          </SectionHead>
          <ul className="space-y-0.5">
            {files.map((f) => (
              <li key={f.id} className="group/file flex items-baseline gap-2">
                <FileLink file={{ fileId: f.externalId, title: f.title, contentType: String(f.raw.contentType ?? ''), size: Number(f.raw.size) || null }} className="min-w-0 flex-1 truncate hover:underline">
                  {f.title}
                </FileLink>
                <a href={canvasFileUrl(f.externalId, { download: true })} className={cn(HOVER_REVEAL, 'shrink-0 text-muted-foreground transition-opacity group-hover/file:opacity-100 group-focus-within/file:opacity-100')} title="Download" aria-label={`Download ${f.title}`}>
                  <Download className="size-3" />
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
