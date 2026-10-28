// Vocabulary shared by server and web. Keep in sync with artifacts/DESIGN.md.

/** Sources with an ingester and a row in `sources`. */
export const INGESTED_SOURCE_IDS = ['canvas', 'canvas_ical', 'gradescope', 'gcal', 'gcal_ical', 'todoist', 'gtasks', 'jobs'] as const;
export type IngestedSourceId = (typeof INGESTED_SOURCE_IDS)[number];
/** Every value `items.source` can take. `manual` is you: exam dates, cancelled sessions, notes. */
export const SOURCE_IDS = [...INGESTED_SOURCE_IDS, 'manual'] as const;
export type SourceId = (typeof SOURCE_IDS)[number];

export const SOURCE_LABELS: Record<SourceId, string> = {
  canvas: 'Canvas',
  canvas_ical: 'Canvas (iCal fallback)',
  gradescope: 'Gradescope',
  gcal: 'Google Calendar',
  gcal_ical: 'Google Calendar (iCal)',
  todoist: 'Todoist',
  gtasks: 'Google Tasks',
  jobs: 'Job feed',
  manual: 'Manual',
};

/** Sources a to-do can be added to from the dashboard. Setting `todo.defaultApp` picks one. */
export const TODO_APPS = ['todoist', 'gtasks'] as const;
export type TodoApp = (typeof TODO_APPS)[number];

/** Whether a row came from a to-do app the dashboard can close tasks in. */
export function isTodoApp(source: string): source is TodoApp {
  return (TODO_APPS as readonly string[]).includes(source);
}

/**
 * Which app the add-task box sends to: the `todo.defaultApp` setting when that app is connected, otherwise
 * whichever is connected (Todoist first), otherwise none.
 */
export function resolveTodoApp(setting: unknown, connected: Partial<Record<TodoApp, boolean>>): TodoApp | null {
  if ((TODO_APPS as readonly unknown[]).includes(setting) && connected[setting as TodoApp]) return setting as TodoApp;
  return TODO_APPS.find((a) => connected[a]) ?? null;
}

/** What a hand-entered course date is. Cancelled/virtual attach to a scheduled session; the rest are dates in their own right. */
export const COURSE_EVENT_KINDS = ['exam', 'quiz', 'final', 'cancelled', 'virtual', 'other'] as const;
export type CourseEventKind = (typeof COURSE_EVENT_KINDS)[number];
export const COURSE_EVENT_LABELS: Record<CourseEventKind, string> = {
  exam: 'Exam',
  quiz: 'Quiz',
  final: 'Final',
  cancelled: 'Class cancelled',
  virtual: 'Virtual class',
  other: 'Note',
};
/** Built-in session kinds. A schedule can carry any other key too (`seminar`, `studio`, `recitation`…). */
export const MEETING_KINDS = ['lecture', 'discussion', 'lab', 'office_hours'] as const;
export type MeetingKind = string;
export const MEETING_LABELS: Record<string, string> = { lecture: 'Lecture', discussion: 'Discussion', lab: 'Lab', office_hours: 'Office hours' };
/** "office_hours" → "Office hours", "lab" → "Lab", "tutorial_section" → "Tutorial section". */
export function meetingLabel(kind: string): string {
  const known = MEETING_LABELS[kind];
  if (known) return known;
  const words = kind.replace(/[_-]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Session';
}

/** `items.raw` for a manual course event. */
export interface ManualEventRaw {
  eventKind: CourseEventKind;
  date: string; // YYYY-MM-DD
  start: string | null; // HH:MM local, null = all day
  end: string | null;
  location: string | null;
  note: string | null;
  meetingKind: MeetingKind | null; // which session a cancelled/virtual tag applies to
}

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

/** Keyed by session kind: the built-in ones plus anything the user adds. Keys are lowercase snake_case. */
export type CourseSchedule = Record<string, Meeting[]>;

/** One bucket of a course's grade: a Canvas assignment group, or a hand-made category matched by group id or title. */
export interface GradeCategory {
  id: string;
  name: string;
  /** Percent of the final grade, or null when the course is unweighted. */
  weight: number | null;
  /** Canvas assignment group ids that feed this category. */
  groupIds: string[];
  /** Case-insensitive regex on assignment titles, for courses without useful Canvas groups (Gradescope-only). */
  match: string | null;
  dropLowest: number;
}

export interface GradingConfig {
  /** auto = Canvas assignment groups and Canvas's weighting flag; manual = the categories below. */
  mode: 'auto' | 'manual';
  categories: GradeCategory[];
}

/* ---------- file sync (course files → laptop folders through the agent) ---------- */

export const FILE_SYNC_FALLBACKS = ['model', 'unsorted', 'skip'] as const;
export type FileSyncFallback = (typeof FILE_SYNC_FALLBACKS)[number];
/** Reserved target names: `skip` = don't place; `unsorted` = low confidence or no rule, surfaced for correction. */
export const FILE_SYNC_SKIP = 'skip';
export const FILE_SYNC_UNSORTED = 'unsorted';
export const FILE_SYNC_RESERVED_TARGETS = [FILE_SYNC_SKIP, FILE_SYNC_UNSORTED] as const;

/** A named destination. The path for it lives in the agent's config on each device, never here. */
export interface FileSyncTarget {
  name: string;
  /** One line the model reads as the criterion for this target, and the UI shows as a hint. */
  description: string;
}

/**
 * Every given condition must match. folder = Canvas folder path, module = module name, name = display filename
 * (case-insensitive regexes); largerThanMb = file size above this many megabytes.
 */
export interface FileSyncRule {
  target: string;
  folder: string | null;
  module: string | null;
  name: string | null;
  largerThanMb: number | null;
  /** Regex on how an unlisted file was found: syllabus, assignment, announcement, module. Never matches a file from the Files tab. */
  linked: string | null;
  /**
   * Layout under the target. false (default): mirror the Canvas folder path ("/p1/x.md" → Assignments/p1/x.md).
   * true: the top-level Canvas folder *is* the category, drop it ("/Lecture Notes/x.pdf" → Slides/x.pdf).
   */
  flatten: boolean;
}

export interface FileSyncConfig {
  enabled: boolean;
  targets: FileSyncTarget[];
  rules: FileSyncRule[];
  /** What happens to a file no rule matched: ask the model, drop it in `unsorted`, or skip it. */
  fallback: FileSyncFallback;
  /** Model confidence below this goes to `unsorted` instead of the model's choice. */
  threshold: number;
  /** The model's criterion for `skip`. */
  skipHint: string;
}

export type FileSyncDecidedBy = 'manual' | 'rule' | 'model' | 'fallback';

export interface FileSyncDecision {
  target: string;
  decidedBy: FileSyncDecidedBy;
  /** Model confidence for the chosen target, when decidedBy is model. */
  confidence: number | null;
  /** Human-readable: the rule that matched, or "model 0.82", or "fallback". */
  reason: string;
  /** From the matching rule: drop the top-level Canvas folder when placing. Absent for model, manual and fallback decisions. */
  flatten?: boolean;
}

/** Where a file that is not in the course's Files tab was found: a link in a page body, or a module item. */
export interface FileLinkedFrom {
  kind: 'syllabus' | 'assignment' | 'announcement' | 'module';
  /** The assignment's or announcement's title, the module's name, or "Syllabus". */
  title: string;
}

/** A Canvas file as the sync sees it. */
export interface FileSyncFile {
  courseId: string;
  fileId: string;
  title: string;
  filename: string;
  folderPath: string | null;
  moduleName: string | null;
  /** Order within the course's modules (module position × 1000 + item position), when the file sits in one. */
  modulePosition: number | null;
  contentType: string | null;
  size: number | null;
  updatedAt: string | null;
  /** Set only for files reachable solely through a link (hidden or locked Files folders); null or absent otherwise. */
  linkedFrom?: FileLinkedFrom | null;
}

export interface FileSyncPlacement {
  target: string;
  localPath: string;
  device: string;
  placedAt: string;
}

export interface FileSyncFileView extends FileSyncFile {
  /** null = waiting for the agent's model. */
  decision: FileSyncDecision | null;
  model: { target: string; confidence: number | null; probabilities: Record<string, number> | null; at: string } | null;
  manualTarget: string | null;
  placed: FileSyncPlacement | null;
}

export interface FileSyncManifestCourse {
  course: { id: string; code: string; color: string | null };
  config: FileSyncConfig;
  files: FileSyncFileView[];
}

export interface FileSyncManifest {
  generatedAt: string;
  courses: FileSyncManifestCourse[];
}

/** What a device last told the server: when it ran and where each target lives on it. */
export interface FileSyncDevice {
  device: string;
  lastRunAt: string;
  model: boolean;
  /** courseId → target name → absolute path on that device. */
  targets: Record<string, Record<string, string>>;
  errors: { courseId?: string; fileId?: string; message: string }[];
}

export interface GradedAssignment {
  id: string;
  title: string;
  source: SourceId;
  dueAt: string | null;
  status: ItemStatus;
  score: number | null;
  points: number | null;
  excused: boolean;
  omitFromFinal: boolean;
  /** True when a drop rule removed it from the category total. */
  dropped: boolean;
  url: string | null;
}

export interface GradeCategoryResult {
  id: string;
  name: string;
  weight: number | null;
  earned: number;
  possible: number;
  percent: number | null;
  graded: number;
  total: number;
  dropLowest: number;
  assignments: GradedAssignment[];
}

export interface CanvasGradeSummary {
  currentScore: number | null;
  finalScore: number | null;
  currentGrade: string | null;
  finalGrade: string | null;
  applyWeights: boolean;
}

export interface CourseGrades {
  courseId: string;
  mode: 'auto' | 'manual';
  weighted: boolean;
  /** Our number: weighted across categories with graded work, else points earned over points possible. */
  current: number | null;
  unweighted: number | null;
  canvas: CanvasGradeSummary | null;
  categories: GradeCategoryResult[];
  uncategorized: GradedAssignment[];
  graded: number;
  total: number;
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
  grading: GradingConfig | null;
  fileSync: FileSyncConfig | null;
  createdAt: string;
  updatedAt: string;
}

export interface Source {
  id: IngestedSourceId;
  enabled: boolean;
  status: SourceStatus;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  hasConfig: boolean;
  /** A sync is in flight right now. */
  running: boolean;
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

/** `GET /api/auth/me`: who the request is, and which sign-in methods this server offers. */
export interface Me {
  /** The resolved identity string (email, "dev", "token:<name>", "service:<name>", "helper") or null when signed out. */
  identity: string | null;
  user: { email: string; name: string | null; picture: string | null } | null;
  authDisabled: boolean;
  signIn: { google: boolean; access: boolean };
}

/** A CLI token as listed; the plaintext is returned once, on creation, as `token`. */
export interface ApiToken {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/** One active Canvas enrollment as the onboarding lists it, with the course row it would become. */
export interface CanvasEnrollment {
  canvasCourseId: string;
  name: string;
  courseCode: string;
  termName: string | null;
  role: CourseRole;
  /** Our course id when this enrollment is already tracked. */
  trackedAs: string | null;
  suggested: { term: string; code: string; section: string | null };
}

export interface HealthResponse {
  ok: true;
  version: string;
  now: string;
  authDisabled: boolean;
}

// --- system: version and updates (self-host) -------------------------------------------------------------------------

/** What this running build is. `commit` is the short git sha baked at build time ("dev" when unknown). */
export interface SystemVersion {
  version: string;
  commit: string;
  builtAt: string | null;
  /** "owner/name" of the upstream GitHub repository the update check compares against. */
  repo: string;
}

/** One CHANGELOG.md section. `level` says whether pulling it is worth a self-hoster's time. */
export interface ChangelogEntry {
  version: string;
  date: string;
  level: 'recommended' | 'optional';
  notes: string[];
}

/** Result of comparing the running commit with upstream main. `upstream` is null when the check has not run or failed. */
export interface UpdateStatus {
  current: SystemVersion;
  upstream: {
    commit: string;
    version: string | null;
    /** Commits on upstream main that this build does not have. */
    ahead: number;
    /** True when at least one of those commits touched a file that changes the running app (not docs). */
    matters: boolean;
    checkedAt: string;
    /** Link to the GitHub compare view. */
    url: string;
  } | null;
  /** Changelog sections newer than the running version, newest first. */
  changelog: ChangelogEntry[];
  /** Shell steps for the operator to run, in order. */
  steps: string[];
  error: string | null;
}
