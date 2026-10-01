import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FileSyncFile } from '@collected/shared';
import { criteriaFor, subjectFor } from './classify.js';
import { cachePathFor, chooseLinkName, linkOrCopy, placementUnmodified, removePlacement, renderIndex, safeName, sha256File, withSuffix } from './place.js';
import type { Placement } from './state.js';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'collected-agent-'));
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

const file = (over: Partial<FileSyncFile> = {}): FileSyncFile => ({
  courseId: '2026-fall-ling260-0101',
  fileId: '90735997',
  title: 'Lecture 03: kNN.pdf',
  filename: 'lecture03_knn.pdf',
  folderPath: '/Lectures',
  moduleName: 'Week 3',
  contentType: 'application/pdf',
  size: 521897,
  updatedAt: '2026-09-05T14:57:49Z',
  ...over,
});

const placement = (localPath: string, cachePath: string, over: Partial<Placement> = {}): Placement => ({
  courseId: 'c',
  fileId: '1',
  target: 'slides',
  localPath,
  sha256: sha256File(cachePath),
  updatedAt: '2026-09-05T14:57:49Z',
  cachePath,
  placedAt: '2026-09-06T00:00:00Z',
  ...over,
});

describe('names', () => {
  it('cache path carries course, file id, and version', () => {
    expect(cachePathFor('/cache', file())).toBe('/cache/2026-fall-ling260-0101/90735997-202609051457/lecture03_knn.pdf');
    expect(cachePathFor('/cache', file({ updatedAt: null }))).toContain('/90735997-v0/');
  });
  it('sanitises and suffixes', () => {
    expect(safeName('a/b:c?.pdf')).toBe('a-b-c-.pdf');
    expect(withSuffix('notes.pdf', '(v2)')).toBe('notes (v2).pdf');
    expect(withSuffix('README', '(2)')).toBe('README (2)');
  });
});

describe('chooseLinkName', () => {
  it('uses the plain name when free, or when the slot already is this file', () => {
    const cache = path.join(tmp, 'cache', 'x.pdf');
    mkdirSync(path.dirname(cache), { recursive: true });
    writeFileSync(cache, 'bytes');
    const dir = path.join(tmp, 'slides');
    mkdirSync(dir);
    expect(chooseLinkName(dir, 'x.pdf', cache, null)).toBe('x.pdf');
    linkOrCopy(cache, path.join(dir, 'x.pdf'));
    expect(chooseLinkName(dir, 'x.pdf', cache, null)).toBe('x.pdf');
  });

  it('versions beside a modified older copy, and numbers beside a different file', () => {
    const dir = path.join(tmp, 'slides');
    mkdirSync(dir);
    const oldCache = path.join(tmp, 'cache', 'v1', 'x.pdf');
    mkdirSync(path.dirname(oldCache), { recursive: true });
    writeFileSync(oldCache, 'v1 bytes');
    const placed = path.join(dir, 'x.pdf');
    linkOrCopy(oldCache, placed);
    const prev = placement(placed, oldCache);
    // User annotates: Preview writes a new file over the name (new inode, new bytes).
    rmSync(placed);
    writeFileSync(placed, 'v1 bytes + my notes');
    expect(placementUnmodified(prev)).toBe(false);
    const newCache = path.join(tmp, 'cache', 'v2', 'x.pdf');
    mkdirSync(path.dirname(newCache), { recursive: true });
    writeFileSync(newCache, 'v2 bytes');
    expect(chooseLinkName(dir, 'x.pdf', newCache, prev)).toBe('x (v2).pdf');
    // A different file wanting the same name gets (2).
    const other = path.join(tmp, 'cache', 'o', 'x.pdf');
    mkdirSync(path.dirname(other), { recursive: true });
    writeFileSync(other, 'other');
    expect(chooseLinkName(dir, 'x.pdf', other, null)).toBe('x (2).pdf');
  });
});

describe('removePlacement', () => {
  it('removes our link, refuses to touch a modified file', () => {
    const cache = path.join(tmp, 'cache', 'x.pdf');
    mkdirSync(path.dirname(cache), { recursive: true });
    writeFileSync(cache, 'bytes');
    const dir = path.join(tmp, 'slides');
    mkdirSync(dir);
    const dest = path.join(dir, 'x.pdf');
    linkOrCopy(cache, dest);
    expect(statSync(dest).ino).toBe(statSync(cache).ino); // hard link, not a copy
    const p = placement(dest, cache);
    expect(removePlacement(p)).toBe(true);
    expect(existsSync(dest)).toBe(false);
    writeFileSync(dest, 'edited');
    expect(removePlacement(p)).toBe(false);
    expect(readFileSync(dest, 'utf8')).toBe('edited');
  });
});

describe('index and model inputs', () => {
  it('renders a table with Canvas metadata the filename lacks', () => {
    const md = renderIndex('LING260 · slides', [{ file: file(), localPath: '/x/slides/lecture03_knn.pdf', href: 'lecture03_knn.pdf', target: 'slides', openUrl: 'https://c/api/canvas/files/90735997/open' }]);
    expect(md).toContain('# LING260 · slides');
    expect(md).toContain('| [lecture03_knn.pdf](lecture03_knn.pdf) | slides | Week 3 | /Lectures | 2026-09-05 | 510 KB | [canvas](https://c/api/canvas/files/90735997/open) |');
  });
  it('builds the model subject and criteria from the course config', () => {
    expect(subjectFor(file())).toEqual({ title: 'Lecture 03: kNN.pdf', filename: 'lecture03_knn.pdf', folder: '/Lectures', module: 'Week 3', type: 'application/pdf' });
    const crit = criteriaFor({ enabled: true, targets: [{ name: 'slides', description: 'lecture slides' }, { name: 'hw', description: '' }], rules: [], fallback: 'model', threshold: 0.6, skipHint: 'junk' });
    expect(crit).toEqual({ slides: 'lecture slides', hw: 'hw', skip: 'junk' });
  });
});
