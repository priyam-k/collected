// Vocabulary shared by server and web. Keep in sync with artifacts/DESIGN.md.

export const SOURCE_IDS = ['canvas', 'canvas_ical', 'gradescope', 'gcal', 'todoist', 'jobs'] as const;
export type SourceId = (typeof SOURCE_IDS)[number];

export const SOURCE_LABELS: Record<SourceId, string> = {
  canvas: 'Canvas',
  canvas_ical: 'Canvas (iCal fallback)',
  gradescope: 'Gradescope',
  gcal: 'Google Calendar',
  todoist: 'Todoist',
  jobs: 'Job feed',
};

export const SOURCE_STATUSES = ['disconnected', 'connected', 'needs_auth', 'error'] as const;
export type SourceStatus = (typeof SOURCE_STATUSES)[number];

export const ITEM_KINDS = ['assignment', 'event', 'task', 'announcement'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

// late = submitted after due (counts as done). missing = past due and unsubmitted (open, flagged).
export const ITEM_STATUSES = ['open', 'submitted', 'done', 'missing', 'late', 'graded', 'cancelled'] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];
export const DONE_STATUSES: readonly ItemStatus[] = ['submitted', 'done', 'late', 'graded'];

export const COURSE_ROLES = ['student', 'ta'] as const;
export type CourseRole = (typeof COURSE_ROLES)[number];

export const SUBMITS_VIA = ['canvas', 'gradescope', 'both'] as const;
export type SubmitsVia = (typeof SUBMITS_VIA)[number];

export const JOB_STATES = ['new', 'starred', 'hidden', 'applied', 'interviewing', 'rejected', 'offer'] as const;
export type JobStateValue = (typeof JOB_STATES)[number];

export const LINK_METHODS = ['auto', 'manual'] as const;
export type LinkMethod = (typeof LINK_METHODS)[number];

export const BREAKPOINTS = ['lg', 'md', 'sm'] as const;
export type Breakpoint = (typeof BREAKPOINTS)[number];

export interface CourseLink {
  label: string;
  url: string;
}

export interface Meeting {
  day: 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
  start: string; // "11:00" local
  end: string; // "11:50"
  location?: string;
}

export interface CourseSchedule {
  lecture?: Meeting[];
  discussion?: Meeting[];
  office_hours?: Meeting[];
}

export interface Course {
  id: string;
  term: string;
  code: string;
  section: string | null;
  name: string | null;
  role: CourseRole;
  canvasCourseId: string | null;
  gradescopeCourseId: string | null;
  submitsVia: SubmitsVia;
  color: string | null;
  links: CourseLink[];
  schedule: CourseSchedule;
  notes: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Source {
  id: SourceId;
  enabled: boolean;
  status: SourceStatus;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  hasConfig: boolean;
  meta: Record<string, unknown>;
  updatedAt: string;
}

export interface Item {
  id: string; // `${source}:${externalId}`
  source: SourceId;
  externalId: string;
  kind: ItemKind;
  courseId: string | null;
  title: string;
  description: string | null;
  url: string | null;
  startsAt: string | null;
  endsAt: string | null;
  dueAt: string | null;
  allDay: boolean;
  status: ItemStatus;
  points: number | null;
  score: number | null;
  labels: string[];
  raw: Record<string, unknown>;
  firstSeenAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Override {
  itemId: string;
  hidden: boolean;
  done: boolean;
  snoozedUntil: string | null;
  note: string | null;
  updatedAt: string;
}

/** What widgets consume: an item plus the resolved done/visibility state. */
export interface EffectiveItem extends Item {
  effectiveDone: boolean;
  effectiveHidden: boolean;
  linkedIds: string[];
  override: Override | null;
  course: Pick<Course, 'id' | 'code' | 'color' | 'role'> | null;
}

export interface Job {
  id: string;
  source: string;
  externalId: string;
  company: string;
  title: string;
  locations: string[];
  url: string;
  terms: string[];
  sponsorship: string | null;
  degrees: string[];
  postedAt: string | null;
  active: boolean;
  matchesFilter: boolean;
  score: number | null;
  firstSeenAt: string;
  updatedAt: string;
  state: JobStateValue;
  notes: string | null;
  seenAt: string | null;
}

export interface WidgetInstance {
  id: string;
  type: string;
  config: Record<string, unknown>;
  hidden: boolean;
  createdAt: string;
}

export interface LayoutItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  maxW?: number;
  maxH?: number;
}

export type Layouts = Partial<Record<Breakpoint, LayoutItem[]>>;

export interface JobsFilter {
  require_active: boolean;
  require_visible: boolean;
  title_include: string;
  title_exclude: string;
  locations_include: string;
  locations_exclude: string;
  sponsorship: 'ignore' | 'require_none_needed';
}

export interface TodoistPushConfig {
  enabled: boolean;
  projectId: string | null;
  projectName: string;
  commonLabel: string;
  courseLabels: boolean;
}

export interface HealthResponse {
  ok: true;
  version: string;
  now: string;
  authDisabled: boolean;
}
