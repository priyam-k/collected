import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ChevronDown, ChevronRight, ClipboardCheck, Download, ExternalLink, FileText, Link2, Settings, X } from 'lucide-react';
import { meetingLabel, type Course, type CourseLink, type EffectiveItem, type Meeting } from '@collected/shared';
import { SheetClose, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { canvasFileUrl, canvasOrigin } from '@/lib/canvas';
import { useCourseContent, useCourseGrades, useCourses, useItems, type CourseContentRow } from '@/lib/queries';
import { friendlyDate, isPast } from '@/lib/time';
import { cn } from '@/lib/utils';
import { GradeRing } from '@/widgets/classes/ClassesWidget';
import { FileLink } from '@/widgets/FileLink';
import { ItemPopover } from '@/widgets/ItemPopover';
import { DueLabel, StatusBadge, manualRaw, meetingExceptions, nextMeeting } from '@/widgets/shared';
import { CourseDates } from './CourseDates';
import { CourseGrades } from './CourseGrades';

const DAY_LABEL: Record<Meeting['day'], string> = { sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat' };

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
/** "PDF", "ZIP", "NB" (notebook), "IMG"… for the file-type badge. */
function typeBadge(title: string): string {
  const ext = title.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  if (ext === 'ipynb') return 'NB';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'IMG';
  if (['doc', 'docx'].includes(ext)) return 'DOC';
  if (['ppt', 'pptx'].includes(ext)) return 'PPT';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return 'XLS';
  return (ext || 'FILE').toUpperCase().slice(0, 4);
}

/** Section title row with an optional right-hand action, then a well. */
function Section({ title, action, children }: { title: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="flex items-center px-1.5 pb-2">
        <span className="text-[13px] font-semibold text-sub">{title}</span>
        <span className="flex-1" />
        {action}
      </div>
      {children}
    </section>
  );
}
const Well = ({ children, className }: { children: ReactNode; className?: string }) => <div className={cn('overflow-hidden rounded-2xl bg-well', className)}>{children}</div>;
const EmptyWell = ({ children }: { children: ReactNode }) => <div className="rounded-2xl bg-well p-4 text-center text-[13px] text-ter">{children}</div>;
const More = ({ onClick, children }: { onClick(): void; children: ReactNode }) => <button className="text-[12.5px] text-indigo hover:underline" onClick={onClick}>{children}</button>;

function FileRow({ f, last }: { f: CourseContentRow; last?: boolean }) {
  return (
    <div className={cn('group/row flex items-center gap-3 px-3.5 py-[11px] transition-colors hover:bg-well2', !last && 'border-b border-line')}>
      <span className="grid size-[30px] shrink-0 place-items-center rounded-[9px] bg-card text-[9.5px] font-bold text-sub">{typeBadge(f.title)}</span>
      <FileLink file={{ fileId: f.externalId, title: f.title, contentType: String(f.raw.contentType ?? ''), size: Number(f.raw.size) || null }} className="min-w-0 flex-1 truncate text-[13.5px]">
        {f.title}
      </FileLink>
      <a href={canvasFileUrl(f.externalId, { download: true })} className="shrink-0 text-ter opacity-0 transition-opacity hover:text-ink group-hover/row:opacity-100" title="Download" aria-label={`Download ${f.title}`}>
        <Download className="size-3.5" />
      </a>
      <span className="shrink-0 text-xs text-ter">{fmtSize(f.raw.size)}</span>
      <span className="w-14 shrink-0 text-right text-xs text-ter">{friendlyDate(String(f.raw.updatedAt ?? f.updatedAt))}</span>
    </div>
  );
}

function FileList({ rows, limit }: { rows: CourseContentRow[]; limit?: number }) {
  if (!rows.length) return <EmptyWell>No files synced.</EmptyWell>;
  const shown = rows.slice(0, limit ?? rows.length);
  return <Well>{shown.map((f, i) => <FileRow key={f.id} f={f} last={i === shown.length - 1} />)}</Well>;
}

/** Module tree, in Canvas order. File items preview in place; everything else goes to Canvas. */
function Modules({ rows }: { rows: CourseContentRow[] }) {
  const groups = useMemo(() => {
    const m = new Map<string, CourseContentRow[]>();
    for (const r of rows.slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0))) m.set(r.moduleName ?? 'Module', [...(m.get(r.moduleName ?? 'Module') ?? []), r]);
    return [...m.entries()];
  }, [rows]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  if (!groups.length) return <EmptyWell>No modules synced.</EmptyWell>;
  return (
    <div className="space-y-2">
      {groups.map(([name, items]) => {
        const closed = collapsed.has(name);
        return (
          <Well key={name}>
            <button
              className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-[13.5px] font-semibold transition-colors hover:bg-well2"
              onClick={() => setCollapsed((s) => { const n = new Set(s); n.has(name) ? n.delete(name) : n.add(name); return n; })}
            >
              {closed ? <ChevronRight className="size-3.5 text-ter" /> : <ChevronDown className="size-3.5 text-ter" />}
              <span className="min-w-0 flex-1 truncate">{name}</span>
              <span className="text-xs font-normal text-ter">{items.length}</span>
            </button>
            {!closed && (
              <div className="border-t border-line">
                {items.map((it, i) => {
                  const raw = it.raw as { type?: string; indent?: number; contentId?: string | number | null };
                  const isFile = raw.type === 'File' && raw.contentId != null;
                  const Icon = raw.type === 'ExternalUrl' || raw.type === 'ExternalTool' ? Link2 : raw.type === 'Assignment' || raw.type === 'Quiz' ? ClipboardCheck : FileText;
                  return (
                    <div key={it.id} className={cn('group/row flex items-center gap-2.5 px-3.5 py-2 text-[13px] transition-colors hover:bg-well2', i < items.length - 1 && 'border-b border-line')} style={{ paddingLeft: 14 + (raw.indent ?? 0) * 14 }}>
                      <Icon className="size-3.5 shrink-0 text-ter" />
                      {isFile ? (
                        <FileLink file={{ fileId: String(raw.contentId), title: it.title }} className="min-w-0 flex-1 truncate">{it.title}</FileLink>
                      ) : (
                        <a href={it.url ?? '#'} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate" title="Open in Canvas">{it.title}</a>
                      )}
                      {isFile && (
                        <a href={canvasFileUrl(String(raw.contentId), { download: true })} className="shrink-0 text-ter opacity-0 transition-opacity hover:text-ink group-hover/row:opacity-100" title="Download" aria-label={`Download ${it.title}`}>
                          <Download className="size-3.5" />
                        </a>
                      )}
                      <span className="shrink-0 text-[10px] uppercase text-ter/70">{raw.type === 'ExternalUrl' ? 'link' : (raw.type ?? '').toLowerCase()}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </Well>
        );
      })}
    </div>
  );
}

function Announcement({ item, defaultOpen, last }: { item: EffectiveItem; defaultOpen?: boolean; last?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className={cn(!last && 'border-b border-line')}>
      <button className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-[13.5px] transition-colors hover:bg-well2" onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown className="size-3.5 shrink-0 text-ter" /> : <ChevronRight className="size-3.5 shrink-0 text-ter" />}
        <span className="min-w-0 flex-1 truncate font-medium">{item.title}</span>
        <span className="shrink-0 text-xs text-ter">{friendlyDate(item.startsAt)}</span>
      </button>
      {open && (
        <div className="px-4 pb-3 text-[13px] leading-relaxed">
          {item.description ? <p className="whitespace-pre-wrap text-sub">{item.description}</p> : <p className="text-ter">No text (open in Canvas).</p>}
          {item.url && (
            <a href={item.url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-indigo hover:underline">
              Open in Canvas <ExternalLink className="size-3" />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function AssignmentRow({ item, last }: { item: EffectiveItem; last?: boolean }) {
  return (
    <ItemPopover item={item}>
      <span className={cn('flex items-center gap-3 px-3.5 py-2.5 text-[13.5px] transition-colors hover:bg-well2', !last && 'border-b border-line')}>
        <span className={cn('min-w-0 flex-1 truncate', item.effectiveDone && 'text-ter line-through')}>{item.title}</span>
        {item.points != null && <span className="shrink-0 text-xs text-ter">{item.score != null ? `${item.score}/` : ''}{item.points}</span>}
        <StatusBadge item={item} />
        <DueLabel item={item} className="w-28 shrink-0 text-right text-xs" />
      </span>
    </ItemPopover>
  );
}

type Tab = 'overview' | 'assignments' | 'grades' | 'dates' | 'files' | 'announcements' | 'syllabus';

/** The whole course in one drawer: grade, to do, schedule, dates, files, every assignment, announcements, syllabus. */
export function CoursePane({ courseId, initialTab }: { courseId: string; initialTab?: string }) {
  const coursesQ = useCourses();
  const course = coursesQ.data?.find((c) => c.id === courseId);
  const assignmentsQ = useItems({ kind: ['assignment'], course: courseId, includeDone: true, includeInformational: true, limit: 500 });
  const announcementsQ = useItems({ kind: ['announcement'], course: courseId, limit: 50 });
  const manualQ = useItems({ kind: ['event'], source: ['manual'], course: courseId, limit: 300, includeDone: true });
  const contentQ = useCourseContent(courseId);
  const gradesQ = useCourseGrades(courseId);
  const [tab, setTab] = useState<Tab>((initialTab as Tab) ?? 'overview');

  const assignments = useMemo(() => (assignmentsQ.data ?? []).slice().sort((a, b) => dueMs(a) - dueMs(b)), [assignmentsQ.data]);
  const announcements = useMemo(() => (announcementsQ.data ?? []).slice().sort((a, b) => (b.startsAt ?? '').localeCompare(a.startsAt ?? '')), [announcementsQ.data]);
  const content = contentQ.data ?? [];
  const files = useMemo(() => content.filter((r) => r.kind === 'file').slice().sort((a, b) => String(b.raw.updatedAt ?? '').localeCompare(String(a.raw.updatedAt ?? ''))), [content]);
  const moduleItems = content.filter((r) => r.kind === 'module_item');
  const syllabus = content.find((r) => r.kind === 'syllabus');
  const grading = content.filter((r) => r.kind === 'grading');

  if (!course) {
    return (
      <div className="p-5">
        <SheetTitle>Course</SheetTitle>
        <SheetDescription>{coursesQ.isPending ? 'Loading…' : 'Course not found.'}</SheetDescription>
      </div>
    );
  }

  const isTa = course.role === 'ta';
  const color = course.color ?? 'var(--indigo)';
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
  const scheduleRows: { kind: string; m: Meeting; label: string; isNext: boolean }[] = [];
  for (const [kind, list] of Object.entries(course.schedule)) {
    for (const m of list ?? []) {
      const label = `${DAY_LABEL[m.day]} ${fmtTime(m.start)} – ${fmtTime(m.end)}`;
      const isNext = !!meeting && meeting.kind === kind && meeting.label.startsWith(`${DAY_LABEL[m.day]} ${fmtTime(m.start)}`);
      scheduleRows.push({ kind, m, label, isNext });
    }
  }
  const g = gradesQ.data;

  const tabs: { key: Tab; label: string; count?: number; hidden?: boolean }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'assignments', label: 'Assignments', count: assignments.length },
    { key: 'grades', label: 'Grades', hidden: isTa },
    { key: 'dates', label: 'Dates', count: manualEvents.length },
    { key: 'files', label: 'Files', count: files.length + moduleItems.length },
    { key: 'announcements', label: 'Announcements', count: announcements.length },
    { key: 'syllabus', label: 'Syllabus', hidden: !syllabus },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-line bg-well px-[22px] pb-4 pt-5">
        <div className="flex items-center gap-2.5">
          <span className="size-2.5 shrink-0 rounded-full ring-glow" style={{ background: color, '--glow-color': color } as CSSProperties} />
          <SheetTitle className="text-xl font-bold tracking-[-0.02em]">{course.code}</SheetTitle>
          {course.section && <span className="text-sm text-ter">{course.section}</span>}
          {isTa && <span className="rounded-full bg-card px-2 py-0.5 text-[10px] font-semibold uppercase text-sub">TA</span>}
          <span className="flex-1" />
          <Link to="/settings/courses" className="orb size-8 border border-line" title="Course settings" aria-label="Course settings"><Settings className="size-3.5" /></Link>
          <SheetClose className="orb size-8 border border-line" aria-label="Close"><X className="size-3.5" /></SheetClose>
        </div>
        <SheetDescription className="mt-1.5 text-[15px] text-sub">
          {course.name ?? course.term}
          {meeting && <span> · Next: {meetingLabel(meeting.kind)} {meeting.label}</span>}
        </SheetDescription>
        {links.length > 0 && (
          <div className="mt-3.5 flex flex-wrap gap-1.5">
            {links.map((l) => (
              <a key={l.url + l.label} href={l.url} target="_blank" rel="noreferrer" className="grid h-[30px] place-items-center rounded-full border border-line bg-card px-3 text-[12.5px] font-medium transition-colors hover:bg-well2">
                {l.label} ↗
              </a>
            ))}
          </div>
        )}
        <div className="seg mt-3.5 flex w-full overflow-x-auto">
          {tabs.filter((t) => !t.hidden).map((t) => (
            <button key={t.key} className={cn('!flex-none !py-1.5 !text-[12.5px]', tab === t.key && 'seg-on')} onClick={() => setTab(t.key)}>
              {t.label}{t.count ? ` · ${t.count}` : ''}{t.key === 'grades' && g?.current != null ? ` · ${g.current.toFixed(0)}%` : ''}
            </button>
          ))}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-[18px] pb-6 pt-[18px]">
        {tab === 'overview' && (
          <div className="flex flex-col gap-[18px]">
            <div className="grid grid-cols-2 gap-3">
              {isTa ? (
                <div className="flex flex-col justify-center gap-1 rounded-2xl bg-well p-4">
                  <div className="text-[12.5px] text-sub">Grading</div>
                  <div className="text-[26px] font-bold tracking-[-0.03em] text-indigo">{grading.length}</div>
                  <div className="text-[13px] text-sub">{grading.length ? 'in the queue' : 'queue is empty'}</div>
                </div>
              ) : (
                <button className="flex items-center gap-3.5 rounded-2xl bg-well p-4 text-left transition-colors hover:bg-well2" onClick={() => setTab('grades')}>
                  <GradeRing course={course} percent={g?.current} size={64} />
                  <div className="min-w-0">
                    <div className="text-[12.5px] text-sub">Grade</div>
                    <div className="mt-0.5 text-[13px]">{g ? (g.current == null ? 'Nothing graded yet' : `${g.weighted ? 'Weighted' : 'By points'} · ${g.graded} of ${g.total} graded`) : '…'}</div>
                  </div>
                </button>
              )}
              <button className="flex flex-col justify-center gap-1 rounded-2xl bg-well p-4 text-left transition-colors hover:bg-well2" onClick={() => setTab('assignments')}>
                <div className="text-[12.5px] text-sub">{isTa ? 'Upcoming' : 'To do'}</div>
                <div className={cn('text-[26px] font-bold tracking-[-0.03em]', first.length ? 'text-ink' : 'text-teal')}>{assignmentsQ.isPending ? '…' : first.length}</div>
                <div className="truncate text-[13px] text-sub">{first.length ? (first[0]!.dueAt ? `Next: ${first[0]!.title}` : first[0]!.title) : isTa ? 'Nothing coming up.' : 'Nothing left. Nice.'}</div>
              </button>
            </div>

            <Section title="Schedule">
              {scheduleRows.length ? (
                <Well>
                  {scheduleRows.map((r, i) => (
                    <div key={i} className={cn('flex items-center gap-3 px-3.5 py-3', i < scheduleRows.length - 1 && 'border-b border-line')} style={r.isNext ? { background: 'color-mix(in oklab, var(--indigo) 10%, transparent)' } : undefined}>
                      <span className="w-[76px] shrink-0 text-[13.5px] text-sub">{meetingLabel(r.kind)}</span>
                      <span className="text-[13.5px] font-medium">{r.label}</span>
                      {r.m.location && <span className="truncate text-xs text-ter">{r.m.location}</span>}
                      <span className="flex-1" />
                      {r.isNext && <span className="grid h-[22px] place-items-center rounded-full bg-indigo px-2.5 text-[11px] font-semibold text-white">{meeting?.virtual ? 'Next · online' : 'Next'}</span>}
                    </div>
                  ))}
                </Well>
              ) : (
                <EmptyWell>No schedule yet. <Link to="/settings/courses" className="text-indigo hover:underline">Add one in settings.</Link></EmptyWell>
              )}
            </Section>

            <Section title="Dates" action={<More onClick={() => setTab('dates')}>{manualEvents.length ? 'All' : 'Add'}</More>}>
              {upcomingDates.length ? (
                <Well>
                  {upcomingDates.map((it, i) => {
                    const r = manualRaw(it)!;
                    return (
                      <ItemPopover key={it.id} item={it}>
                        <span className={cn('flex items-center gap-3 px-3.5 py-2.5 text-[13.5px] transition-colors hover:bg-well2', i < upcomingDates.length - 1 && 'border-b border-line')}>
                          <span className="w-16 shrink-0 text-xs text-ter">{friendlyDate(`${r.date}T12:00:00`)}</span>
                          <span className="min-w-0 flex-1 truncate">{it.title}</span>
                          {r.start && <span className="shrink-0 text-xs text-ter">{fmtTime(r.start)}</span>}
                        </span>
                      </ItemPopover>
                    );
                  })}
                </Well>
              ) : (
                <EmptyWell>No exam or quiz dates yet.</EmptyWell>
              )}
            </Section>

            {isTa && grading.length > 0 && (
              <Section title="Grading queue">
                <Well>
                  {grading.map((q, i) => {
                    const raw = q.raw as { gradingProgress?: number; submissions?: number; openRegradeRequests?: number; published?: boolean };
                    const pct = Math.round(raw.gradingProgress ?? 0);
                    return (
                      <div key={q.id} className={cn('px-3.5 py-2.5 text-[13.5px]', i < grading.length - 1 && 'border-b border-line')}>
                        <div className="flex items-center gap-2">
                          <a href={q.url ?? '#'} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:underline">{q.title}</a>
                          <span className="text-xs text-ter">{raw.submissions ?? 0} subs · {pct}%{raw.openRegradeRequests ? ` · ${raw.openRegradeRequests} regrades` : ''}{raw.published ? '' : ' · unpublished'}</span>
                        </div>
                        <div className="mt-1.5 h-1 w-full overflow-hidden rounded bg-card"><div className="h-full rounded bg-indigo" style={{ width: `${pct}%` }} /></div>
                      </div>
                    );
                  })}
                </Well>
              </Section>
            )}

            {announcements.length > 0 && (
              <Section title="Announcements" action={<More onClick={() => setTab('announcements')}>All {announcements.length}</More>}>
                <Well>{announcements.slice(0, 3).map((a, i, arr) => <Announcement key={a.id} item={a} last={i === arr.length - 1} />)}</Well>
              </Section>
            )}

            <Section title="Recent files" action={files.length > 5 ? <More onClick={() => setTab('files')}>All {files.length}</More> : undefined}>
              {contentQ.isPending ? <div className="h-16 animate-pulse rounded-2xl bg-well" /> : <FileList rows={files} limit={5} />}
            </Section>

            {course.notes && <Section title="Notes"><Well className="p-4 text-[13px] text-sub whitespace-pre-wrap">{course.notes}</Well></Section>}
          </div>
        )}

        {tab === 'assignments' && (
          <div className="flex flex-col gap-[18px]">
            <Section title={`${firstLabel} · ${first.length}`}>
              {first.length ? <Well>{first.map((it, i) => <AssignmentRow key={it.id} item={it} last={i === first.length - 1} />)}</Well> : <EmptyWell>Nothing here.</EmptyWell>}
            </Section>
            <Section title={`${secondLabel} · ${second.length}`}>
              {second.length ? <Well className="opacity-80">{second.map((it, i) => <AssignmentRow key={it.id} item={it} last={i === second.length - 1} />)}</Well> : <EmptyWell>Nothing here.</EmptyWell>}
            </Section>
          </div>
        )}

        {tab === 'grades' && !isTa && <CourseGrades course={course} />}
        {tab === 'dates' && <CourseDates course={course} assignments={assignments} />}

        {tab === 'files' && (
          <div className="flex flex-col gap-[18px]">
            <Section title="Modules">{contentQ.isPending ? <div className="h-16 animate-pulse rounded-2xl bg-well" /> : <Modules rows={moduleItems} />}</Section>
            <Section title={`Files · ${files.length}`}><FileList rows={files} /></Section>
          </div>
        )}

        {tab === 'announcements' && (announcements.length ? <Well>{announcements.map((a, i) => <Announcement key={a.id} item={a} defaultOpen={i === 0} last={i === announcements.length - 1} />)}</Well> : <EmptyWell>No announcements in the last month.</EmptyWell>)}

        {tab === 'syllabus' && syllabus && (
          <div className="space-y-3">
            {syllabus.url && (
              <a href={syllabus.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-indigo hover:underline">
                Open in Canvas <ExternalLink className="size-3" />
              </a>
            )}
            <Well className="p-4"><p className="whitespace-pre-wrap text-[13.5px] leading-relaxed">{String(syllabus.raw.text ?? '')}</p></Well>
          </div>
        )}
      </div>
    </div>
  );
}
