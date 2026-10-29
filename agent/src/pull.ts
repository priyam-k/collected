import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { openApi, type SyncApi } from './api.js';
import { courseRoot, expandHome, type AgentConfig } from './config.js';
import { assertInside, cachePathFor, findIdentical, handoutFor, isMarkdown, placeFile, resolveName, safeName, sha256File, sha256Text, writeTextAtomic } from './place.js';
import { loadState, saveState, stateKey } from './state.js';
import { runOnPlace } from './sync.js';

export interface PullResult {
  path: string;
  /** true when an identical file was already in the course folder and nothing was written. */
  alreadyThere: boolean;
  course: string;
  title: string;
}

/**
 * Fetches one Canvas file by id, whatever the rules say about it (a skipped starter file, an optional reading),
 * into `toDir`. Same care as the sync: an identical file already in the course folder is reported instead of
 * duplicated, the write is atomic with Canvas's mtime, and the file is remembered so a later sync keeps it and
 * lists it in the course index.
 */
export async function pullFile(cfg: AgentConfig, fileId: string, toDir: string, opts: { api?: SyncApi; course?: string } = {}): Promise<PullResult> {
  const api = opts.api ?? (await openApi(cfg));
  const manifest = await api.getManifest();
  const hit = manifest.courses
    .filter((c) => !opts.course || c.course.id === opts.course || c.course.code.toLowerCase() === opts.course.toLowerCase())
    .flatMap((c) => c.files.map((f) => ({ c, f })))
    .find((x) => x.f.fileId === fileId);
  if (!hit) throw new Error(`no file ${fileId} in a sync-enabled course (ids are in each course's canvas.md)`);
  const { c, f } = hit;
  const state = loadState();
  const key = stateKey(c.course.id, f.fileId);
  const cachePath = cachePathFor(cfg.cacheDir, f, c.course.id);
  if (!existsSync(cachePath)) await api.download(f.fileId, cachePath);

  const root = courseRoot(cfg, c.course.id);
  const dir = path.resolve(expandHome(toDir));
  const md = isMarkdown(f.filename);
  const meta = { title: f.title, folderPath: f.folderPath, moduleName: f.moduleName, modulePosition: f.modulePosition, size: f.size };
  const base = { courseId: c.course.id, fileId: f.fileId, target: 'on demand', updatedAt: f.updatedAt, cachePath, placedAt: new Date().toISOString(), pulled: true, meta };

  const twin = !md && root ? findIdentical(root, cachePath, new Set()) : null;
  if (twin) {
    const ours = Object.values(state.placements).some((p) => p.localPath === twin);
    if (!ours) state.placements[key] = { ...base, localPath: twin, desired: twin, adopted: true, sha256: sha256File(cachePath) };
    saveState(state);
    return { path: twin, alreadyThere: true, course: c.course.code, title: f.title };
  }

  let name = safeName(f.filename);
  let text: string | null = null;
  if (md) {
    const h = handoutFor(c.course.code, f, readFileSync(cachePath, 'utf8'));
    name = h.name;
    text = h.content;
  }
  if (existsSync(dir) && !statSync(dir).isDirectory()) throw new Error(`--to must be a folder: ${dir}`);
  const dest = path.join(dir, resolveName(dir, name, f.updatedAt));
  assertInside(dir, dest);
  if (text != null) writeTextAtomic(dest, text, f.updatedAt);
  else placeFile(cachePath, dest, cfg.linkMode ?? 'hardlink', f.updatedAt);
  state.placements[key] = { ...base, localPath: dest, desired: dest, sha256: text != null ? sha256Text(text) : sha256File(cachePath), handout: md || undefined };
  saveState(state);
  if (root) runOnPlace(cfg, [dest], new Map([[c.course.code, root]]));
  return { path: dest, alreadyThere: false, course: c.course.code, title: f.title };
}
