import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { FILE_SYNC_SKIP, allowedTargets, decideFile, type FileSyncDecision, type FileSyncFileView, type FileSyncManifestCourse, type FileSyncReport } from '@collected/shared';
import { Api, type SyncApi } from './api.js';
import { classify, modelUnavailable } from './classify.js';
import { courseFactsDir, courseIndexPath, courseRoot, knownTargets, targetDir, type AgentConfig } from './config.js';
import { writeFacts } from './facts.js';
import { badTarget, unsafePattern } from './guard.js';
import {
  assertInside,
  cachePathFor,
  findIdentical,
  fixMtime,
  handoutFor,
  isInside,
  isMarkdown,
  moveFile,
  mtimeMatches,
  placeFile,
  placementUnmodified,
  pruneEmptyDirs,
  removePlacement,
  renderIndex,
  resolveName,
  safeName,
  sha256File,
  sha256Text,
  subdirFor,
  versionName,
  writeIfChanged,
  writeTextAtomic,
  type IndexEntry,
  type SkippedEntry,
} from './place.js';
import { loadState, saveState, stateKey, type AgentState, type Placement } from './state.js';

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
  adopted: number;
  removed: number;
  skipped: number;
  unchanged: number;
  pending: number;
  classified: number;
  errors: FileSyncReport['errors'];
}

const nowIso = () => new Date().toISOString();
const rel = (p: string): string => (process.env.HOME ? p.replace(process.env.HOME, '~') : p);
const metaOf = (f: FileSyncFileView): NonNullable<Placement['meta']> => ({ title: f.title, folderPath: f.folderPath, moduleName: f.moduleName, modulePosition: f.modulePosition, size: f.size });

/**
 * One pass: manifest → decide → reconcile each file with what is on disk → indexes and course facts → report.
 *
 * Reconcile, per file: already here under any name with the same bytes → adopt it (it stays the user's). Placed
 * by us and untouched → follow the layout (rename, move) and Canvas (replace on a new version). Edited by the user
 * → never touched; a new version lands beside it. Deleted by the user → stays deleted until Canvas changes it.
 * Dry run changes nothing on disk and reports only model decisions, so the web UI can preview the plan.
 */
export async function runSync(cfg: AgentConfig, opts: SyncOptions = {}): Promise<SyncSummary> {
  const log = opts.log ?? (() => {});
  const api: SyncApi = opts.api ?? new Api(cfg);
  const state = loadState();
  const manifest = await api.getManifest();
  const report: FileSyncReport = { device: cfg.device, model: false, targets: {}, decisions: [], placed: [], removed: [], errors: [] };
  const sum: SyncSummary = { courses: 0, placed: 0, updated: 0, moved: 0, adopted: 0, removed: 0, skipped: 0, unchanged: 0, pending: 0, classified: 0, errors: report.errors };
  const err = (message: string, courseId?: string, fileId?: string) => {
    report.errors.push({ courseId, fileId, message });
    log(`  ! ${message}`);
  };
  const mode = cfg.linkMode ?? 'hardlink';
  const maxBytes = (cfg.maxFileMb ?? 100) * 1024 * 1024;
  const touchedPaths: string[] = [];
  const touchedCourses = new Map<string, string>(); // code → root
  const synced: FileSyncManifestCourse[] = [];
  const finalDecisions = new Map<string, Map<string, FileSyncDecision | null>>();

  for (const mc of manifest.courses) {
    if (opts.course && mc.course.id !== opts.course && mc.course.code.toLowerCase() !== opts.course.toLowerCase()) continue;
    sum.courses++;
    const courseId = mc.course.id;
    const allowed = allowedTargets(mc.config);
    report.targets[courseId] = knownTargets(cfg, courseId, allowed);
    if (!cfg.courses[courseId]) {
      log(`${mc.course.code}: no folder on this machine (collected-agent link ${courseId} <path>); ${mc.files.length} files waiting`);
      continue;
    }
    synced.push(mc);
    const root = courseRoot(cfg, courseId);
    log(`${mc.course.code}: ${mc.files.length} files`);
    const touch = (p: string) => {
      touchedPaths.push(p);
      if (root) touchedCourses.set(mc.course.code, root);
    };
    // Everything this course may touch: its root and every target folder this machine maps for it.
    const vaultRoots = [...new Set([...(root ? [root] : []), ...Object.values(report.targets[courseId]!)])];
    const assertVault = (p: string) => {
      if (!vaultRoots.some((r) => isInside(r, p))) throw new Error(`refusing to touch ${rel(p)}: outside this course's folders`);
    };
    const inVault = (p: string, fileId?: string): boolean => {
      try {
        assertVault(p);
        return true;
      } catch (e) {
        err((e as Error).message, courseId, fileId);
        return false;
      }
    };
    // Rule patterns are compiled here for files the model decides; a pattern built to backtrack is dropped, not run.
    const rules = mc.config.rules.filter((r) => {
      const why = unsafePattern(r.folder) ?? unsafePattern(r.module) ?? unsafePattern(r.name) ?? unsafePattern(r.linked);
      if (why) err(`rule → ${r.target} ignored: ${why}`, courseId);
      return !why;
    });
    const config = rules.length === mc.config.rules.length ? mc.config : { ...mc.config, rules };

    // ---- model pass for files nothing else decided
    const decisions = new Map<string, FileSyncDecision | null>(mc.files.map((f) => [f.fileId, f.decision]));
    const pending = mc.files.filter((f) => !f.decision);
    if (pending.length && config.fallback === 'model' && !opts.noModel) {
      const why = modelUnavailable(cfg.model);
      if (why) {
        if (cfg.model.enabled) err(`${pending.length} file${pending.length === 1 ? '' : 's'} waiting for the model, but ${why}`, courseId);
        else log(`  ${pending.length} file${pending.length === 1 ? '' : 's'} waiting for the model (${why})`);
      } else {
        report.model = true;
        for (const f of pending) {
          try {
            const ans = await classify(cfg.model, config, f);
            const bad = badTarget(ans.target, allowed);
            if (bad) throw new Error(bad); // classify() checks this too; the answer becomes a folder name, so check again here
            report.decisions.push({ courseId, fileId: f.fileId, target: ans.target, confidence: ans.confidence, probabilities: ans.probabilities });
            decisions.set(f.fileId, decideFile(config, f, { manualTarget: f.manualTarget, model: ans }));
            sum.classified++;
            log(`  model: ${f.filename} → ${ans.target}${ans.confidence != null ? ` (${ans.confidence.toFixed(2)})` : ''}`);
          } catch (e) {
            err(`model failed on ${f.filename}: ${(e as Error).message}`, courseId, f.fileId);
            if (/check the API key/.test((e as Error).message)) break; // every call would fail the same way
          }
        }
      }
    }

    finalDecisions.set(courseId, decisions);

    // ---- fold: a copy we placed that turns out to duplicate a file the user already had goes away; theirs is adopted.
    const ours = () => new Set(Object.values(state.placements).map((p) => p.localPath));
    if (root) {
      for (const p of Object.values(state.placements)) {
        if (p.courseId !== courseId || p.adopted || p.handout || !existsSync(p.localPath) || !placementUnmodified(p)) continue;
        const twin = findIdentical(root, p.localPath, ours());
        if (!twin) continue;
        if (opts.dryRun) {
          log(`  would fold ${rel(p.localPath)} onto your identical ${path.basename(twin)}`);
          continue;
        }
        if (!vaultRoots.some((r) => isInside(r, p.localPath))) continue; // a hand-pulled copy elsewhere: not ours to fold
        unlinkSync(p.localPath);
        pruneEmptyDirs(path.dirname(p.localPath), root);
        log(`  folded ${path.basename(p.localPath)} onto your identical ${rel(twin)}`);
        state.placements[stateKey(courseId, p.fileId)] = { ...p, localPath: twin, desired: twin, adopted: true, placedAt: nowIso() };
        report.placed.push({ courseId, fileId: p.fileId, target: p.target, localPath: twin });
        sum.adopted++;
      }
    }

    // ---- reconcile each file
    const missingTargetWarned = new Set<string>();
    for (const f of mc.files) {
      const decision = decisions.get(f.fileId) ?? null;
      const key = stateKey(courseId, f.fileId);
      const prev = state.placements[key] ?? null;
      if (!decision) {
        sum.pending++;
        continue;
      }
      const tooBig = f.size != null && f.size > maxBytes;
      if (decision.target === FILE_SYNC_SKIP || tooBig) {
        sum.skipped++;
        if (tooBig && decision.target !== FILE_SYNC_SKIP && !prev) log(`  skipped ${f.filename}: ${(f.size! / 1024 / 1024).toFixed(0)} MB is over this machine's ${cfg.maxFileMb ?? 100} MB cap`);
        if (!prev || prev.pulled) continue; // pulled by hand: kept although the rules skip it
        if (prev.adopted) {
          if (!opts.dryRun) delete state.placements[key]; // theirs: stays on disk, just no longer tracked
          continue;
        }
        if (opts.dryRun) log(`  would remove ${rel(prev.localPath)} (now skipped: ${decision.reason})`);
        else if (!inVault(prev.localPath, f.fileId)) continue;
        else if (removePlacement(prev)) {
          delete state.placements[key];
          report.removed.push({ courseId, fileId: f.fileId });
          sum.removed++;
          if (root) pruneEmptyDirs(path.dirname(prev.localPath), root);
          log(`  removed ${rel(prev.localPath)} (skipped: ${decision.reason})`);
        } else err(`${rel(prev.localPath)} was changed locally; left in place although it is now skipped`, courseId, f.fileId);
        continue;
      }
      // The manifest's target is a name the server validated; this machine checks again before it becomes a path.
      const bad = badTarget(decision.target, allowed);
      if (bad) {
        if (!missingTargetWarned.has(decision.target)) {
          missingTargetWarned.add(decision.target);
          err(`${bad}; its files are left alone`, courseId);
        }
        continue;
      }
      const dir = targetDir(cfg, courseId, decision.target);
      if (!dir) {
        if (!missingTargetWarned.has(decision.target)) {
          missingTargetWarned.add(decision.target);
          err(`no folder for target "${decision.target}" (collected-agent link ${courseId} ${decision.target} <path>)`, courseId);
        }
        continue;
      }
      const wantDir = path.join(dir, subdirFor(f.folderPath, !!decision.flatten));
      const md = isMarkdown(f.filename);
      const sameVersion = !!prev && prev.updatedAt === f.updatedAt;
      const legacyHandout = md && !!prev && !prev.handout && !prev.adopted; // placed before handouts were transformed

      if (prev && sameVersion && !legacyHandout) {
        if (prev.adopted || !existsSync(prev.localPath)) {
          // Adopted files are the user's and stay wherever they are; a file the user deleted stays deleted.
          if (prev.target !== decision.target && !opts.dryRun) state.placements[key] = { ...prev, target: decision.target, meta: metaOf(f) };
          sum.unchanged++;
          continue;
        }
        const wantName = prev.handout ? path.basename(prev.desired ?? prev.localPath) : safeName(f.filename);
        const wantPath = path.join(wantDir, wantName);
        if (prev.desired === wantPath || (!prev.desired && prev.localPath === wantPath)) {
          if (!opts.dryRun) {
            if (!mtimeMatches(prev.localPath, f.updatedAt) && placementUnmodified(prev)) fixMtime(prev.localPath, f.updatedAt);
            state.placements[key] = { ...prev, desired: wantPath, target: decision.target, meta: metaOf(f) };
          }
          sum.unchanged++;
          continue;
        }
        // Same bytes, new home: the display name, the target, or the folder layout changed.
        log(`  move: ${rel(prev.localPath)} → ${rel(wantPath)}`);
        if (opts.dryRun) {
          sum.moved++;
          continue;
        }
        if (placementUnmodified(prev)) {
          const dest = path.join(wantDir, resolveName(wantDir, wantName, f.updatedAt));
          try {
            assertVault(prev.localPath);
            assertInside(dir, dest);
            moveFile(prev.localPath, dest);
            fixMtime(dest, f.updatedAt);
            if (root) pruneEmptyDirs(path.dirname(prev.localPath), root);
            state.placements[key] = { ...prev, target: decision.target, localPath: dest, desired: wantPath, placedAt: nowIso(), meta: metaOf(f) };
            report.placed.push({ courseId, fileId: f.fileId, target: decision.target, localPath: dest });
            touch(dest);
            sum.moved++;
          } catch (e) {
            err(`could not move ${rel(prev.localPath)}: ${(e as Error).message}`, courseId, f.fileId);
          }
          continue;
        }
        err(`${rel(prev.localPath)} was changed locally; left there, a fresh copy goes to ${rel(wantPath)}`, courseId, f.fileId);
        // fall through: place a fresh copy at the new home
      }

      const action = !prev ? 'new' : sameVersion ? (legacyHandout ? 'rewrite' : 'move') : 'update';
      if (action !== 'move') log(`  ${action}: ${f.filename} → ${rel(wantDir)} (${decision.reason})`);
      if (opts.dryRun) {
        if (action === 'new') sum.placed++;
        else if (action === 'move') sum.moved++;
        else sum.updated++;
        continue;
      }
      try {
        const cachePath = cachePathFor(cfg.cacheDir, f, courseId);
        if (!existsSync(cachePath)) await api.download(f.fileId, cachePath);

        // Already here under some name (a hand download)? Adopt it instead of writing a second copy.
        if (!prev && !md && root) {
          const twin = findIdentical(root, cachePath, ours());
          if (twin) {
            state.placements[key] = { courseId, fileId: f.fileId, target: decision.target, localPath: twin, desired: twin, adopted: true, sha256: sha256File(cachePath), updatedAt: f.updatedAt, cachePath, placedAt: nowIso(), meta: metaOf(f) };
            report.placed.push({ courseId, fileId: f.fileId, target: decision.target, localPath: twin });
            log(`  adopted your ${rel(twin)} (identical to Canvas's ${f.filename})`);
            sum.adopted++;
            continue;
          }
        }

        let name = safeName(f.filename);
        let text: string | null = null;
        if (md) {
          const h = handoutFor(mc.course.code, f, readFileSync(cachePath, 'utf8'));
          name = h.name;
          text = h.content;
        }
        const wantPath = path.join(wantDir, name);
        let dest: string;
        const prevOurs = prev && !prev.adopted && existsSync(prev.localPath);
        if (prevOurs && placementUnmodified(prev)) {
          // Untouched copy of the old version (or the pre-transform handout): replace it.
          assertVault(prev.localPath);
          unlinkSync(prev.localPath);
          if (root) pruneEmptyDirs(path.dirname(prev.localPath), root);
          dest = path.join(wantDir, resolveName(wantDir, name, f.updatedAt));
        } else if (prevOurs && path.dirname(prev.localPath) === wantDir) {
          dest = path.join(wantDir, versionName(wantDir, name)); // the user edited the old one: keep theirs, add (v2)
        } else {
          dest = path.join(wantDir, resolveName(wantDir, name, f.updatedAt));
        }
        assertInside(dir, dest);
        if (text != null) writeTextAtomic(dest, text, f.updatedAt);
        else placeFile(cachePath, dest, mode, f.updatedAt);
        state.placements[key] = { courseId, fileId: f.fileId, target: decision.target, localPath: dest, desired: wantPath, sha256: text != null ? sha256Text(text) : sha256File(cachePath), updatedAt: f.updatedAt, cachePath, placedAt: nowIso(), handout: md || undefined, meta: metaOf(f) };
        report.placed.push({ courseId, fileId: f.fileId, target: decision.target, localPath: dest });
        touch(dest);
        if (action === 'new') sum.placed++;
        else if (action === 'move') sum.moved++;
        else sum.updated++;
      } catch (e) {
        err(`${f.filename}: ${(e as Error).message}`, courseId, f.fileId);
      }
    }
  }

  if (!opts.dryRun) {
    for (const mc of synced) writeIndexes(cfg, state, mc, finalDecisions.get(mc.course.id) ?? new Map());
    for (const mc of synced) {
      const dir = courseFactsDir(cfg, mc.course.id);
      if (!dir) continue;
      try {
        const [assignments, announcements, content] = await Promise.all([api.getItems(mc.course.id, 'assignment'), api.getItems(mc.course.id, 'announcement'), api.getCourseContent(mc.course.id)]);
        const changed = writeFacts(dir, mc.course.code, assignments, announcements, content);
        if (changed.length) log(`${mc.course.code}: wrote ${changed.join(', ')}`);
      } catch (e) {
        err(`${mc.course.code}: course facts failed: ${(e as Error).message}`, mc.course.id);
      }
    }
    state.lastRunAt = nowIso();
    saveState(state);
    if (touchedPaths.length && cfg.onPlace) {
      log(`running onPlace hook for ${touchedPaths.length} file${touchedPaths.length === 1 ? '' : 's'}`);
      const status = runOnPlace(cfg, touchedPaths, touchedCourses);
      if (status !== 0) err(`onPlace hook exited ${status}`);
    }
  }
  try {
    await api.postReport(report);
  } catch (e) {
    err(`report failed: ${(e as Error).message}`);
  }
  return sum;
}

/**
 * The user's hook after files land. Env: COLLECTED_PLACED (paths, newline-separated), COLLECTED_COURSES (codes,
 * comma-separated), COLLECTED_COURSE_ROOTS (the touched courses' folders, newline-separated).
 */
export function runOnPlace(cfg: AgentConfig, paths: string[], courses: Map<string, string>): number | null {
  if (!cfg.onPlace) return 0;
  const env = { ...process.env, COLLECTED_PLACED: paths.join('\n'), COLLECTED_COURSES: [...courses.keys()].join(','), COLLECTED_COURSE_ROOTS: [...courses.values()].join('\n') };
  return spawnSync('/bin/sh', ['-c', cfg.onPlace], { stdio: 'inherit', env }).status;
}

/** One index per course when the course has an `index` path; otherwise a `_collected.md` in each folder holding files. */
function writeIndexes(cfg: AgentConfig, state: AgentState, mc: FileSyncManifestCourse, decisions: Map<string, FileSyncDecision | null>): void {
  const files = new Map(mc.files.map((f) => [f.fileId, f]));
  const server = cfg.server.replace(/\/$/, '');
  const entry = (p: Placement, base: string): IndexEntry => {
    const f = files.get(p.fileId);
    const m = f ? metaOf(f) : p.meta;
    const title = m?.title ?? path.basename(p.localPath);
    return {
      fileId: p.fileId,
      title,
      localPath: p.localPath,
      href: path.relative(base, p.localPath),
      target: p.target,
      adopted: !!p.adopted,
      moduleName: m?.moduleName ?? null,
      modulePosition: m?.modulePosition ?? null,
      canvasPath: f?.linkedFrom ? `${title} (linked from ${f.linkedFrom.kind === 'syllabus' ? 'the syllabus page' : `${f.linkedFrom.kind} "${f.linkedFrom.title}"`})` : `${m?.folderPath && m.folderPath !== '/' ? m.folderPath : ''}/${title}`,
      updatedAt: p.updatedAt,
      size: m?.size ?? null,
      openUrl: `${server}/api/canvas/files/${p.fileId}/open`,
    };
  };
  const mine = Object.values(state.placements).filter((p) => p.courseId === mc.course.id && existsSync(p.localPath));
  const indexFile = courseIndexPath(cfg, mc.course.id);
  if (indexFile) {
    const base = path.dirname(indexFile);
    const live = mine.filter((p) => files.has(p.fileId)).map((p) => entry(p, base));
    const removed = mine.filter((p) => !files.has(p.fileId)).map((p) => entry(p, base));
    const held = new Set(mine.map((p) => p.fileId));
    const skipped: SkippedEntry[] = mc.files
      .filter((f) => decisions.get(f.fileId)?.target === FILE_SYNC_SKIP && !held.has(f.fileId))
      .map((f) => ({ fileId: f.fileId, title: f.title, canvasPath: `${f.folderPath && f.folderPath !== '/' ? f.folderPath : ''}/${f.title}`, size: f.size, reason: decisions.get(f.fileId)!.reason, openUrl: `${server}/api/canvas/files/${f.fileId}/open` }));
    if (live.length || removed.length || skipped.length || existsSync(indexFile)) writeIfChanged(indexFile, renderIndex(`${mc.course.code} · Canvas files`, live, removed, skipped));
    return;
  }
  const byDir = new Map<string, Placement[]>();
  for (const p of mine) byDir.set(path.dirname(p.localPath), [...(byDir.get(path.dirname(p.localPath)) ?? []), p]);
  for (const [dir, ps] of byDir) {
    const live = ps.filter((p) => files.has(p.fileId)).map((p) => entry(p, dir));
    const removed = ps.filter((p) => !files.has(p.fileId)).map((p) => entry(p, dir));
    writeIfChanged(path.join(dir, '_collected.md'), renderIndex(`${mc.course.code} · ${ps[0]!.target}`, live, removed));
  }
}
