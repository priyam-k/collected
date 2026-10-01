import { and, asc, eq, inArray } from 'drizzle-orm';
import {
  decideFile,
  fileSyncConfigSchema,
  type FileSyncConfig,
  type FileSyncDevice,
  type FileSyncFile,
  type FileSyncFileView,
  type FileSyncManifest,
  type FileSyncManifestCourse,
  type FileSyncReport,
} from '@collected/shared';
import type { AppContext } from '../context.js';
import { courseContent, courses, fileSyncState, type CourseRow, type FileSyncStateRow } from '../db/schema.js';
import { nowIso } from './time.js';
import { getSetting, setSetting } from './settings.js';

export const DEVICES_SETTING = 'fileSync.devices';

/** The course's config with schema defaults applied; null when sync was never set up. */
export function configOf(course: Pick<CourseRow, 'fileSync'>): FileSyncConfig | null {
  if (!course.fileSync) return null;
  const parsed = fileSyncConfigSchema.safeParse(course.fileSync);
  return parsed.success ? parsed.data : null;
}

/** Canvas file rows of a course as the sync sees them (`course_content` kind=file). */
export async function listSyncFiles(ctx: AppContext, courseId: string): Promise<FileSyncFile[]> {
  const rows = await ctx.db
    .select()
    .from(courseContent)
    .where(and(eq(courseContent.courseId, courseId), eq(courseContent.kind, 'file')))
    .orderBy(asc(courseContent.position));
  return rows.map((r) => {
    const raw = r.raw as { size?: number | null; contentType?: string | null; updatedAt?: string | null; folderPath?: string | null; modulePosition?: number | null };
    return {
      courseId,
      fileId: r.externalId,
      title: r.title,
      // Canvas's display name: what the course page shows. The upload name (raw.filename) is URL-encoded and often a
      // leftover from the instructor's disk ("Chapter4+2.pdf" for "Lecture9_Sept29.pdf").
      filename: r.title,
      folderPath: raw.folderPath ?? null,
      moduleName: r.moduleName,
      modulePosition: raw.modulePosition ?? null,
      contentType: raw.contentType ?? null,
      size: raw.size ?? null,
      updatedAt: raw.updatedAt ?? null,
    };
  });
}

function toView(file: FileSyncFile, config: FileSyncConfig, st: FileSyncStateRow | undefined): FileSyncFileView {
  const model = st?.modelTarget ? { target: st.modelTarget, confidence: st.modelConfidence, probabilities: st.modelProbabilities ?? null, at: st.modelAt ?? st.updatedAt } : null;
  const decision = decideFile(config, file, { manualTarget: st?.manualTarget ?? null, model: model ? { target: model.target, confidence: model.confidence } : null });
  const placed =
    st?.placedTarget && st.placedPath && st.placedDevice && st.placedAt ? { target: st.placedTarget, localPath: st.placedPath, device: st.placedDevice, placedAt: st.placedAt } : null;
  return { ...file, decision, model, manualTarget: st?.manualTarget ?? null, placed };
}

/** Every file of one course with its effective decision, model answer, override, and last placement. */
export async function courseView(ctx: AppContext, course: CourseRow): Promise<FileSyncManifestCourse | null> {
  const config = configOf(course);
  if (!config) return null;
  const files = await listSyncFiles(ctx, course.id);
  const state = files.length ? await ctx.db.select().from(fileSyncState).where(eq(fileSyncState.courseId, course.id)) : [];
  const byFile = new Map(state.map((s) => [s.fileId, s]));
  return {
    course: { id: course.id, code: course.code, color: course.color },
    config,
    files: files.map((f) => toView(f, config, byFile.get(f.fileId))),
  };
}

/** What the agent pulls: every enabled, non-archived course. */
export async function buildManifest(ctx: AppContext): Promise<FileSyncManifest> {
  const rows = await ctx.db.select().from(courses).where(eq(courses.archived, false));
  const out: FileSyncManifestCourse[] = [];
  for (const c of rows) {
    const cfg = configOf(c);
    if (!cfg?.enabled) continue;
    const view = await courseView(ctx, c);
    if (view) out.push(view);
  }
  return { generatedAt: nowIso(), courses: out };
}

export async function setManualTarget(ctx: AppContext, courseId: string, fileId: string, target: string | null): Promise<void> {
  await ctx.db
    .insert(fileSyncState)
    .values({ courseId, fileId, manualTarget: target })
    .onConflictDoUpdate({ target: [fileSyncState.courseId, fileSyncState.fileId], set: { manualTarget: target, updatedAt: nowIso() } });
}

export async function listDevices(ctx: AppContext): Promise<FileSyncDevice[]> {
  const all = (await getSetting<Record<string, FileSyncDevice>>(ctx, DEVICES_SETTING)) ?? {};
  return Object.values(all).sort((a, b) => b.lastRunAt.localeCompare(a.lastRunAt));
}

/** Records what a device did: model answers, placements, removals, and its target paths. */
export async function applyReport(ctx: AppContext, report: FileSyncReport): Promise<{ decisions: number; placed: number; removed: number }> {
  const now = nowIso();
  const key = (courseId: string, fileId: string) => `${courseId}\u0000${fileId}`;
  const touched = new Map<string, Partial<typeof fileSyncState.$inferInsert> & { courseId: string; fileId: string }>();
  const upsert = (courseId: string, fileId: string, patch: Partial<typeof fileSyncState.$inferInsert>) => {
    const k = key(courseId, fileId);
    touched.set(k, { ...(touched.get(k) ?? { courseId, fileId }), ...patch });
  };
  for (const d of report.decisions) upsert(d.courseId, d.fileId, { modelTarget: d.target, modelConfidence: d.confidence, modelProbabilities: d.probabilities, modelAt: now });
  for (const p of report.placed) upsert(p.courseId, p.fileId, { placedTarget: p.target, placedPath: p.localPath, placedDevice: report.device, placedAt: now });
  for (const r of report.removed) upsert(r.courseId, r.fileId, { placedTarget: null, placedPath: null, placedDevice: null, placedAt: null });

  if (touched.size) {
    // Only touch rows for courses that exist; a stale agent could otherwise write junk.
    const courseIds = [...new Set([...touched.values()].map((t) => t.courseId))];
    const known = new Set((await ctx.db.select({ id: courses.id }).from(courses).where(inArray(courses.id, courseIds))).map((r) => r.id));
    for (const t of touched.values()) {
      if (!known.has(t.courseId)) continue;
      const { courseId, fileId, ...patch } = t;
      await ctx.db
        .insert(fileSyncState)
        .values({ courseId, fileId, ...patch })
        .onConflictDoUpdate({ target: [fileSyncState.courseId, fileSyncState.fileId], set: { ...patch, updatedAt: now } });
    }
  }

  const devices = (await getSetting<Record<string, FileSyncDevice>>(ctx, DEVICES_SETTING)) ?? {};
  devices[report.device] = { device: report.device, lastRunAt: now, model: report.model, targets: report.targets, errors: report.errors.slice(0, 50) };
  await setSetting(ctx, DEVICES_SETTING, devices);

  return { decisions: report.decisions.length, placed: report.placed.length, removed: report.removed.length };
}
