import { spawnSync } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { FILE_SYNC_SKIP, allowedTargets, decideFile, type FileSyncDecision, type FileSyncFileView, type FileSyncManifestCourse, type FileSyncReport } from '@collected/shared';
import { Api, type SyncApi } from './api.js';
import { classify, loadModel } from './classify.js';
import { courseIndexPath, knownTargets, targetDir, type AgentConfig } from './config.js';
import { cachePathFor, chooseLinkName, linkOrCopy, placementUnmodified, removePlacement, renderIndex, sha256File, writeIndex, type IndexEntry } from './place.js';
import { loadState, saveState, stateKey, type Placement } from './state.js';

export interface SyncOptions {
  dryRun?: boolean;
  /** Course id or code; everything when absent. */
  course?: string;
  /** Skip the model even if courses ask for it. */
  noModel?: boolean;
  log?: (line: string) => void;
  /** Tests inject a fake; production builds one from the config. */
  api?: SyncApi;
}

export interface SyncSummary {
  courses: number;
  placed: number;
  updated: number;
  moved: number;
  removed: number;
  skipped: number;
  unchanged: number;
  pending: number;
  classified: number;
  errors: FileSyncReport['errors'];
}

const nowIso = () => new Date().toISOString();

/**
 * One pass: manifest → decide → download into the cache → hard-link into targets → indexes → report.
 * Dry run changes nothing on disk and reports only model decisions, so the web UI can preview the plan.
 */
export async function runSync(cfg: AgentConfig, opts: SyncOptions = {}): Promise<SyncSummary> {
  const log = opts.log ?? (() => {});
  const api: SyncApi = opts.api ?? new Api(cfg);
  const state = loadState();
  const manifest = await api.getManifest();
  const report: FileSyncReport = { device: cfg.device, model: false, targets: {}, decisions: [], placed: [], removed: [], errors: [] };
  const sum: SyncSummary = { courses: 0, placed: 0, updated: 0, moved: 0, removed: 0, skipped: 0, unchanged: 0, pending: 0, classified: 0, errors: report.errors };
  const err = (message: string, courseId?: string, fileId?: string) => {
    report.errors.push({ courseId, fileId, message });
    log(`  ! ${message}`);
  };
  const placedPaths: string[] = [];
  const placedCourses = new Set<string>();
  const indexDirs = new Map<string, { courseId: string; courseCode: string; target: string }>();

  for (const mc of manifest.courses) {
    if (opts.course && mc.course.id !== opts.course && mc.course.code.toLowerCase() !== opts.course.toLowerCase()) continue;
    sum.courses++;
    const { config } = mc;
    report.targets[mc.course.id] = knownTargets(cfg, mc.course.id, allowedTargets(config));
    if (!cfg.courses[mc.course.id]) {
      log(`${mc.course.code}: no folder on this machine (collected-agent link ${mc.course.id} <path>); ${mc.files.length} files waiting`);
      continue;
    }
    log(`${mc.course.code}: ${mc.files.length} files`);

    // Model pass for files nothing else decided.
    const decisions = new Map<string, FileSyncDecision | null>(mc.files.map((f) => [f.fileId, f.decision]));
    const pending = mc.files.filter((f) => !f.decision);
    if (pending.length && config.fallback === 'model' && cfg.model.enabled && !opts.noModel) {
      try {
        const model = await loadModel(log);
        report.model = true;
        for (const f of pending) {
          const ans = await classify(model, config, f);
          report.decisions.push({ courseId: mc.course.id, fileId: f.fileId, target: ans.target, confidence: ans.confidence, probabilities: ans.probabilities });
          decisions.set(f.fileId, decideFile(config, f, { manualTarget: f.manualTarget, model: ans }));
          sum.classified++;
          log(`  model: ${f.filename} → ${ans.target}${ans.confidence != null ? ` (${ans.confidence.toFixed(2)})` : ''}`);
        }
      } catch (e) {
        err(`model failed: ${(e as Error).message}`, mc.course.id);
      }
    }

    const missingTargetWarned = new Set<string>();
    for (const f of mc.files) {
      const decision = decisions.get(f.fileId) ?? null;
      const key = stateKey(mc.course.id, f.fileId);
      const prev = state.placements[key] ?? null;
      if (!decision) {
        sum.pending++;
        continue;
      }
      if (decision.target === FILE_SYNC_SKIP) {
        sum.skipped++;
        if (prev) {
          if (opts.dryRun) log(`  would remove ${rel(prev.localPath)} (now skipped)`);
          else if (removePlacement(prev)) {
            delete state.placements[key];
            report.removed.push({ courseId: mc.course.id, fileId: f.fileId });
            sum.removed++;
            log(`  removed ${rel(prev.localPath)} (skipped)`);
          } else err(`${rel(prev.localPath)} was changed locally; left in place although it is now skipped`, mc.course.id, f.fileId);
        }
        continue;
      }
      const dir = targetDir(cfg, mc.course.id, decision.target);
      if (!dir) {
        if (!missingTargetWarned.has(decision.target)) {
          missingTargetWarned.add(decision.target);
          err(`no folder for target "${decision.target}" (collected-agent link ${mc.course.id} ${decision.target} <path>)`, mc.course.id);
        }
        continue;
      }
      indexDirs.set(dir, { courseId: mc.course.id, courseCode: mc.course.code, target: decision.target });

      const upToDate = prev && prev.updatedAt === f.updatedAt && path.dirname(prev.localPath) === dir && existsSync(prev.localPath);
      if (upToDate) {
        sum.unchanged++;
        continue;
      }
      const action = !prev ? 'new' : path.dirname(prev.localPath) !== dir ? 'move' : 'update';
      log(`  ${action}: ${f.filename} → ${decision.target}/ (${decision.reason})`);
      if (opts.dryRun) {
        if (action === 'new') sum.placed++;
        else if (action === 'move') sum.moved++;
        else sum.updated++;
        continue;
      }
      try {
        const cachePath = cachePathFor(cfg.cacheDir, f);
        if (!existsSync(cachePath)) await api.download(f.fileId, cachePath);
        if (prev) {
          if (action === 'update' && placementUnmodified(prev)) unlinkSync(prev.localPath);
          else if (action === 'move' && !removePlacement(prev)) err(`${rel(prev.localPath)} was changed locally; left there, new copy goes to ${decision.target}/`, mc.course.id, f.fileId);
          // update + modified: keep theirs; chooseLinkName picks a (v2) name
        }
        const name = chooseLinkName(dir, f.filename, cachePath, prev);
        const dest = path.join(dir, name);
        if (!existsSync(dest)) linkOrCopy(cachePath, dest, cfg.linkMode ?? 'hardlink');
        const placement: Placement = { courseId: mc.course.id, fileId: f.fileId, target: decision.target, localPath: dest, sha256: sha256File(cachePath), updatedAt: f.updatedAt, cachePath, placedAt: nowIso() };
        state.placements[key] = placement;
        report.placed.push({ courseId: mc.course.id, fileId: f.fileId, target: decision.target, localPath: dest });
        placedPaths.push(dest);
        placedCourses.add(mc.course.code);
        if (action === 'new') sum.placed++;
        else if (action === 'move') sum.moved++;
        else sum.updated++;
      } catch (e) {
        err(`${f.filename}: ${(e as Error).message}`, mc.course.id, f.fileId);
      }
    }
  }

  if (!opts.dryRun) {
    // Indexes: one per course when the course has an `index` path, else a `_collected.md` in each target folder.
    const perCourse = new Set<string>();
    for (const [dir, info] of indexDirs) {
      const indexFile = courseIndexPath(cfg, info.courseId);
      if (indexFile) {
        if (perCourse.has(info.courseId)) continue;
        perCourse.add(info.courseId);
        const entries = indexEntries(cfg, state, manifest.courses, info.courseId, null, path.dirname(indexFile));
        if (entries.length || existsSync(indexFile)) writeIndex(indexFile, renderIndex(`${info.courseCode} · Canvas files`, entries));
        continue;
      }
      const file = path.join(dir, '_collected.md');
      const entries = indexEntries(cfg, state, manifest.courses, info.courseId, dir, dir);
      // No index (and no folder) for a target nothing has landed in yet; an existing index is kept current, even at zero.
      if (entries.length || existsSync(file)) writeIndex(file, renderIndex(`${info.courseCode} · ${info.target}`, entries));
    }
    state.lastRunAt = nowIso();
    saveState(state);
    if (placedPaths.length && cfg.onPlace) {
      log(`running onPlace hook for ${placedPaths.length} file${placedPaths.length === 1 ? '' : 's'}`);
      const r = spawnSync('/bin/sh', ['-c', cfg.onPlace], { stdio: 'inherit', env: { ...process.env, COLLECTED_PLACED: placedPaths.join('\n'), COLLECTED_COURSES: [...placedCourses].join(',') } });
      if (r.status !== 0) err(`onPlace hook exited ${r.status}`);
    }
  }
  try {
    await api.postReport(report);
  } catch (e) {
    err(`report failed: ${(e as Error).message}`);
  }
  return sum;
}

/** Placements of a course (in one folder, or all when `dir` is null) as index rows with links relative to `linkBase`. */
function indexEntries(cfg: AgentConfig, state: ReturnType<typeof loadState>, courses: FileSyncManifestCourse[], courseId: string, dir: string | null, linkBase: string): IndexEntry[] {
  const files = new Map<string, FileSyncFileView>(courses.find((c) => c.course.id === courseId)?.files.map((f) => [f.fileId, f]) ?? []);
  const out: IndexEntry[] = [];
  for (const p of Object.values(state.placements)) {
    if (p.courseId !== courseId || (dir && path.dirname(p.localPath) !== dir) || !existsSync(p.localPath)) continue;
    const f = files.get(p.fileId);
    if (!f) continue;
    out.push({ file: f, localPath: p.localPath, href: path.relative(linkBase, p.localPath), target: p.target, openUrl: `${cfg.server.replace(/\/$/, '')}/api/canvas/files/${p.fileId}/open` });
  }
  return out;
}

const rel = (p: string): string => p.replace(process.env.HOME ?? '~', '~');
