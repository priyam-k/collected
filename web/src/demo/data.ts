import type { Course, CourseSchedule, EffectiveItem, ItemKind, ItemStatus, Job, JobStateValue, Layouts, ManualEventRaw, Source, SourceId, WidgetInstance } from '@collected/shared';

/**
 * The demo semester: an invented student at an unnamed school, six courses, a week of classes, homework, tasks,
 * announcements and a job feed. Every date is relative to when the page loads, so the demo always looks current.
 * Nothing here is anyone's real data.
 */

export interface DemoState {
  courses: Course[];
  items: EffectiveItem[];
  sources: Source[];
  jobs: Job[];
  widgets: WidgetInstance[];
  layout: Layouts;
  settings: Record<string, unknown>;
}

const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

function at(dayOffset: number, hh: number, mm = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hh, mm, 0, 0);
  return d;
}
const iso = (d: Date) => d.toISOString();
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function term(): string {
  const d = new Date();
  const m = d.getMonth();
  return `${d.getFullYear()}-${m < 5 ? 'spring' : m < 7 ? 'summer' : 'fall'}`;
}

const COURSES: { code: string; name: string; color: string; role?: 'ta'; schedule: CourseSchedule; links: string[] }[] = [
  {
    code: 'CS351',
    name: 'Algorithms',
    color: '#5b6ee1',
    schedule: { lecture: [{ day: 'mon', start: '10:00', end: '10:50', location: 'Sci 120' }, { day: 'wed', start: '10:00', end: '10:50', location: 'Sci 120' }, { day: 'fri', start: '10:00', end: '10:50', location: 'Sci 120' }], discussion: [{ day: 'thu', start: '14:00', end: '14:50', location: 'Eng 210' }] },
    links: ['Canvas', 'Piazza', 'Gradescope'],
  },
  {
    code: 'MATH340',
    name: 'Linear Algebra',
    color: '#d1883a',
    schedule: { lecture: [{ day: 'tue', start: '9:30', end: '10:45', location: 'Math 0401' }, { day: 'thu', start: '9:30', end: '10:45', location: 'Math 0401' }] },
    links: ['Canvas', 'Textbook'],
  },
  {
    code: 'PHYS260',
    name: 'Electricity and Magnetism',
    color: '#2f9e8f',
    schedule: { lecture: [{ day: 'mon', start: '13:00', end: '13:50', location: 'Phys 1410' }, { day: 'wed', start: '13:00', end: '13:50', location: 'Phys 1410' }], lab: [{ day: 'fri', start: '13:00', end: '15:50', location: 'Phys 3301' }] },
    links: ['Canvas', 'Lab manual'],
  },
  {
    code: 'LING200',
    name: 'Introduction to Linguistics',
    color: '#c4566a',
    schedule: { lecture: [{ day: 'tue', start: '12:30', end: '13:45', location: 'Hum 1102' }, { day: 'thu', start: '12:30', end: '13:45', location: 'Hum 1102' }] },
    links: ['Canvas', 'Readings'],
  },
  {
    code: 'STAT400',
    name: 'Probability and Statistics',
    color: '#8a6cc8',
    schedule: { lecture: [{ day: 'mon', start: '15:00', end: '16:15', location: 'Math 0103' }, { day: 'wed', start: '15:00', end: '16:15', location: 'Math 0103' }] },
    links: ['Canvas', 'Gradescope'],
  },
  {
    code: 'CS220',
    name: 'Programming Languages (TA)',
    color: '#4f9a5a',
    role: 'ta',
    schedule: { office_hours: [{ day: 'tue', start: '16:00', end: '18:00', location: 'Iribe 1116' }], discussion: [{ day: 'fri', start: '9:00', end: '9:50', location: 'Iribe 0318' }] },
    links: ['Canvas', 'Course site'],
  },
];

const courseId = (code: string) => `demo-${code.toLowerCase()}`;

function makeCourses(): Course[] {
  const now = new Date().toISOString();
  return COURSES.map((c) => ({
    id: courseId(c.code),
    term: term(),
    code: c.code,
    section: '0101',
    name: c.name,
    role: c.role ?? 'student',
    canvasCourseId: null,
    gradescopeCourseId: null,
    submitsVia: 'canvas',
    color: c.color,
    links: c.links.map((label) => ({ label, url: 'https://example.com/' })),
    schedule: c.schedule,
    notes: null,
    archived: false,
    grading: null,
    fileSync: null,
    createdAt: now,
    updatedAt: now,
  }));
}

let seq = 0;
function item(p: {
  source: SourceId;
  kind: ItemKind;
  title: string;
  course?: string | null;
  dueAt?: Date | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
  allDay?: boolean;
  status?: ItemStatus;
  done?: boolean;
  labels?: string[];
  raw?: Record<string, unknown>;
  description?: string | null;
  points?: number | null;
  score?: number | null;
}): EffectiveItem {
  const externalId = `demo-${++seq}`;
  const c = p.course ? COURSES.find((x) => x.code === p.course) : null;
  const status = p.status ?? (p.done ? 'submitted' : 'open');
  const seen = iso(at(-20, 9));
  return {
    id: `${p.source}:${externalId}`,
    source: p.source,
    externalId,
    kind: p.kind,
    courseId: c ? courseId(c.code) : null,
    title: p.title,
    description: p.description ?? null,
    url: p.source === 'canvas' || p.source === 'gradescope' ? 'https://example.com/' : null,
    startsAt: p.startsAt ? iso(p.startsAt) : null,
    endsAt: p.endsAt ? iso(p.endsAt) : null,
    dueAt: p.dueAt ? iso(p.dueAt) : null,
    allDay: !!p.allDay,
    status,
    points: p.points ?? null,
    score: p.score ?? null,
    labels: p.labels ?? [],
    raw: p.raw ?? {},
    firstSeenAt: seen,
    updatedAt: seen,
    deletedAt: null,
    effectiveDone: p.done ?? ['submitted', 'done', 'late', 'graded'].includes(status),
    effectiveHidden: false,
    informational: c?.role === 'ta' && p.kind === 'assignment',
    linkedIds: [],
    override: null,
    course: c ? { id: courseId(c.code), code: c.code, color: c.color, role: c.role ?? 'student' } : null,
  };
}

function hm(t: string): [number, number] {
  const [h, m] = t.split(':').map(Number);
  return [h ?? 0, m ?? 0];
}

function makeItems(): EffectiveItem[] {
  seq = 0;
  const out: EffectiveItem[] = [];

  // Class meetings from the calendar, two weeks back to three weeks out.
  for (let d = -14; d <= 21; d++) {
    const dow = DOW[at(d, 12).getDay()];
    for (const c of COURSES) {
      for (const [kind, list] of Object.entries(c.schedule)) {
        for (const m of list ?? []) {
          if (m.day !== dow) continue;
          const [sh, sm] = hm(m.start);
          const [eh, em] = hm(m.end);
          const label = kind === 'office_hours' ? 'Office hours' : kind.charAt(0).toUpperCase() + kind.slice(1);
          out.push(item({ source: 'gcal', kind: 'event', course: c.code, title: `${c.code} ${label}`, startsAt: at(d, sh, sm), endsAt: at(d, eh, em), raw: { location: m.location, calendarName: 'Classes' } }));
        }
      }
    }
  }

  // Things that are not class.
  const life: [number, number, number, number, number, string, string | null, string][] = [
    [0, 17, 0, 18, 30, 'Study group: CS351', 'Library 4th floor', '#5b6ee1'],
    [1, 18, 0, 19, 0, 'Climbing', 'Rec center', '#6f8f72'],
    [2, 12, 0, 13, 0, 'Lunch with Sam', null, '#9a8f7a'],
    [3, 16, 0, 19, 0, 'Career fair', 'Student union ballroom', '#b07a3a'],
    [-1, 19, 0, 21, 0, 'Hackathon kickoff', 'Startup lab', '#7a6fb0'],
    [4, 11, 0, 12, 0, 'Advising appointment', 'Admin 2120', '#9a8f7a'],
    [6, 10, 0, 12, 0, 'Farmers market', null, '#6f8f72'],
    [8, 18, 30, 20, 0, 'Club meeting', 'Hum 1102', '#7a6fb0'],
  ];
  for (const [d, sh, sm, eh, em, title, location, color] of life) {
    out.push(item({ source: 'gcal', kind: 'event', title, startsAt: at(d, sh, sm), endsAt: at(d, eh, em), raw: { location, color, calendarName: 'Personal' } }));
  }
  out.push(item({ source: 'gcal', kind: 'event', title: 'Fall break', allDay: true, startsAt: at(9, 0), endsAt: at(11, 0), raw: { color: '#b07a3a', calendarName: 'Academic calendar' } }));

  // Homework from Canvas and Gradescope.
  const hw: [string, string, number, number, number, Partial<{ done: boolean; status: ItemStatus; score: number; points: number; source: SourceId }>][] = [
    ['CS351', 'Problem set 6: dynamic programming', 1, 23, 59, {}],
    ['CS351', 'Problem set 5: greedy algorithms', -6, 23, 59, { done: true, status: 'graded', score: 46, points: 50, source: 'gradescope' }],
    ['CS351', 'Problem set 7: network flow', 8, 23, 59, {}],
    ['MATH340', 'Homework 8: eigenvalues', 2, 11, 0, {}],
    ['MATH340', 'Homework 7: determinants', -5, 11, 0, { done: true, status: 'graded', score: 19, points: 20 }],
    ['MATH340', 'Homework 9: diagonalization', 9, 11, 0, {}],
    ['PHYS260', 'Lab report 5: RC circuits', 0, 23, 59, {}],
    ['PHYS260', 'Mastering set 9', -1, 23, 59, { status: 'missing' }],
    ['PHYS260', 'Mastering set 10', 6, 23, 59, {}],
    ['LING200', 'Reading response: Pinker ch. 4', 3, 12, 30, {}],
    ['LING200', 'Phonology problem set', -3, 12, 30, { done: true, status: 'submitted' }],
    ['LING200', 'Field recording project proposal', 12, 23, 59, {}],
    ['STAT400', 'Homework 6: joint distributions', 4, 15, 0, {}],
    ['STAT400', 'Homework 5: expectation', -4, 15, 0, { done: true, status: 'graded', score: 38, points: 40, source: 'gradescope' }],
    ['STAT400', 'Quiz 3 (online)', 0, 21, 0, { done: true, status: 'submitted' }],
  ];
  for (const [code, title, d, h, m, o] of hw) {
    out.push(item({ source: o.source ?? 'canvas', kind: 'assignment', course: code, title, dueAt: at(d, h, m), done: o.done, status: o.status, score: o.score, points: o.points ?? 10 }));
  }
  // The TA course: grading work that never lands in the to-do list.
  out.push(item({ source: 'gradescope', kind: 'assignment', course: 'CS220', title: 'Project 3: interpreter', dueAt: at(-2, 23, 59), raw: { ta: true, gradingProgress: 0.62, submissions: 184, published: false } }));
  out.push(item({ source: 'gradescope', kind: 'assignment', course: 'CS220', title: 'Quiz 4', dueAt: at(-5, 12, 0), raw: { ta: true, gradingProgress: 1, submissions: 201, published: true } }));

  // Exams and quizzes entered on each course's Dates tab.
  const exam = (code: string, title: string, d: number, start: string, end: string, kind: 'exam' | 'quiz' | 'final', location: string) => {
    const [sh, sm] = hm(start);
    const raw: ManualEventRaw = { eventKind: kind, date: ymd(at(d, 12)), start, end, location, note: null, meetingKind: null };
    out.push(item({ source: 'manual', kind: 'event', course: code, title, startsAt: at(d, sh, sm), endsAt: at(d, ...hm(end)), raw: raw as unknown as Record<string, unknown> }));
  };
  exam('MATH340', 'Midterm 2', 5, '9:30', '10:45', 'exam', 'Math 0401');
  exam('STAT400', 'Quiz 4', 2, '15:00', '15:30', 'quiz', 'Math 0103');
  exam('CS351', 'Midterm 2', 10, '19:00', '20:30', 'exam', 'Sci 120');
  exam('PHYS260', 'Exam 2', 16, '13:00', '13:50', 'exam', 'Phys 1410');

  // Tasks from Todoist and Google Tasks.
  const tasks: [string, number | null, string[], string, SourceId][] = [
    ['Email advisor about spring schedule', 0, [], 'School', 'todoist'],
    ['Finish cover letter for summer internship', 1, ['career'], 'Career', 'todoist'],
    ['Return library books', -1, ['errands'], 'Errands', 'todoist'],
    ['Buy lab notebook', 2, ['errands'], 'Errands', 'gtasks'],
    ['Practice interview questions', 3, ['career'], 'Career', 'todoist'],
    ['Book flights home for break', 5, ['errands'], 'Personal', 'gtasks'],
    ['Renew bus pass', null, ['errands'], 'Errands', 'todoist'],
    ['Plan hackathon project', null, [], 'Projects', 'todoist'],
  ];
  for (const [title, d, labels, projectName, source] of tasks) {
    out.push(item({ source, kind: 'task', title, dueAt: d === null ? null : at(d, 17, 0), allDay: d !== null, labels, raw: { projectName } }));
  }

  // Announcements.
  const ann: [string, string, number, string][] = [
    ['CS351', 'Problem set 6 office hours moved to Thursday', -1, 'Office hours this week are Thursday 3–5 PM in Eng 210 instead of Wednesday.'],
    ['MATH340', 'Midterm 2 topics and practice exam', -2, 'Midterm 2 covers chapters 4 through 6. A practice exam with solutions is posted under Files.'],
    ['PHYS260', 'Lab 6 safety briefing', -3, 'Read the safety section of the lab manual before Friday. Closed-toe shoes required.'],
    ['LING200', 'Guest lecture on Tuesday', -4, 'A visiting researcher will talk about sign language phonology. Attendance counts toward participation.'],
    ['STAT400', 'Quiz 3 grades released', -5, 'Grades are on Canvas. Regrade requests are open for one week.'],
  ];
  for (const [code, title, d, body] of ann) out.push(item({ source: 'canvas', kind: 'announcement', course: code, title, startsAt: at(d, 9, 30), description: body }));

  return out;
}

function makeSources(): Source[] {
  const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
  const row = (id: Source['id'], min: number, status: Source['status'] = 'connected', enabled = true): Source => ({
    id,
    enabled,
    status,
    lastRunAt: ago(min),
    lastSuccessAt: status === 'connected' ? ago(min) : null,
    lastError: null,
    hasConfig: status !== 'disconnected',
    running: false,
    meta: {},
    updatedAt: ago(min),
  });
  return [row('canvas', 3), row('canvas_ical', 3, 'disconnected', false), row('gradescope', 12), row('gcal', 4), row('gcal_ical', 0, 'disconnected', false), row('todoist', 2), row('gtasks', 6), row('jobs', 38)];
}

function makeJobs(): Job[] {
  const list: [string, string, string, string, number, JobStateValue, Partial<Job>][] = [
    ['Northwind Labs', 'Software Engineering Intern, Summer', 'Seattle, WA', 'Software', 0, 'new', {}],
    ['Halcyon Robotics', 'Robotics Software Intern', 'Boston, MA', 'Hardware', 0, 'new', {}],
    ['Kestrel AI', 'Machine Learning Research Intern', 'San Francisco, CA', 'AI/ML/Data', 1, 'starred', {}],
    ['Parallax', 'Backend Engineering Intern', 'New York, NY', 'Software', 1, 'new', {}],
    ['Lumen Health', 'Data Science Intern', 'Remote', 'AI/ML/Data', 1, 'new', {}],
    ['Cobalt Systems', 'Embedded Firmware Intern', 'Austin, TX', 'Hardware', 2, 'new', {}],
    ['Tessellate', 'Frontend Engineering Intern', 'Chicago, IL', 'Software', 2, 'applied', { appliedAt: ymd(at(-6, 12)) }],
    ['Quarry Capital', 'Quantitative Developer Intern', 'New York, NY', 'Quant', 3, 'interviewing', { appliedAt: ymd(at(-20, 12)), nextAction: 'Technical interview', nextActionAt: ymd(at(4, 12)) }],
    ['Fieldnote', 'Full-stack Intern', 'Denver, CO', 'Software', 3, 'screen', { appliedAt: ymd(at(-12, 12)), nextAction: 'Recruiter call', nextActionAt: ymd(at(1, 12)) }],
    ['Orbital', 'Systems Engineering Intern', 'Los Angeles, CA', 'Hardware', 4, 'new', {}],
    ['Brightline', 'Software Engineer Intern, Infrastructure', 'Seattle, WA', 'Software', 4, 'starred', {}],
    ['Arcadia Bio', 'Computational Biology Intern', 'San Diego, CA', 'AI/ML/Data', 5, 'new', {}],
    ['Meridian', 'iOS Engineering Intern', 'New York, NY', 'Software', 6, 'new', {}],
    ['Waypoint', 'Platform Engineering Intern', 'Remote', 'Software', 7, 'applied', { appliedAt: ymd(at(-9, 12)) }],
  ];
  return list.map(([company, title, loc, category, daysAgo, state, extra], i) => {
    const posted = at(-daysAgo, 10).toISOString();
    return {
      id: `demo-job-${i}`,
      source: 'demo',
      externalId: `demo-job-${i}`,
      company,
      title,
      locations: [loc],
      url: 'https://example.com/',
      terms: ['Summer'],
      sponsorship: null,
      degrees: ['Bachelor'],
      category,
      postedAt: posted,
      active: true,
      visible: true,
      matchesFilter: true,
      score: null,
      firstSeenAt: posted,
      updatedAt: posted,
      state,
      notes: null,
      seenAt: daysAgo > 1 ? posted : null,
      appliedAt: null,
      nextAction: null,
      nextActionAt: null,
      resumePath: null,
      stateUpdatedAt: state === 'new' ? null : at(-2, 12).toISOString(),
      ...extra,
    };
  });
}

/** The arrangement visitors see first: calendar and to-do on top, instruments below. */
const LAYOUT_LG = [
  { i: 'calendar', x: 0, y: 0, w: 8, h: 11 },
  { i: 'todo', x: 8, y: 0, w: 4, h: 11 },
  { i: 'classes', x: 0, y: 11, w: 4, h: 7 },
  { i: 'progress', x: 4, y: 11, w: 3, h: 7 },
  { i: 'exams', x: 7, y: 11, w: 2, h: 7 },
  { i: 'clock', x: 9, y: 11, w: 3, h: 7 },
  { i: 'jobs', x: 0, y: 18, w: 8, h: 6 },
  { i: 'sources', x: 8, y: 18, w: 4, h: 6 },
  { i: 'announcements', x: 0, y: 24, w: 6, h: 6 },
  { i: 'tracker', x: 6, y: 24, w: 6, h: 6 },
];

export function makeDemoState(): DemoState {
  const created = new Date().toISOString();
  const widgets: WidgetInstance[] = LAYOUT_LG.map((l) => ({ id: l.i, type: l.i, config: l.i === 'calendar' ? { view: 'week' } : {}, hidden: false, createdAt: created }));
  return {
    courses: makeCourses(),
    items: makeItems(),
    sources: makeSources(),
    jobs: makeJobs(),
    widgets,
    layout: { lg: LAYOUT_LG.map((l) => ({ ...l })) },
    settings: {
      'profile.initials': 'AR',
      'todo.sections': ['homework', 'career', 'errands'],
      'todoist.push': { enabled: true, commonLabel: 'homework' },
      'todo.defaultApp': 'todoist',
    },
  };
}
