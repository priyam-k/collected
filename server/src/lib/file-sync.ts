import { and, asc, eq, inArray } from 'drizzle-orm';
import {
  allowedTargets,
  decideFile,
  FILE_SYNC_SKIP,
  fileSyncConfigSchema,
  type FileSyncConfig,
  type FileLinkedFrom,
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
    const raw = r.raw as { size?: number | null; contentType?: string | null; updatedAt?: string | null; folderPath?: string | null; modulePosition?: number | null; linkedFrom?: FileLinkedFrom | null };
    const linkedFrom = raw.linkedFrom ?? null;
    return {
      courseId,
      fileId: r.externalId,
      title: r.title,
      // Canvas's display name: what the course page shows. The upload name (raw.filename) is URL-encoded and often a
      // leftover from the instructor's disk ("Chapter4+2.pdf" for "Lecture9_Sept29.pdf").
      filename: r.title,
      // An assignment's attachment has no folder the user can see; its home is the assignment (Assignments/<title>/).
      folderPath: raw.folderPath ?? (linkedFrom?.kind === 'assignment' ? `/${linkedFrom.title.replace(/[\\/]+/g, '-').trim()}` : null),
      moduleName: r.moduleName,
      modulePosition: raw.modulePosition ?? null,
      contentType: raw.contentType ?? null,
      size: raw.size ?? null,
      updatedAt: raw.updatedAt ?? null,
      linkedFrom,
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

/**
 * Records what a device did: model answers, placements, removals, and its target paths. Rows are written only for
 * files the course actually has and targets its config names: the agent is a credential holder, not an oracle, and
 * `decideFile` would otherwise act on whatever target it reported.
 */
export async function applyReport(ctx: AppContext, report: FileSyncReport): Promise<{ decisions: number; placed: number; removed: number; ignored: number }> {
  const now = nowIso();
  const key = (courseId: string, fileId: string) => `${courseId}\u0000${fileId}`;
  const touched = new Map<string, Partial<typeof fileSyncState.$inferInsert> & { courseId: string; fileId: string }>();
  const courseIds = [...new Set([...report.decisions, ...report.placed, ...report.removed].map((r) => r.courseId))];
  const known = new Map<string, { targets: Set<string>; files: Set<string> }>();
  if (courseIds.length) {
    const rows = await ctx.db.select().from(courses).where(inArray(courses.id, courseIds));
    for (const c of rows) {
      const config = configOf(c);
      if (!config?.enabled) continue;
      known.set(c.id, { targets: new Set(allowedTargets(config)), files: new Set((await listSyncFiles(ctx, c.id)).map((f) => f.fileId)) });
    }
  }
  let ignored = 0;
  const upsert = (courseId: string, fileId: string, target: string | null, patch: Partial<typeof fileSyncState.$inferInsert>) => {
    const k = known.get(courseId);
    if (!k || !k.files.has(fileId) || (target && target !== FILE_SYNC_SKIP && !k.targets.has(target))) {
      ignored++;
      return;
    }
    const kk = key(courseId, fileId);
    touched.set(kk, { ...(touched.get(kk) ?? { courseId, fileId }), ...patch });
  };
  for (const d of report.decisions) upsert(d.courseId, d.fileId, d.target, { modelTarget: d.target, modelConfidence: d.confidence, modelProbabilities: d.probabilities, modelAt: now });
  for (const p of report.placed) upsert(p.courseId, p.fileId, p.target, { placedTarget: p.target, placedPath: p.localPath, placedDevice: report.device, placedAt: now });
  for (const r of report.removed) upsert(r.courseId, r.fileId, null, { placedTarget: null, placedPath: null, placedDevice: null, placedAt: null });
  if (ignored) ctx.log.warn({ device: report.device, ignored }, 'file sync report named files or targets the courses do not have');

  if (touched.size) {
    for (const t of touched.values()) {
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

  return { decisions: report.decisions.length, placed: report.placed.length, removed: report.removed.length, ignored };
}
