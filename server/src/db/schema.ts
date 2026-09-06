import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { CourseLink, CourseSchedule, LayoutItem } from '@collected/shared';

const nowIso = () => new Date().toISOString();

const timestamps = {
  createdAt: text('created_at').notNull().$defaultFn(nowIso),
  updatedAt: text('updated_at').notNull().$defaultFn(nowIso).$onUpdateFn(nowIso),
};

export const sources = sqliteTable('sources', {
  id: text('id').primaryKey(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  status: text('status').notNull().default('disconnected'),
  lastRunAt: text('last_run_at'),
  lastSuccessAt: text('last_success_at'),
  lastError: text('last_error'),
  configEnc: text('config_enc'),
  meta: text('meta', { mode: 'json' }).$type<Record<string, unknown>>().notNull().$defaultFn(() => ({})),
  updatedAt: text('updated_at').notNull().$defaultFn(nowIso).$onUpdateFn(nowIso),
});

export const courses = sqliteTable(
  'courses',
  {
    id: text('id').primaryKey(),
    term: text('term').notNull(),
    code: text('code').notNull(),
    section: text('section'),
    name: text('name'),
    role: text('role').notNull().default('student'),
    canvasCourseId: text('canvas_course_id'),
    gradescopeCourseId: text('gradescope_course_id'),
    submitsVia: text('submits_via').notNull().default('both'),
    color: text('color'),
    links: text('links', { mode: 'json' }).$type<CourseLink[]>().notNull().$defaultFn(() => []),
    schedule: text('schedule', { mode: 'json' }).$type<CourseSchedule>().notNull().$defaultFn(() => ({})),
    notes: text('notes'),
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
    ...timestamps,
  },
  (t) => [
    index('courses_canvas_idx').on(t.canvasCourseId),
    index('courses_gradescope_idx').on(t.gradescopeCourseId),
  ],
);

export const items = sqliteTable(
  'items',
  {
    id: text('id').primaryKey(), // `${source}:${externalId}`
    source: text('source').notNull(),
    externalId: text('external_id').notNull(),
    kind: text('kind').notNull(),
    courseId: text('course_id'),
    title: text('title').notNull(),
    description: text('description'),
    url: text('url'),
    startsAt: text('starts_at'),
    endsAt: text('ends_at'),
    dueAt: text('due_at'),
    allDay: integer('all_day', { mode: 'boolean' }).notNull().default(false),
    status: text('status').notNull().default('open'),
    points: real('points'),
    score: real('score'),
    labels: text('labels', { mode: 'json' }).$type<string[]>().notNull().$defaultFn(() => []),
    raw: text('raw', { mode: 'json' }).$type<Record<string, unknown>>().notNull().$defaultFn(() => ({})),
    firstSeenAt: text('first_seen_at').notNull().$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().$defaultFn(nowIso).$onUpdateFn(nowIso),
    deletedAt: text('deleted_at'),
  },
  (t) => [
    uniqueIndex('items_source_external_idx').on(t.source, t.externalId),
    index('items_due_idx').on(t.dueAt),
    index('items_starts_idx').on(t.startsAt),
    index('items_course_idx').on(t.courseId),
    index('items_kind_idx').on(t.kind),
  ],
);

export const itemLinks = sqliteTable(
  'item_links',
  {
    aItemId: text('a_item_id').notNull(),
    bItemId: text('b_item_id').notNull(),
    method: text('method').notNull().default('auto'),
    confidence: real('confidence'),
    createdAt: text('created_at').notNull().$defaultFn(nowIso),
  },
  (t) => [primaryKey({ columns: [t.aItemId, t.bItemId] }), index('item_links_b_idx').on(t.bItemId)],
);

export const overrides = sqliteTable('overrides', {
  itemId: text('item_id').primaryKey(),
  hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
  done: integer('done', { mode: 'boolean' }).notNull().default(false),
  snoozedUntil: text('snoozed_until'),
  note: text('note'),
  updatedAt: text('updated_at').notNull().$defaultFn(nowIso).$onUpdateFn(nowIso),
});

export const todoistMap = sqliteTable(
  'todoist_map',
  {
    itemId: text('item_id').primaryKey(),
    todoistTaskId: text('todoist_task_id').notNull(),
    lastPushedHash: text('last_pushed_hash'),
    closedByUs: integer('closed_by_us', { mode: 'boolean' }).notNull().default(false),
    ...timestamps,
  },
  (t) => [uniqueIndex('todoist_map_task_idx').on(t.todoistTaskId)],
);

export const jobs = sqliteTable(
  'jobs',
  {
    id: text('id').primaryKey(), // `${source}:${externalId}`
    source: text('source').notNull(),
    externalId: text('external_id').notNull(),
    company: text('company').notNull(),
    title: text('title').notNull(),
    locations: text('locations', { mode: 'json' }).$type<string[]>().notNull().$defaultFn(() => []),
    url: text('url').notNull(),
    terms: text('terms', { mode: 'json' }).$type<string[]>().notNull().$defaultFn(() => []),
    sponsorship: text('sponsorship'),
    degrees: text('degrees', { mode: 'json' }).$type<string[]>().notNull().$defaultFn(() => []),
    postedAt: text('posted_at'),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    matchesFilter: integer('matches_filter', { mode: 'boolean' }).notNull().default(false),
    score: real('score'),
    firstSeenAt: text('first_seen_at').notNull().$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().$defaultFn(nowIso).$onUpdateFn(nowIso),
  },
  (t) => [
    uniqueIndex('jobs_source_external_idx').on(t.source, t.externalId),
    index('jobs_posted_idx').on(t.postedAt),
    index('jobs_matches_idx').on(t.matchesFilter),
  ],
);

export const jobState = sqliteTable('job_state', {
  jobId: text('job_id').primaryKey(),
  state: text('state').notNull().default('new'),
  notes: text('notes'),
  resumePath: text('resume_path'),
  seenAt: text('seen_at'),
  updatedAt: text('updated_at').notNull().$defaultFn(nowIso).$onUpdateFn(nowIso),
});

export const applications = sqliteTable('applications', {
  id: text('id').primaryKey(),
  jobId: text('job_id'),
  company: text('company').notNull(),
  title: text('title').notNull(),
  url: text('url'),
  appliedAt: text('applied_at'),
  status: text('status').notNull().default('applied'),
  contact: text('contact'),
  nextAction: text('next_action'),
  nextActionAt: text('next_action_at'),
  notes: text('notes'),
  ...timestamps,
});

export const courseContent = sqliteTable(
  'course_content',
  {
    id: text('id').primaryKey(), // `${courseId}:${kind}:${externalId}`
    courseId: text('course_id').notNull(),
    kind: text('kind').notNull(), // syllabus | module_item | file | page | grading
    externalId: text('external_id').notNull(),
    moduleName: text('module_name'),
    title: text('title').notNull(),
    url: text('url'),
    position: integer('position'),
    raw: text('raw', { mode: 'json' }).$type<Record<string, unknown>>().notNull().$defaultFn(() => ({})),
    updatedAt: text('updated_at').notNull().$defaultFn(nowIso).$onUpdateFn(nowIso),
  },
  (t) => [
    uniqueIndex('course_content_unique_idx').on(t.courseId, t.kind, t.externalId),
    index('course_content_course_idx').on(t.courseId),
  ],
);

export const widgetInstances = sqliteTable('widget_instances', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  config: text('config', { mode: 'json' }).$type<Record<string, unknown>>().notNull().$defaultFn(() => ({})),
  hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull().$defaultFn(nowIso),
});

export const layouts = sqliteTable('layouts', {
  breakpoint: text('breakpoint').primaryKey(),
  layout: text('layout', { mode: 'json' }).$type<LayoutItem[]>().notNull(),
  updatedAt: text('updated_at').notNull().$defaultFn(nowIso).$onUpdateFn(nowIso),
});

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).$type<unknown>().notNull(),
  updatedAt: text('updated_at').notNull().$defaultFn(nowIso).$onUpdateFn(nowIso),
});

export type SourceRow = typeof sources.$inferSelect;
export type CourseRow = typeof courses.$inferSelect;
export type ItemRow = typeof items.$inferSelect;
export type NewItemRow = typeof items.$inferInsert;
export type OverrideRow = typeof overrides.$inferSelect;
export type JobRow = typeof jobs.$inferSelect;
export type JobStateRow = typeof jobState.$inferSelect;
export type CourseContentRow = typeof courseContent.$inferSelect;
export type WidgetInstanceRow = typeof widgetInstances.$inferSelect;
