import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FileSyncFile } from '@collected/shared';
import { criteriaFor, subjectFor } from './classify.js';
import { cachePathFor, findIdentical, handoutFor, placeFile, placementUnmodified, pruneEmptyDirs, removePlacement, renderIndex, resolveName, safeName, sha256File, subdirFor, versionName, withSuffix, writeIfChanged } from './place.js';
import type { Placement } from './state.js';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'collected-agent-'));
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

const file = (over: Partial<FileSyncFile> = {}): FileSyncFile => ({
  courseId: '2026-fall-ling260-0101',
  fileId: '90735997',
  title: 'lecture03_knn.pdf',
  filename: 'lecture03_knn.pdf',
  folderPath: '/Lectures',
  moduleName: 'Week 3',
  modulePosition: 3002,
  contentType: 'application/pdf',
  size: 521897,
  updatedAt: '2026-09-05T14:57:49Z',
  ...over,
});
const put = (p: string, body: string): string => {
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, body);
  return p;
};
const placement = (localPath: string, cachePath: string, over: Partial<Placement> = {}): Placement => ({ courseId: 'c', fileId: '1', target: 'slides', localPath, sha256: sha256File(cachePath), updatedAt: '2026-09-05T14:57:49Z', cachePath, placedAt: '2026-09-06T00:00:00Z', ...over });

describe('names', () => {
  it('cache path carries course, file id, and version', () => {
    expect(cachePathFor('/cache', file())).toBe('/cache/2026-fall-ling260-0101/90735997-202609051457/lecture03_knn.pdf');
    expect(cachePathFor('/cache', file({ updatedAt: null }))).toContain('/90735997-v0/');
  });
  it('sanitises display names for a synced folder and suffixes before the extension', () => {
    expect(safeName('Larson & Segal 1995_ch1.pdf')).toBe('Larson & Segal 1995_ch1.pdf');
    expect(safeName('Unit 1: The ineffable richness')).toBe('Unit 1 - The ineffable richness');
    expect(safeName('a/b?.pdf')).toBe('a-b-.pdf');
    expect(withSuffix('notes.pdf', '(v2)')).toBe('notes (v2).pdf');
    expect(withSuffix('README', '(2)')).toBe('README (2)');
  });
});

describe('layout', () => {
  it('mirrors the Canvas folder under the target, dropping the top folder only when the rule says it is the category', () => {
    expect(subdirFor('/Lecture Notes', true)).toBe('');
    expect(subdirFor('/Lecture Notes/Week 2', true)).toBe('Week 2');
    expect(subdirFor('/Blank Notes', false)).toBe('Blank Notes');
    expect(subdirFor('/Readings/Unit 1: Meaning/optional', true)).toBe(path.join('Unit 1 - Meaning', 'optional'));
    expect(subdirFor('/p1', false)).toBe('p1');
    expect(subdirFor('/', false)).toBe('');
    expect(subdirFor(null, true)).toBe('');
  });
});

describe('writing', () => {
  it('copies atomically, sets mtime to the Canvas date, and never leaves a part file', () => {
    const cache = put(path.join(tmp, 'cache', 'x.pdf'), 'bytes');
    const dest = path.join(tmp, 'vault', 'Slides', 'x.pdf');
    placeFile(cache, dest, 'copy', '2026-09-05T14:57:49Z');
    expect(readFileSync(dest, 'utf8')).toBe('bytes');
    expect(statSync(dest).ino).not.toBe(statSync(cache).ino);
    expect(statSync(dest).mtime.toISOString()).toBe('2026-09-05T14:57:49.000Z');
    expect(readdirSync(path.dirname(dest))).toEqual(['x.pdf']);
    const linked = path.join(tmp, 'vault', 'Slides', 'y.pdf');
    placeFile(cache, linked, 'hardlink', null);
    expect(statSync(linked).ino).toBe(statSync(cache).ino);
  });
  it('writeIfChanged leaves an identical file alone', () => {
    const f = path.join(tmp, '_data', 'canvas.md');
    expect(writeIfChanged(f, 'a')).toBe(true);
    const before = statSync(f).mtimeMs;
    expect(writeIfChanged(f, 'a')).toBe(false);
    expect(statSync(f).mtimeMs).toBe(before);
    expect(writeIfChanged(f, 'b')).toBe(true);
  });
  it('free names: plain, then the Canvas date, then numbered; (v2) beside an edited copy', () => {
    const dir = path.join(tmp, 'd');
    expect(resolveName(dir, 'x.pdf', '2026-09-16T10:00:00Z')).toBe('x.pdf');
    put(path.join(dir, 'x.pdf'), '1');
    expect(resolveName(dir, 'x.pdf', '2026-09-16T10:00:00Z')).toBe('x (2026-09-16).pdf');
    put(path.join(dir, 'x (2026-09-16).pdf'), '2');
    expect(resolveName(dir, 'x.pdf', '2026-09-16T10:00:00Z')).toBe('x (2).pdf');
    expect(resolveName(dir, 'x.pdf', null)).toBe('x (2).pdf');
    expect(versionName(dir, 'x.pdf')).toBe('x (v2).pdf');
  });
  it('prunes folders left holding nothing but .DS_Store or our index, and stops at the root', () => {
    const root = path.join(tmp, 'course');
    put(path.join(root, 'Slides', 'Blank Notes', '_collected.md'), 'idx');
    put(path.join(root, 'Slides', 'keep.pdf'), 'k');
    pruneEmptyDirs(path.join(root, 'Slides', 'Blank Notes'), root);
    expect(existsSync(path.join(root, 'Slides', 'Blank Notes'))).toBe(false);
    expect(existsSync(path.join(root, 'Slides', 'keep.pdf'))).toBe(true);
    pruneEmptyDirs(root, root);
    expect(existsSync(root)).toBe(true);
  });
});

describe('ownership', () => {
  it('removes our untouched copy, refuses to touch an edited one', () => {
    const cache = put(path.join(tmp, 'cache', 'x.pdf'), 'bytes');
    const dest = path.join(tmp, 'slides', 'x.pdf');
    placeFile(cache, dest, 'copy', null);
    const p = placement(dest, cache);
    expect(placementUnmodified(p)).toBe(true);
    expect(removePlacement(p)).toBe(true);
    expect(existsSync(dest)).toBe(false);
    put(dest, 'edited');
    expect(removePlacement(p)).toBe(false);
    expect(readFileSync(dest, 'utf8')).toBe('edited');
  });
  it('finds a byte-identical file under any name, outside machine folders and our own placements', () => {
    const root = path.join(tmp, 'course');
    const cache = put(path.join(tmp, 'cache', 'Ling260_lecture_2_intro.pdf'), 'lecture two');
    put(path.join(root, '_data', 'extracts', 'same.md'), 'lecture two');
    put(path.join(root, '.obsidian', 'same'), 'lecture two');
    put(path.join(root, 'Slides', 'other.pdf'), 'lecture 2!!'); // same size, different bytes
    expect(findIdentical(root, cache, new Set())).toBeNull();
    const hand = put(path.join(root, 'Slides', 'Lecture_2_intro.pdf'), 'lecture two');
    expect(findIdentical(root, cache, new Set())).toBe(hand);
    expect(findIdentical(root, cache, new Set([hand]))).toBeNull();
  });
});

describe('handouts, index, model inputs', () => {
  it('names a Canvas Markdown handout from its first heading and marks it as synced', () => {
    const f = file({ filename: 'INSTRUCTIONS.md', title: 'INSTRUCTIONS.md', folderPath: '/p1', fileId: '77' });
    const h = handoutFor('CMSC422', f, '# Project 1: Fundamentals of Classification [100 pts total]\n\nBuild it.\n');
    expect(h.name).toBe('CMSC422 Project 1 - Fundamentals of Classification.md');
    expect(h.content.startsWith('---\nsource: canvas\ncanvas_id: "77"\ncanvas_path: "/p1/INSTRUCTIONS.md"\nupdated: 2026-09-05\n---\n\n# Project 1')).toBe(true);
    expect(handoutFor('CMSC422', f, 'no heading here').name).toBe('INSTRUCTIONS.md');
    expect(handoutFor('CMSC422', f, '---\na: 1\n---\n# T').content.startsWith('---\na: 1')).toBe(true); // existing frontmatter kept
  });
  it('renders the file → Canvas mapping with ids, module order, adopted and removed files', () => {
    const e = { fileId: '90735997', title: 'Larson & Segal 1995_ch1.pdf', localPath: '/v/Readings/Unit 2 (composition)/Larson & Segal 1995_ch1.pdf', href: '../Readings/Unit 2 (composition)/Larson & Segal 1995_ch1.pdf', target: 'readings', adopted: false, moduleName: 'Week 3', modulePosition: 3002, canvasPath: '/Readings/Unit 2 (composition)/Larson & Segal 1995_ch1.pdf', updatedAt: '2026-09-05T14:57:49Z', size: 521897, openUrl: 'https://c/api/canvas/files/90735997/open' };
    const md = renderIndex('LING260 · Canvas files', [e, { ...e, fileId: '2', title: 'Lecture_2_intro.pdf', localPath: '/v/Slides/Lecture_2_intro.pdf', href: '../Slides/Lecture_2_intro.pdf', target: 'slides', adopted: true }], [{ ...e, fileId: '3', title: 'gone.pdf', localPath: '/v/Slides/gone.pdf', href: '../Slides/gone.pdf' }]);
    expect(md).toContain('| [Larson & Segal 1995_ch1.pdf](<../Readings/Unit 2 (composition)/Larson & Segal 1995_ch1.pdf>) | readings | Week 3 | 3002 | /Readings/Unit 2 (composition)/Larson & Segal 1995_ch1.pdf | 2026-09-05 | 510 KB | 90735997 | [canvas](https://c/api/canvas/files/90735997/open) |');
    expect(md).toContain('| slides (your copy) |');
    expect(md).toContain('## Removed from Canvas');
    expect(md.indexOf('gone.pdf')).toBeGreaterThan(md.indexOf('## Removed from Canvas'));
    const withSkipped = renderIndex('X', [e], [], [{ fileId: '9', title: 'knn.py', canvasPath: '/p1/knn.py', size: 2048, reason: 'name ~ /\\.py$/', openUrl: 'https://c/api/canvas/files/9/open' }]);
    expect(withSkipped).toContain('## Not synced (on demand)');
    expect(withSkipped).toContain('| knn.py | /p1/knn.py | 2 KB | 9 |');
  });
  it('builds the model subject and criteria from the course config', () => {
    expect(subjectFor(file())).toEqual({ title: 'lecture03_knn.pdf', filename: 'lecture03_knn.pdf', folder: '/Lectures', module: 'Week 3', type: 'application/pdf' });
    const crit = criteriaFor({ enabled: true, targets: [{ name: 'slides', description: 'lecture slides' }, { name: 'hw', description: '' }], rules: [], fallback: 'model', threshold: 0.6, skipHint: 'junk' });
    expect(crit).toEqual({ slides: 'lecture slides', hw: 'hw', skip: 'junk' });
  });
});
