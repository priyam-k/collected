import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, linkSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, statSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FileSyncFile } from '@collected/shared';
import type { Placement } from './state.js';

/*
 * Filesystem side of the sync. The cache holds the pristine download; a file in the vault is a copy (or hard link)
 * of it at <target>/<Canvas subfolders>/<display name>. Everything here is careful about three things: never
 * touch bytes the user changed, never leave a half-written file where another tool can read it, and never write a
 * second copy of something that is already there.
 */

export const sha256File = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex');
export const sha256Text = (s: string): string => createHash('sha256').update(s).digest('hex');

const safeSegment = (s: string): string => s.replace(/[^A-Za-z0-9._-]+/g, '_');

/** A filename Finder, iCloud and shells are happy with; keeps the extension. `Unit 1: X` → `Unit 1 - X`. */
export function safeName(name: string): string {
  const cleaned = name
    .replace(/\s*:\s*/g, ' - ')
    .replace(/[\\/*?"<>|\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  return cleaned || 'file';
}

/** Cache path for one version of a file: <cache>/<course>/<fileId>-<version>/<name>. */
export function cachePathFor(cacheDir: string, f: FileSyncFile): string {
  const version = f.updatedAt ? f.updatedAt.replace(/[^0-9]/g, '').slice(0, 12) || 'v0' : 'v0';
  return path.join(cacheDir, safeSegment(f.courseId), `${safeSegment(f.fileId)}-${version}`, safeName(f.filename || f.title));
}

/** "notes.pdf" + "(v2)" → "notes (v2).pdf". */
export function withSuffix(filename: string, suffix: string): string {
  const ext = path.extname(filename);
  const stem = ext ? filename.slice(0, -ext.length) : filename;
  return `${stem} ${suffix}${ext}`;
}

export const sameInode = (a: string, b: string): boolean => {
  try {
    const sa = statSync(a);
    const sb = statSync(b);
    return sa.ino === sb.ino && sa.dev === sb.dev;
  } catch {
    return false;
  }
};

/* ---------- layout: where under the target a file goes ---------- */

const segmentsOf = (folderPath: string | null): string[] => (folderPath ?? '').split('/').filter(Boolean);

/**
 * Canvas subfolders mirrored under the target: "/p1/x.md" → "p1". With `flatten` (set by a rule whose folder
 * pattern names the category itself) the top-level folder is dropped: "/Lecture Notes/Week 2/x.pdf" → "Week 2".
 */
export function subdirFor(folderPath: string | null, flatten: boolean): string {
  const segs = segmentsOf(folderPath);
  return (flatten ? segs.slice(1) : segs).map(safeName).join(path.sep);
}

/* ---------- writing ---------- */

const PART = '.collected-part';

function setMtime(p: string, iso: string | null): void {
  if (!iso) return;
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return;
  try {
    utimesSync(p, t, t);
  } catch {
    /* not fatal: mtime is a courtesy to tools that key on it */
  }
}

/** True when the file's mtime already is Canvas's updated time (to the second). */
export function mtimeMatches(p: string, iso: string | null): boolean {
  if (!iso) return true;
  try {
    return Math.abs(statSync(p).mtimeMs - new Date(iso).getTime()) < 2000;
  } catch {
    return true;
  }
}
export const fixMtime = setMtime;

/**
 * Puts the cached file at `dest`: a hard link, or a copy written to a temp name and renamed into place so nothing
 * ever sees a partial file. mtime is set to Canvas's updated time, so tools keyed on mtime see a change only when
 * Canvas changed the file.
 */
export function placeFile(src: string, dest: string, mode: 'hardlink' | 'copy', mtimeIso: string | null): void {
  mkdirSync(path.dirname(dest), { recursive: true });
  if (mode === 'hardlink') {
    try {
      linkSync(src, dest);
      setMtime(dest, mtimeIso);
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
    }
  }
  const tmp = `${dest}${PART}`;
  copyFileSync(src, tmp);
  setMtime(tmp, mtimeIso);
  renameSync(tmp, dest);
}

export function writeTextAtomic(dest: string, content: string, mtimeIso: string | null): void {
  mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}${PART}`;
  writeFileSync(tmp, content);
  setMtime(tmp, mtimeIso);
  renameSync(tmp, dest);
}

/** Moves a file we placed (same volume: a rename, which keeps its mtime). */
export function moveFile(from: string, to: string): void {
  mkdirSync(path.dirname(to), { recursive: true });
  renameSync(from, to);
}

const LEFTOVERS = ['.DS_Store', '_collected.md'];

/**
 * Removes `dir` and its now-empty parents, stopping at (and never removing) `stopAt`. A folder holding only
 * .DS_Store or our own per-folder index counts as empty.
 */
export function pruneEmptyDirs(dir: string, stopAt: string): void {
  let d = dir;
  while (d.startsWith(stopAt + path.sep) && d !== stopAt) {
    try {
      const left = readdirSync(d).filter((n) => !LEFTOVERS.includes(n));
      if (left.length) return;
      for (const n of LEFTOVERS) {
        try {
          unlinkSync(path.join(d, n));
        } catch {
          /* none */
        }
      }
      rmdirSync(d);
    } catch {
      return;
    }
    d = path.dirname(d);
  }
}

/* ---------- ownership ---------- */

/** True when the file at the placement still has the bytes we put there (so it is ours to move or replace). */
export function placementUnmodified(p: Placement): boolean {
  if (!existsSync(p.localPath)) return false;
  if (existsSync(p.cachePath) && sameInode(p.localPath, p.cachePath)) return true;
  try {
    return sha256File(p.localPath) === p.sha256;
  } catch {
    return false;
  }
}

/** Removes a file we placed, only if the bytes are still ours. Returns false when left alone. Never call for adopted files. */
export function removePlacement(p: Placement): boolean {
  if (!existsSync(p.localPath)) return true;
  if (!placementUnmodified(p)) return false;
  unlinkSync(p.localPath);
  return true;
}

/** A free name in `dir`: the name itself, else with Canvas's updated date, else numbered. */
export function resolveName(dir: string, name: string, updatedAt: string | null): string {
  const free = (n: string) => !existsSync(path.join(dir, n));
  if (free(name)) return name;
  const day = updatedAt?.slice(0, 10);
  if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
    const dated = withSuffix(name, `(${day})`);
    if (free(dated)) return dated;
  }
  for (let i = 2; i < 100; i++) {
    const n = withSuffix(name, `(${i})`);
    if (free(n)) return n;
  }
  return withSuffix(name, `(${Date.now()})`);
}

/** Beside a copy the user edited: name (v2), (v3)… */
export function versionName(dir: string, name: string): string {
  for (let v = 2; v < 100; v++) {
    const n = withSuffix(name, `(v${v})`);
    if (!existsSync(path.join(dir, n))) return n;
  }
  return withSuffix(name, `(v${Date.now()})`);
}

/**
 * A file anywhere under `root` with exactly the bytes of `source` (a hand download, whatever it was named).
 * Machine folders (`_data`, dot-folders) and paths in `exclude` (our own placements) are not candidates. Sizes are
 * compared first, so hashing only happens on a real suspect.
 */
export function findIdentical(root: string, source: string, exclude: Set<string>): string | null {
  let size: number;
  try {
    size = statSync(source).size;
  } catch {
    return null;
  }
  let sha: string | null = null;
  const walk = (dir: string): string | null => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return null;
    }
    for (const n of names.sort()) {
      if (n.startsWith('.') || n === '_data' || n.endsWith(PART)) continue;
      const p = path.join(dir, n);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        const hit = walk(p);
        if (hit) return hit;
      } else if (st.isFile() && st.size === size && !exclude.has(p) && p !== source) {
        try {
          sha ??= sha256File(source);
          if (sha256File(p) === sha) return p;
        } catch {
          /* unreadable: not a match */
        }
      }
    }
    return null;
  };
  return walk(root);
}

/* ---------- Canvas Markdown handouts ---------- */

export const isMarkdown = (name: string): boolean => /\.(md|markdown)$/i.test(name);

/**
 * A Markdown file from Canvas becomes a note in an Obsidian vault, so it gets a name that says what it is (from its
 * first heading: "INSTRUCTIONS.md" → "CMSC422 Project 1 - Fundamentals of Classification.md") and frontmatter
 * marking it as synced, not written by the user.
 */
export function handoutFor(courseCode: string, f: FileSyncFile, raw: string): { name: string; content: string } {
  const h1 = raw.match(/^#\s+(.+?)\s*$/m)?.[1];
  let name = safeName(f.filename);
  if (h1) {
    const title = h1.replace(/\s*\[[^\]]*\]\s*$/, '').replace(/[*_`]/g, '').trim();
    if (title) name = safeName(`${courseCode} ${title}.md`);
  }
  if (raw.startsWith('---\n')) return { name, content: raw };
  const canvasPath = `${f.folderPath && f.folderPath !== '/' ? f.folderPath : ''}/${f.filename}`;
  const fm = ['---', 'source: canvas', `canvas_id: "${f.fileId}"`, `canvas_path: ${JSON.stringify(canvasPath)}`, ...(f.updatedAt ? [`updated: ${f.updatedAt.slice(0, 10)}`] : []), '---', ''];
  return { name, content: `${fm.join('\n')}\n${raw}` };
}

/* ---------- the index ---------- */

export interface IndexEntry {
  fileId: string;
  title: string;
  localPath: string;
  /** Link target relative to where the index is written. */
  href: string;
  target: string;
  adopted: boolean;
  moduleName: string | null;
  modulePosition: number | null;
  /** Canvas folder + display name. */
  canvasPath: string;
  updatedAt: string | null;
  size: number | null;
  openUrl: string;
}

const fmtSize = (n: number | null): string => {
  if (n == null || n <= 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};
const cell = (s: string | number | null | undefined): string => String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
/** Markdown link destination: angle brackets take spaces, parentheses and & as they are. */
const dest = (href: string): string => `<${href.replace(/[<>]/g, '')}>`;

const row = (e: IndexEntry): string =>
  `| [${cell(path.basename(e.localPath))}](${dest(e.href)}) | ${cell(e.target)}${e.adopted ? ' (your copy)' : ''} | ${cell(e.moduleName)} | ${cell(e.modulePosition)} | ${cell(e.canvasPath)} | ${e.updatedAt ? e.updatedAt.slice(0, 10) : ''} | ${fmtSize(e.size)} | ${cell(e.fileId)} | [canvas](${e.openUrl}) |`;

/**
 * The file → Canvas mapping for a folder or a course: what Canvas knew (module, order, folder, date) that the
 * filename alone does not carry. Files Canvas no longer lists stay on disk and are listed separately.
 */
export interface SkippedEntry {
  fileId: string;
  title: string;
  canvasPath: string;
  size: number | null;
  reason: string;
  openUrl: string;
}

export function renderIndex(title: string, entries: IndexEntry[], removed: IndexEntry[] = [], skipped: SkippedEntry[] = []): string {
  const byRecent = (a: IndexEntry, b: IndexEntry) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '') || a.title.localeCompare(b.title);
  const head = ['| File | Saved to | Module | Module order | Canvas path | Updated | Size | Canvas file id | Source |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |'];
  const out = [
    `# ${title}`,
    '',
    `Synced from Canvas by collected-agent. ${entries.length} file${entries.length === 1 ? '' : 's'}. "your copy" marks a file that was already here with identical bytes; the sync never moves or changes those. This file is rewritten on every sync.`,
    '',
    ...head,
    ...entries.slice().sort(byRecent).map(row),
    '',
  ];
  if (removed.length) out.push('## Removed from Canvas', '', 'Still on disk; Canvas no longer lists them.', '', ...head, ...removed.slice().sort(byRecent).map(row), '');
  if (skipped.length) {
    out.push(
      '## Not synced (on demand)',
      '',
      'On Canvas but deliberately not saved (code, archives, data, or skipped by hand). Fetch one with `collected-agent pull <canvas file id> --to <folder>`.',
      '',
      '| File | Canvas path | Size | Canvas file id | Why | Source |',
      '| --- | --- | --- | --- | --- | --- |',
      ...skipped
        .slice()
        .sort((a, b) => a.canvasPath.localeCompare(b.canvasPath))
        .map((e) => `| ${cell(e.title)} | ${cell(e.canvasPath)} | ${fmtSize(e.size)} | ${cell(e.fileId)} | ${cell(e.reason)} | [canvas](${e.openUrl}) |`),
      '',
    );
  }
  return out.join('\n');
}

/** Writes only when the content differs, so an unchanged sync leaves mtimes alone. */
export function writeIfChanged(file: string, content: string): boolean {
  if (existsSync(file) && readFileSync(file, 'utf8') === content) return false;
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}${PART}`;
  writeFileSync(tmp, content);
  renameSync(tmp, file);
  return true;
}
