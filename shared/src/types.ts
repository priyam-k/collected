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

export const JOB_STATES = ['new', 'starred', 'hidden', 'applied', 'screen', 'interviewing', 'offer', 'rejected', 'ghosted', 'withdrawn'] as const;
export type JobStateValue = (typeof JOB_STATES)[number];
/** Stages the tracker shows, in pipeline order. `new` is untracked, `hidden` is dismissed from the feed. */
export const TRACKED_STATES: readonly JobStateValue[] = ['starred', 'applied', 'screen', 'interviewing', 'offer', 'rejected', 'ghosted', 'withdrawn'];
export const OPEN_STAGES: readonly JobStateValue[] = ['starred', 'applied', 'screen', 'interviewing', 'offer'];
export const CLOSED_STAGES: readonly JobStateValue[] = ['rejected', 'ghosted', 'withdrawn'];
/** States that imply an application went out; moving into one stamps applied_at if it is empty. */
export const APPLIED_STAGES: readonly JobStateValue[] = ['applied', 'screen', 'interviewing', 'offer'];
export const JOB_STATE_LABELS: Record<JobStateValue, string> = {
  new: 'New',
  starred: 'Saved',
  hidden: 'Hidden',
  applied: 'Applied',
  screen: 'Screen',
  interviewing: 'Interviewing',
  offer: 'Offer',
  rejected: 'Rejected',
  ghosted: 'Ghosted',
  withdrawn: 'Withdrawn',
};

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
  /** TA-course rows and Gradescope rows in canvas-only courses: shown in class widgets, never in todo/calendar. */
  informational: boolean;
  /** Ids of linked rows from the other source that were collapsed into this one. */
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
  category: string | null;
  postedAt: string | null;
  active: boolean;
  visible: boolean;
  matchesFilter: boolean;
  score: number | null;
  firstSeenAt: string;
  updatedAt: string;
  state: JobStateValue;
  notes: string | null;
  seenAt: string | null;
  /** Tracker fields (job_state). */
  appliedAt: string | null; // YYYY-MM-DD
  nextAction: string | null;
  nextActionAt: string | null; // YYYY-MM-DD
  resumePath: string | null;
  stateUpdatedAt: string | null;
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
  /** Simplify `category` values that pass (empty = any). */
  categories_include: string[];
  /** Simplify `terms` values that pass, e.g. "Summer 2027" (empty = any). */
  terms_include: string[];
  title_include: string;
  title_exclude: string;
  locations_include: string;
  locations_exclude: string;
  sponsorship: 'ignore' | 'require_none_needed';
}

export interface JobsSource {
  id: string;
  url: string;
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
