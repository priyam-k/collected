import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, linkSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FileSyncFile } from '@collected/shared';
import type { Placement } from './state.js';

/* Filesystem side of the sync: the cache is the pristine copy, targets are hard links into it. */

export const sha256File = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex');

/** Cache path for one version of a file: <cache>/<course>/<fileId>-<version>/<filename>. */
export function cachePathFor(cacheDir: string, f: FileSyncFile): string {
  const version = f.updatedAt ? f.updatedAt.replace(/[^0-9]/g, '').slice(0, 12) || 'v0' : 'v0';
  return path.join(cacheDir, safeSegment(f.courseId), `${safeSegment(f.fileId)}-${version}`, safeName(f.filename || f.title));
}

const safeSegment = (s: string): string => s.replace(/[^A-Za-z0-9._-]+/g, '_');
/** A filename Finder and shells are happy with; keeps the extension. */
export function safeName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim();
  return cleaned || 'file';
}

/** "notes.pdf" + " (v2)" → "notes (v2).pdf". */
export function withSuffix(filename: string, suffix: string): string {
  const ext = path.extname(filename);
  const stem = ext ? filename.slice(0, -ext.length) : filename;
  return `${stem} ${suffix}${ext}`;
}

const sameInode = (a: string, b: string): boolean => {
  try {
    const sa = statSync(a);
    const sb = statSync(b);
    return sa.ino === sb.ino && sa.dev === sb.dev;
  } catch {
    return false;
  }
};

/** Hard link (falls back to a copy across filesystems), or a plain copy when asked. */
export function linkOrCopy(src: string, dest: string, mode: 'hardlink' | 'copy' = 'hardlink'): void {
  mkdirSync(path.dirname(dest), { recursive: true });
  if (mode === 'copy') {
    copyFileSync(src, dest);
    return;
  }
  try {
    linkSync(src, dest);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EXDEV') copyFileSync(src, dest);
    else throw err;
  }
}

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

/**
 * Picks the name to link `cachePath` under inside `dir`: the filename itself when free or already this file;
 * `name (v2)`, `(v3)`… when the slot holds a modified copy of an older version of the same file; `name (2)` when a
 * different file owns the name.
 */
export function chooseLinkName(dir: string, filename: string, cachePath: string, previous: Placement | null): string {
  const want = safeName(filename);
  const free = (n: string) => !existsSync(path.join(dir, n));
  const isThisFile = (n: string) => sameInode(path.join(dir, n), cachePath);
  if (free(want) || isThisFile(want)) return want;
  const prevHere = previous && path.dirname(previous.localPath) === dir && path.basename(previous.localPath) === want;
  if (prevHere) {
    // The old version sits here and the user changed it: keep theirs, add ours as a version.
    for (let v = 2; v < 100; v++) {
      const n = withSuffix(want, `(v${v})`);
      if (free(n) || isThisFile(n)) return n;
    }
  }
  for (let i = 2; i < 100; i++) {
    const n = withSuffix(want, `(${i})`);
    if (free(n) || isThisFile(n)) return n;
  }
  return withSuffix(want, `(${Date.now()})`);
}

/** Removes a placement we made, only if the bytes are still ours. Returns false when left alone. */
export function removePlacement(p: Placement): boolean {
  if (!existsSync(p.localPath)) return true;
  if (!placementUnmodified(p)) return false;
  unlinkSync(p.localPath);
  return true;
}

export interface IndexEntry {
  file: FileSyncFile;
  localPath: string;
  /** Link target relative to where the index is written. */
  href: string;
  target: string;
  openUrl: string;
}

const fmtSize = (n: number | null): string => {
  if (n == null || n <= 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};
const cell = (s: string | null | undefined): string => (s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

/**
 * `_collected.md`: what is in this folder and where it came from. The metadata Canvas had (module, folder,
 * date) that the filename alone does not carry, for tools that search an index before opening PDFs.
 */
export function renderIndex(title: string, entries: IndexEntry[]): string {
  const rows = entries
    .slice()
    .sort((a, b) => (b.file.updatedAt ?? '').localeCompare(a.file.updatedAt ?? ''))
    .map((e) => {
      const f = e.file;
      const date = f.updatedAt ? f.updatedAt.slice(0, 10) : '';
      return `| [${cell(path.basename(e.localPath))}](${encodeURI(e.href)}) | ${cell(e.target)} | ${cell(f.moduleName)} | ${cell(f.folderPath)} | ${date} | ${fmtSize(f.size)} | [canvas](${e.openUrl}) |`;
    });
  return [
    `# ${title}`,
    '',
    `Synced from Canvas by collected-agent. ${entries.length} file${entries.length === 1 ? '' : 's'}. Edit the files freely; this index is rewritten on every sync.`,
    '',
    '| File | Saved to | Module | Canvas folder | Updated | Size | Source |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
}

export function writeIndex(file: string, content: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  if (existsSync(file) && readFileSync(file, 'utf8') === content) return;
  writeFileSync(file, content);
}
