import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { CalendarDays, ChevronDown, ChevronRight, ClipboardCheck, Download, ExternalLink, FileText, Link2, Megaphone, Percent, Settings } from 'lucide-react';
import type { Course, CourseLink, EffectiveItem, Meeting } from '@collected/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { canvasFileUrl, canvasOrigin } from '@/lib/canvas';
import { useCourseContent, useCourseGrades, useCourses, useItems, type CourseContentRow } from '@/lib/queries';
import { friendlyDate, isPast } from '@/lib/time';
import { cn } from '@/lib/utils';
import { CourseDot, DueLabel, HotLinks, ItemRow, StatusBadge, manualRaw, meetingExceptions, nextMeeting } from '@/widgets/shared';
import { ItemPopover } from '@/widgets/ItemPopover';
import { CourseDates } from './CourseDates';
import { CourseGrades } from './CourseGrades';

const DAY_LABEL: Record<Meeting['day'], string> = { sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat' };
const KIND_LABEL: Record<string, string> = { lecture: 'Lecture', discussion: 'Discussion', office_hours: 'Office hours' };

function fmtTime(t: string): string {
  const [h, m] = t.split(':').map(Number);
  const d = new Date();
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: m ? '2-digit' : undefined });
}

const fmtSize = (n: unknown): string => {
  const b = Number(n);
  if (!Number.isFinite(b) || b <= 0) return '';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
};

const dueMs = (a: EffectiveItem) => (a.dueAt ? new Date(a.dueAt).getTime() : Infinity);

function Section({ title, icon, action, children }: { title: string; icon?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-1">
      <h4 className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {icon} {title} {action && <span className="ml-auto normal-case tracking-normal">{action}</span>}
      </h4>
      {children}
    </section>
  );
}

const Empty = ({ children }: { children: ReactNode }) => <p className="px-1 py-1 text-xs text-muted-foreground/80">{children}</p>;

/** Module tree, in Canvas order. File items open inline through the server; everything else goes to Canvas. */
function Modules({ rows }: { rows: CourseContentRow[] }) {
  const groups = useMemo(() => {
    const m = new Map<string, CourseContentRow[]>();
    for (const r of rows.slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0))) m.set(r.moduleName ?? 'Module', [...(m.get(r.moduleName ?? 'Module') ?? []), r]);
    return [...m.entries()];
  }, [rows]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  if (!groups.length) return <Empty>No modules synced.</Empty>;
  return (
    <ul className="space-y-1">
      {groups.map(([name, items]) => {
        const closed = collapsed.has(name);
        return (
          <li key={name}>
            <button
              className="flex w-full items-center gap-1 rounded px-1 py-1 text-left text-sm font-medium hover:bg-accent/60"
              onClick={() => setCollapsed((s) => { const n = new Set(s); n.has(name) ? n.delete(name) : n.add(name); return n; })}
            >
              {closed ? <ChevronRight className="size-3.5 text-muted-foreground" /> : <ChevronDown className="size-3.5 text-muted-foreground" />}
              <span className="min-w-0 flex-1 truncate">{name}</span>
              <span className="text-xs font-normal text-muted-foreground">{items.length}</span>
            </button>
            {!closed && (
              <ul className="ml-2 border-l pl-2">
                {items.map((it) => {
                  const raw = it.raw as { type?: string; indent?: number; contentId?: string | number | null };
                  const isFile = raw.type === 'File' && raw.contentId != null;
                  const href = isFile ? canvasFileUrl(String(raw.contentId)) : (it.url ?? '#');
                  const Icon = raw.type === 'ExternalUrl' || raw.type === 'ExternalTool' ? Link2 : raw.type === 'Assignment' || raw.type === 'Quiz' ? ClipboardCheck : FileText;
                  return (
                    <li key={it.id} className="group/row flex items-center gap-1.5 rounded px-1 py-0.5 text-sm hover:bg-accent/60" style={{ paddingLeft: 4 + (raw.indent ?? 0) * 14 }}>
                      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                      <a href={href} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:underline" title={isFile ? 'Open (PDFs render inline)' : 'Open in Canvas'}>
                        {it.title}
                      </a>
                      {isFile && (
                        <a href={canvasFileUrl(String(raw.contentId), { download: true })} className="shrink-0 text-muted-foreground opacity-0 group-hover/row:opacity-100" title="Download" aria-label={`Download ${it.title}`}>
                          <Download className="size-3" />
                        </a>
                      )}
                      <span className="shrink-0 text-[10px] uppercase text-muted-foreground/70">{raw.type === 'ExternalUrl' ? 'link' : (raw.type ?? '').toLowerCase()}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function FileList({ rows, limit }: { rows: CourseContentRow[]; limit?: number }) {
  if (!rows.length) return <Empty>No files synced.</Empty>;
  return (
    <ul className="space-y-0.5">
      {rows.slice(0, limit ?? rows.length).map((f) => (
        <li key={f.id} className="group/row flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-accent/60">
          <FileText className="size-3.5 shrink-0 text-muted-foreground" />
          <a href={canvasFileUrl(f.externalId)} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:underline" title="Open in a new tab (PDFs render inline)">
            {f.title}
          </a>
          <a href={canvasFileUrl(f.externalId, { download: true })} className="shrink-0 text-muted-foreground opacity-0 group-hover/row:opacity-100" title="Download" aria-label={`Download ${f.title}`}>
            <Download className="size-3" />
          </a>
          <span className="shrink-0 text-xs text-muted-foreground">{fmtSize(f.raw.size)}</span>
          <span className="w-16 shrink-0 text-right text-xs text-muted-foreground">{friendlyDate(String(f.raw.updatedAt ?? f.updatedAt))}</span>
        </li>
      ))}
    </ul>
  );
}

function Announcement({ item, defaultOpen }: { item: EffectiveItem; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <li className="rounded border">
      <button className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-accent/60" onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />}
        <span className="min-w-0 flex-1 truncate font-medium">{item.title}</span>
        <span className="shrink-0 text-xs text-muted-foreground">{friendlyDate(item.startsAt)}</span>
      </button>
      {open && (
        <div className="border-t px-3 py-2 text-xs leading-relaxed">
          {item.description ? <p className="whitespace-pre-wrap text-muted-foreground">{item.description}</p> : <p className="text-muted-foreground/70">No text (open in Canvas).</p>}
          {item.url && (
            <a href={item.url} target="_blank" rel="noreferrer" className="mt-1.5 inline-flex items-center gap-1 underline underline-offset-2">
              Open in Canvas <ExternalLink className="size-3" />
            </a>
          )}
        </div>
      )}
    </li>
  );
}

function ScheduleList({ course }: { course: Course }) {
  const next = nextMeeting(course.schedule);
  const rows: { kind: string; m: Meeting }[] = [];
  for (const [kind, list] of Object.entries(course.schedule) as [string, Meeting[] | undefined][]) for (const m of list ?? []) rows.push({ kind, m });
  if (!rows.length) return <Empty>No schedule. <Link to="/settings/courses" className="underline">Add one in settings.</Link></Empty>;
  return (
    <ul className="space-y-0.5 text-sm">
      {rows.map(({ kind, m }, i) => {
        const label = `${DAY_LABEL[m.day]} ${fmtTime(m.start)}–${fmtTime(m.end)}${m.location ? ` · ${m.location}` : ''}`;
        const isNext = next?.kind === kind && next.label === label;
        return (
          <li key={i} className={cn('flex items-center gap-2 rounded px-1 py-0.5', isNext && 'bg-accent/60')}>
            <span className="w-24 shrink-0 text-xs text-muted-foreground">{KIND_LABEL[kind] ?? kind}</span>
            <span className="min-w-0 flex-1 truncate">{label}</span>
            {isNext && <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">next</span>}
          </li>
        );
      })}
    </ul>
  );
}

function GradingList({ rows }: { rows: CourseContentRow[] }) {
  if (!rows.length) return <Empty>Nothing in the grading queue.</Empty>;
  return (
    <ul className="space-y-1">
      {rows.map((g) => {
        const raw = g.raw as { gradingProgress?: number; submissions?: number; openRegradeRequests?: number; published?: boolean };
        const pct = Math.round(raw.gradingProgress ?? 0);
        return (
          <li key={g.id} className="text-sm">
            <div className="flex items-center gap-2">
              <a href={g.url ?? '#'} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:underline">{g.title}</a>
              <span className="text-xs text-muted-foreground">{raw.submissions ?? 0} subs · {pct}%{raw.openRegradeRequests ? ` · ${raw.openRegradeRequests} regrades` : ''}{raw.published ? '' : ' · unpublished'}</span>
            </div>
            <div className="mt-0.5 h-1 w-full overflow-hidden rounded bg-muted"><div className="h-full rounded bg-primary/70" style={{ width: `${pct}%` }} /></div>
          </li>
        );
      })}
    </ul>
  );
}

/** The whole course in one place: schedule, links, every assignment, modules and files, announcements, syllabus. */
export function CoursePane({ courseId, initialTab }: { courseId: string; initialTab?: string }) {
  const coursesQ = useCourses();
  const course = coursesQ.data?.find((c) => c.id === courseId);
  const assignmentsQ = useItems({ kind: ['assignment'], course: courseId, includeDone: true, includeInformational: true, limit: 500 });
  const announcementsQ = useItems({ kind: ['announcement'], course: courseId, limit: 50 });
  const manualQ = useItems({ kind: ['event'], source: ['manual'], course: courseId, limit: 300, includeDone: true });
  const contentQ = useCourseContent(courseId);
  const gradesQ = useCourseGrades(courseId);
  const [tab, setTab] = useState(initialTab ?? 'overview');

  const assignments = useMemo(() => (assignmentsQ.data ?? []).slice().sort((a, b) => dueMs(a) - dueMs(b)), [assignmentsQ.data]);
  const announcements = useMemo(() => (announcementsQ.data ?? []).slice().sort((a, b) => (b.startsAt ?? '').localeCompare(a.startsAt ?? '')), [announcementsQ.data]);
  const content = contentQ.data ?? [];
  const files = useMemo(() => content.filter((r) => r.kind === 'file').slice().sort((a, b) => String(b.raw.updatedAt ?? '').localeCompare(String(a.raw.updatedAt ?? ''))), [content]);
  const moduleItems = content.filter((r) => r.kind === 'module_item');
  const syllabus = content.find((r) => r.kind === 'syllabus');
  const grading = content.filter((r) => r.kind === 'grading');

  if (!course) {
    return (
      <SheetHeader>
        <SheetTitle>Course</SheetTitle>
        <SheetDescription>{coursesQ.isPending ? 'Loading…' : 'Course not found.'}</SheetDescription>
      </SheetHeader>
    );
  }

  const isTa = course.role === 'ta';
  const origin = canvasOrigin([...assignments.map((a) => a.url), syllabus?.url, ...files.map((f) => f.url)]);
  const links: CourseLink[] = [
    ...(course.canvasCourseId ? [{ label: 'Canvas', url: `${origin}/courses/${course.canvasCourseId}` }] : []),
    ...(course.gradescopeCourseId ? [{ label: 'Gradescope', url: `https://www.gradescope.com/courses/${course.gradescopeCourseId}` }] : []),
    ...(syllabus?.url ? [{ label: 'Syllabus', url: syllabus.url }] : []),
    ...course.links,
  ];
  // Students: what's left vs done. TA: the course's assignments by date, since done state is meaningless.
  const first = isTa ? assignments.filter((a) => !a.dueAt || !isPast(a.dueAt)) : assignments.filter((a) => !a.effectiveDone);
  const second = isTa ? assignments.filter((a) => a.dueAt && isPast(a.dueAt)).reverse() : assignments.filter((a) => a.effectiveDone).slice().sort((a, b) => dueMs(b) - dueMs(a));
  const [firstLabel, secondLabel] = isTa ? ['Upcoming', 'Past'] : ['To do', 'Done'];
  const manualEvents = manualQ.data ?? [];
  const meeting = nextMeeting(course.schedule, meetingExceptions(manualEvents));
  const todayKey = new Date().toLocaleDateString('en-CA');
  const upcomingDates = manualEvents
    .filter((it) => { const r = manualRaw(it); return r && r.date >= todayKey && r.eventKind !== 'cancelled' && r.eventKind !== 'virtual'; })
    .sort((a, b) => manualRaw(a)!.date.localeCompare(manualRaw(b)!.date))
    .slice(0, 4);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SheetHeader className="border-b pb-3">
        <div className="flex items-center gap-2 pr-8">
          <CourseDot color={course.color} className="size-3" />
          <SheetTitle className="text-base">
            {course.code}
            {course.section && <span className="font-normal text-muted-foreground"> · {course.section}</span>}
          </SheetTitle>
          {isTa && <Badge variant="secondary" className="h-5 px-1.5 text-[10px] uppercase">TA</Badge>}
          <Button asChild size="icon-xs" variant="ghost" className="ml-auto" title="Course settings">
            <Link to="/settings/courses"><Settings className="size-3.5" /></Link>
          </Button>
        </div>
        <SheetDescription>
          {course.name ?? course.term}
          {meeting && <span className="ml-2 text-xs">Next: {KIND_LABEL[meeting.kind] ?? meeting.kind} {meeting.label}</span>}
        </SheetDescription>
        {links.length > 0 && <HotLinks links={links} />}
      </SheetHeader>

      <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1 gap-0">
        <TabsList variant="line" className="w-full justify-start overflow-x-auto border-b px-2">
          <TabsTrigger value="overview" className="flex-none">Overview</TabsTrigger>
          <TabsTrigger value="assignments" className="flex-none">Assignments <span className="text-muted-foreground">{assignments.length}</span></TabsTrigger>
          {!isTa && <TabsTrigger value="grades" className="flex-none">Grades{gradesQ.data?.current != null && <span className="text-muted-foreground">{gradesQ.data.current.toFixed(1)}%</span>}</TabsTrigger>}
          <TabsTrigger value="dates" className="flex-none">Dates <span className="text-muted-foreground">{manualEvents.length}</span></TabsTrigger>
          <TabsTrigger value="files" className="flex-none">Files <span className="text-muted-foreground">{files.length + moduleItems.length}</span></TabsTrigger>
          <TabsTrigger value="announcements" className="flex-none">Announcements <span className="text-muted-foreground">{announcements.length}</span></TabsTrigger>
          {syllabus && <TabsTrigger value="syllabus" className="flex-none">Syllabus</TabsTrigger>}
        </TabsList>
        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          <TabsContent value="overview" className="space-y-4">
            <Section title="Schedule"><ScheduleList course={course} /></Section>
            <Section title={isTa ? 'Upcoming' : 'To do'} icon={<ClipboardCheck className="size-3" />} action={<button className="text-xs text-muted-foreground hover:underline" onClick={() => setTab('assignments')}>all</button>}>
              {assignmentsQ.isPending ? <div className="h-8 animate-pulse rounded bg-muted/40" /> : first.length ? <div className="-mx-1">{first.slice(0, 6).map((it) => <ItemRow key={it.id} item={it} />)}</div> : <Empty>{isTa ? 'Nothing coming up.' : 'Nothing left. Nice.'}</Empty>}
            </Section>
            {isTa && <Section title="Grading" icon={<ClipboardCheck className="size-3" />}><GradingList rows={grading} /></Section>}
            {!isTa && (
              <Section title="Grade" icon={<Percent className="size-3" />} action={<button className="text-xs text-muted-foreground hover:underline" onClick={() => setTab('grades')}>details</button>}>
                {gradesQ.data ? (
                  <div className="flex flex-wrap items-baseline gap-x-3 px-1 text-sm">
                    <span className="text-xl font-semibold tabular-nums">{gradesQ.data.current == null ? '—' : `${gradesQ.data.current.toFixed(1)}%`}</span>
                    <span className="text-xs text-muted-foreground">{gradesQ.data.current == null ? 'nothing graded yet' : gradesQ.data.weighted ? 'weighted' : 'by points'} · {gradesQ.data.graded} of {gradesQ.data.total} graded</span>
                    {gradesQ.data.categories.filter((c) => c.percent != null).slice(0, 4).map((c) => (
                      <span key={c.id} className="text-xs text-muted-foreground">{c.name} <span className="tabular-nums text-foreground">{c.percent!.toFixed(0)}%</span></span>
                    ))}
                  </div>
                ) : <div className="h-6 animate-pulse rounded bg-muted/40" />}
              </Section>
            )}
            <Section title="Dates" icon={<CalendarDays className="size-3" />} action={<button className="text-xs text-muted-foreground hover:underline" onClick={() => setTab('dates')}>all</button>}>
              {upcomingDates.length ? (
                <ul className="space-y-0.5">
                  {upcomingDates.map((it) => {
                    const r = manualRaw(it)!;
                    return (
                      <li key={it.id}>
                        <ItemPopover item={it}>
                          <span className="flex items-baseline gap-2 rounded px-1 py-0.5 text-sm hover:bg-accent/60">
                            <span className="w-16 shrink-0 text-xs text-muted-foreground">{friendlyDate(`${r.date}T12:00:00`)}</span>
                            <span className="min-w-0 flex-1 truncate">{it.title}</span>
                            {r.start && <span className="shrink-0 text-xs text-muted-foreground">{r.start}</span>}
                          </span>
                        </ItemPopover>
                      </li>
                    );
                  })}
                </ul>
              ) : <Empty>No exam or quiz dates yet. <button className="underline" onClick={() => setTab('dates')}>Add some.</button></Empty>}
            </Section>
            <Section title="Announcements" icon={<Megaphone className="size-3" />} action={<button className="text-xs text-muted-foreground hover:underline" onClick={() => setTab('announcements')}>all</button>}>
              {announcements.length ? (
                <ul className="space-y-0.5">
                  {announcements.slice(0, 3).map((a) => (
                    <li key={a.id}>
                      <ItemPopover item={a}>
                        <span className="flex items-baseline gap-2 rounded px-1 py-0.5 text-sm hover:bg-accent/60">
                          <span className="min-w-0 flex-1 truncate">{a.title}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">{friendlyDate(a.startsAt)}</span>
                        </span>
                      </ItemPopover>
                    </li>
                  ))}
                </ul>
              ) : <Empty>No recent announcements.</Empty>}
            </Section>
            <Section title="Recent files" icon={<FileText className="size-3" />} action={<button className="text-xs text-muted-foreground hover:underline" onClick={() => setTab('files')}>all</button>}>
              <FileList rows={files} limit={5} />
            </Section>
            {course.notes && <Section title="Notes"><p className="whitespace-pre-wrap px-1 text-sm text-muted-foreground">{course.notes}</p></Section>}
          </TabsContent>

          <TabsContent value="assignments" className="space-y-4">
            <Section title={`${firstLabel} · ${first.length}`}>
              {first.length ? <div className="-mx-1">{first.map((it) => <AssignmentRow key={it.id} item={it} />)}</div> : <Empty>Nothing here.</Empty>}
            </Section>
            <Section title={`${secondLabel} · ${second.length}`}>
              {second.length ? <div className="-mx-1 opacity-80">{second.map((it) => <AssignmentRow key={it.id} item={it} />)}</div> : <Empty>Nothing here.</Empty>}
            </Section>
          </TabsContent>

          {!isTa && <TabsContent value="grades"><CourseGrades course={course} /></TabsContent>}
          <TabsContent value="dates"><CourseDates course={course} assignments={assignments} /></TabsContent>

          <TabsContent value="files" className="space-y-4">
            <Section title="Modules">{contentQ.isPending ? <div className="h-8 animate-pulse rounded bg-muted/40" /> : <Modules rows={moduleItems} />}</Section>
            <Section title={`Files · ${files.length}`}><FileList rows={files} /></Section>
          </TabsContent>

          <TabsContent value="announcements">
            {announcements.length ? <ul className="space-y-1.5">{announcements.map((a, i) => <Announcement key={a.id} item={a} defaultOpen={i === 0} />)}</ul> : <Empty>No announcements in the last month.</Empty>}
          </TabsContent>

          {syllabus && (
            <TabsContent value="syllabus" className="space-y-2">
              {syllabus.url && (
                <a href={syllabus.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs underline underline-offset-2">
                  Open in Canvas <ExternalLink className="size-3" />
                </a>
              )}
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{String(syllabus.raw.text ?? '')}</p>
            </TabsContent>
          )}
        </div>
      </Tabs>
    </div>
  );
}

function AssignmentRow({ item }: { item: EffectiveItem }) {
  return (
    <ItemPopover item={item}>
      <span className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-accent/60">
        <span className={cn('min-w-0 flex-1 truncate', item.effectiveDone && 'line-through opacity-70')}>{item.title}</span>
        {item.points != null && <span className="shrink-0 text-xs text-muted-foreground">{item.score != null ? `${item.score}/` : ''}{item.points}</span>}
        <StatusBadge item={item} />
        <DueLabel item={item} className="w-28 shrink-0 text-right text-xs" />
      </span>
    </ItemPopover>
  );
}
