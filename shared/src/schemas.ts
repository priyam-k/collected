import { z } from 'zod';
import { COURSE_EVENT_KINDS, COURSE_ROLES, INGESTED_SOURCE_IDS, JOB_STATES, SUBMITS_VIA, BREAKPOINTS } from './types.js';

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export const meetingSchema = z.object({
  day: z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']),
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
  location: z.string().optional(),
});

/** Any kind works as a key; unknown kinds used to be stripped silently, which is how a typed-in `lab` vanished. */
export const meetingKindSchema = z.string().regex(/^[a-z][a-z0-9_]*$/, 'kind must be lowercase letters, digits, underscores');
export const courseScheduleSchema = z.record(meetingKindSchema, z.array(meetingSchema));

export const courseLinkSchema = z.object({ label: z.string().min(1), url: z.string().url() });

export const gradeCategorySchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  weight: z.number().min(0).max(100).nullable().default(null),
  groupIds: z.array(z.string()).default([]),
  match: z.string().nullable().default(null),
  dropLowest: z.number().int().min(0).default(0),
});
export const gradingConfigSchema = z.object({
  mode: z.enum(['auto', 'manual']).default('auto'),
  categories: z.array(gradeCategorySchema).default([]),
});

export const courseInputSchema = z.object({
  term: z.string().min(1),
  code: z.string().min(1).transform((s) => s.toUpperCase().replace(/\s+/g, '')),
  section: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  role: z.enum(COURSE_ROLES).default('student'),
  canvasCourseId: z.string().nullable().optional(),
  gradescopeCourseId: z.string().nullable().optional(),
  submitsVia: z.enum(SUBMITS_VIA).default('both'),
  color: z.string().nullable().optional(),
  links: z.array(courseLinkSchema).default([]),
  schedule: courseScheduleSchema.default({}),
  notes: z.string().nullable().optional(),
  archived: z.boolean().default(false),
  grading: gradingConfigSchema.nullable().optional(),
});
export type CourseInput = z.infer<typeof courseInputSchema>;

export const jobsFilterSchema = z.object({
  require_active: z.boolean().default(true),
  require_visible: z.boolean().default(true),
  categories_include: z.array(z.string()).default([]),
  terms_include: z.array(z.string()).default([]),
  title_include: z.string().default(''),
  title_exclude: z.string().default(''),
  locations_include: z.string().default(''),
  locations_exclude: z.string().default(''),
  sponsorship: z.enum(['ignore', 'require_none_needed']).default('ignore'),
});

export const todoistPushConfigSchema = z.object({
  enabled: z.boolean().default(false),
  projectId: z.string().nullable().default(null),
  projectName: z.string().default('School'),
  commonLabel: z.string().default('homework'),
  courseLabels: z.boolean().default(true),
});

/** artifacts/seed-config.json */
export const seedConfigSchema = z.object({
  term: z.string(),
  courses: z.array(
    z.object({
      code: z.string(),
      section: z.string().optional(),
      name: z.string().optional(),
      role: z.enum(COURSE_ROLES).default('student'),
      submits_via: z.enum(SUBMITS_VIA).default('both'),
      gradescope_course_id: z.union([z.string(), z.number()]).nullable().optional(),
      canvas_course_id: z.union([z.string(), z.number()]).nullable().optional(),
      links: z.array(courseLinkSchema).default([]),
      schedule: courseScheduleSchema.default({}),
    }),
  ),
  todoist: z
    .object({
      project_name: z.string().default('School'),
      common_label: z.string().default('homework'),
      push_sync_enabled: z.boolean().default(false),
    })
    .partial()
    .optional(),
  jobs: z
    .object({
      sources: z.array(z.object({ id: z.string(), url: z.string().url() })).default([]),
      filter: jobsFilterSchema.partial().optional(),
    })
    .optional(),
});
export type SeedConfig = z.infer<typeof seedConfigSchema>;

export const layoutItemSchema = z.object({
  i: z.string(),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1),
  h: z.number().int().min(1),
  minW: z.number().int().optional(),
  minH: z.number().int().optional(),
  maxW: z.number().int().optional(),
  maxH: z.number().int().optional(),
});
export const layoutsSchema = z.partialRecord(z.enum(BREAKPOINTS), z.array(layoutItemSchema));

export const widgetInstanceInputSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  config: z.record(z.string(), z.unknown()).default({}),
  hidden: z.boolean().default(false),
});

export const overrideInputSchema = z.object({
  hidden: z.boolean().optional(),
  done: z.boolean().optional(),
  snoozedUntil: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
});

export const jobStatePatchSchema = z.object({
  state: z.enum(JOB_STATES).optional(),
  notes: z.string().nullable().optional(),
  appliedAt: isoDay.nullable().optional(),
  nextAction: z.string().nullable().optional(),
  nextActionAt: isoDay.nullable().optional(),
  resumePath: z.string().nullable().optional(),
});

/** A job you add by hand (not from the feed): referral, career fair, a company site. */
export const manualJobInputSchema = z.object({
  company: z.string().trim().min(1),
  title: z.string().trim().min(1),
  url: z.union([z.string().url(), z.literal('')]).default(''),
  locations: z.array(z.string().trim().min(1)).default([]),
  state: z.enum(JOB_STATES).default('applied'),
  appliedAt: isoDay.nullable().optional(),
  notes: z.string().nullable().optional(),
});
export type ManualJobInput = z.infer<typeof manualJobInputSchema>;

export const sourceIdSchema = z.enum(INGESTED_SOURCE_IDS);

const hhmm = z.string().regex(/^\d{2}:\d{2}$/, 'expected HH:MM');

/** A hand-entered course date: exam, quiz, final, a cancelled or virtual session, or a note on a day. */
export const manualEventInputSchema = z
  .object({
    courseId: z.string().nullable().default(null),
    kind: z.enum(COURSE_EVENT_KINDS).default('other'),
    title: z.string().trim().min(1),
    date: isoDay,
    start: hhmm.nullable().optional(),
    end: hhmm.nullable().optional(),
    location: z.string().trim().nullable().optional(),
    note: z.string().trim().nullable().optional(),
    meetingKind: meetingKindSchema.nullable().optional(),
  })
  .refine((v) => !v.end || !!v.start, { message: 'end needs a start', path: ['end'] })
  .refine((v) => !v.start || !v.end || v.end > v.start, { message: 'end must be after start', path: ['end'] });
export type ManualEventInput = z.infer<typeof manualEventInputSchema>;

// Per-source config bodies (secrets). Stored encrypted; never returned by the API.
export const sourceConfigSchemas = {
  canvas: z.object({
    baseUrl: z.string().url().default('https://umd.instructure.com'),
    cookieHeader: z.string().optional(), // raw "name=value; name2=value2" pasted from the browser
    cookieJar: z.unknown().optional(), // serialized tough-cookie jar, maintained by the ingester
  }),
  canvas_ical: z.object({ url: z.string().url() }),
  gradescope: z.object({ email: z.string().email(), password: z.string().min(1) }),
  gcal: z.object({ refreshToken: z.string().min(1) }),
  todoist: z.object({ token: z.string().min(1) }),
  jobs: z.object({ sources: z.array(z.object({ id: z.string(), url: z.string().url() })).default([]) }),
} as const;
