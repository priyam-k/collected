import { z } from 'zod';
import { COURSE_EVENT_KINDS, COURSE_ROLES, FILE_SYNC_FALLBACKS, FILE_SYNC_RESERVED_TARGETS, FILE_SYNC_SKIP, INGESTED_SOURCE_IDS, JOB_STATES, SUBMITS_VIA, BREAKPOINTS } from './types.js';

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

/** Free text the UI shows; bounded so a bad client cannot park megabytes in one row. */
const text = (max: number) => z.string().max(max);
/** A link the UI will render as an href: http(s) only. */
export const httpUrlSchema = z
  .string()
  .max(2048)
  .url()
  .refine((u) => /^https?:\/\//i.test(u), { message: 'must start with http:// or https://' });

const PRIVATE_HOST = /^(localhost|.*\.localhost|.*\.local|.*\.internal|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|0\.\d+\.\d+\.\d+|\[?::1\]?|\[?fe80:.*|\[?f[cd][0-9a-f]{2}:.*)$/i;
/**
 * A URL the server will fetch on the user's behalf (Canvas host, iCal feed, job feed): https to a public host, or
 * plain http to loopback for a development fixture server. Keeps the server from being pointed at its own network.
 */
export const outboundUrlSchema = z
  .string()
  .max(2048)
  .url()
  .refine(
    (raw) => {
      try {
        const u = new URL(raw);
        if (u.username || u.password) return false;
        const priv = PRIVATE_HOST.test(u.hostname);
        if (u.protocol === 'https:') return !priv;
        if (u.protocol === 'http:') return /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname);
        return false;
      } catch {
        return false;
      }
    },
    { message: 'must be an https URL to a public host' },
  );

export const meetingSchema = z.object({
  day: z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']),
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
  location: z.string().optional(),
});

/** Any kind works as a key; unknown kinds used to be stripped silently, which is how a typed-in `lab` vanished. */
export const meetingKindSchema = z.string().regex(/^[a-z][a-z0-9_]*$/, 'kind must be lowercase letters, digits, underscores');
export const courseScheduleSchema = z.record(meetingKindSchema, z.array(meetingSchema));

export const courseLinkSchema = z.object({ label: text(200).min(1), url: httpUrlSchema });

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

const regexString = z.string().refine(
  (v) => {
    try {
      new RegExp(v, 'i');
      return true;
    } catch {
      return false;
    }
  },
  { message: 'not a valid regex' },
);
const targetName = z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_-]*$/, 'lowercase letters, digits, - and _');

export const fileSyncTargetSchema = z.object({ name: targetName, description: z.string().trim().default('') });
export const fileSyncRuleSchema = z.object({
  target: targetName,
  folder: regexString.nullable().default(null),
  module: regexString.nullable().default(null),
  name: regexString.nullable().default(null),
  largerThanMb: z.number().min(0).nullable().default(null),
  linked: regexString.nullable().default(null),
  flatten: z.boolean().default(false),
});
export const fileSyncConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    targets: z.array(fileSyncTargetSchema).default([]),
    rules: z.array(fileSyncRuleSchema).default([]),
    fallback: z.enum(FILE_SYNC_FALLBACKS).default('model'),
    threshold: z.number().min(0).max(1).default(0.6),
    skipHint: z.string().trim().default('duplicates, temporary or scratch files, and anything not worth keeping'),
  })
  .superRefine((cfg, ctx) => {
    const names = cfg.targets.map((t) => t.name);
    for (const n of names) {
      if ((FILE_SYNC_RESERVED_TARGETS as readonly string[]).includes(n)) ctx.addIssue({ code: 'custom', message: `"${n}" is reserved`, path: ['targets'] });
    }
    if (new Set(names).size !== names.length) ctx.addIssue({ code: 'custom', message: 'target names must be unique', path: ['targets'] });
    cfg.rules.forEach((r, i) => {
      if (!names.includes(r.target) && r.target !== FILE_SYNC_SKIP) ctx.addIssue({ code: 'custom', message: `rule ${i + 1} points at unknown target "${r.target}"`, path: ['rules', i, 'target'] });
      if (!r.folder && !r.module && !r.name && !r.linked && r.largerThanMb == null) ctx.addIssue({ code: 'custom', message: `rule ${i + 1} has nothing to match`, path: ['rules', i] });
    });
  });

/** Manual override for one file: a target name, `skip`, or null to go back to rules/model. */
export const fileSyncOverrideSchema = z.object({ target: targetName.nullable() });

/** What the agent posts after a run. */
export const fileSyncReportSchema = z.object({
  device: z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/, 'letters, digits, space, . _ -'),
  model: z.boolean().default(false),
  targets: z.record(text(120), z.record(targetName, text(1024))).default({}),
  decisions: z
    .array(z.object({ courseId: text(120), fileId: text(120), target: targetName, confidence: z.number().min(0).max(1).nullable(), probabilities: z.record(targetName, z.number().min(0).max(1)).nullable().default(null) }))
    .max(5000)
    .default([]),
  placed: z.array(z.object({ courseId: text(120), fileId: text(120), target: targetName, localPath: text(1024) })).max(5000).default([]),
  removed: z.array(z.object({ courseId: text(120), fileId: text(120) })).max(5000).default([]),
  errors: z.array(z.object({ courseId: text(120).optional(), fileId: text(120).optional(), message: text(1000) })).max(200).default([]),
});
export type FileSyncReport = z.infer<typeof fileSyncReportSchema>;

export const courseInputSchema = z.object({
  term: text(40).min(1),
  code: text(40).min(1).transform((s) => s.toUpperCase().replace(/\s+/g, '')),
  section: text(40).nullable().optional(),
  name: text(200).nullable().optional(),
  role: z.enum(COURSE_ROLES).default('student'),
  canvasCourseId: z.string().nullable().optional(),
  gradescopeCourseId: z.string().nullable().optional(),
  submitsVia: z.enum(SUBMITS_VIA).default('both'),
  color: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, 'expected a hex color').nullable().optional(),
  links: z.array(courseLinkSchema).max(50).default([]),
  schedule: courseScheduleSchema.default({}),
  notes: text(20_000).nullable().optional(),
  archived: z.boolean().default(false),
  grading: gradingConfigSchema.nullable().optional(),
  fileSync: fileSyncConfigSchema.nullable().optional(),
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
  note: text(4000).nullable().optional(),
});

export const jobStatePatchSchema = z.object({
  state: z.enum(JOB_STATES).optional(),
  notes: text(10_000).nullable().optional(),
  appliedAt: isoDay.nullable().optional(),
  nextAction: text(500).nullable().optional(),
  nextActionAt: isoDay.nullable().optional(),
  resumePath: text(1024).nullable().optional(),
});

/** A job you add by hand (not from the feed): referral, career fair, a company site. */
export const manualJobInputSchema = z.object({
  company: text(200).trim().min(1),
  title: text(300).trim().min(1),
  url: z.union([httpUrlSchema, z.literal('')]).default(''),
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
    baseUrl: outboundUrlSchema.default('https://umd.instructure.com'),
    cookieHeader: z.string().optional(), // raw "name=value; name2=value2" pasted from the browser
    cookieJar: z.unknown().optional(), // serialized tough-cookie jar, maintained by the ingester
  }),
  canvas_ical: z.object({ url: outboundUrlSchema }),
  gradescope: z.object({ email: z.string().email(), password: z.string().min(1) }),
  gcal: z.object({ refreshToken: z.string().min(1) }),
  /** The "Secret address in iCal format" of one Google calendar; read-only, no OAuth client needed. */
  gcal_ical: z.object({ url: outboundUrlSchema }),
  todoist: z.object({ token: z.string().min(1) }),
  jobs: z.object({ sources: z.array(z.object({ id: z.string().regex(/^(?!manual$)[a-z0-9][a-z0-9_-]{0,39}$/, 'lowercase id; "manual" is reserved'), url: outboundUrlSchema })).max(20).default([]) }),
} as const;
