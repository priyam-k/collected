import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decideFile, fileSyncConfigSchema, type FileSyncFileView, type FileSyncManifest, type FileSyncReport } from '@collected/shared';
import type { SyncApi } from './api.js';
import type { AgentConfig } from './config.js';
import { runSync } from './sync.js';

/* The full placement flow against a fake server: download, link, move on override, protect edits, skip, index. */

let tmp: string;
let home: string;
let school: string;
beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'collected-sync-'));
  home = path.join(tmp, 'home');
  school = path.join(tmp, 'school');
  mkdirSync(home);
  process.env.COLLECTED_AGENT_HOME = home;
});
afterEach(() => {
  delete process.env.COLLECTED_AGENT_HOME;
  rmSync(tmp, { recursive: true, force: true });
});

const COURSE = 'c1';
const config = fileSyncConfigSchema.parse({
  enabled: true,
  targets: [
    { name: 'slides', description: 'lecture slides' },
    { name: 'assignments', description: 'homework' },
  ],
  rules: [
    { target: 'slides', folder: '^/Lectures' },
    { target: 'skip', name: '\\.zip$' },
  ],
  fallback: 'unsorted',
});

interface FakeFile {
  fileId: string;
  filename: string;
  folderPath: string | null;
  updatedAt: string;
  bytes: string;
  manualTarget?: string | null;
}

/** Serves a manifest from a mutable file list, records reports, "downloads" by writing the bytes. */
class FakeApi implements SyncApi {
  reports: FileSyncReport[] = [];
  downloads: string[] = [];
  constructor(public files: FakeFile[]) {}
  async getManifest(): Promise<FileSyncManifest> {
    const views: FileSyncFileView[] = this.files.map((f) => {
      const file = { courseId: COURSE, fileId: f.fileId, title: f.filename, filename: f.filename, folderPath: f.folderPath, moduleName: null, contentType: 'application/pdf', size: f.bytes.length, updatedAt: f.updatedAt };
      return { ...file, decision: decideFile(config, file, { manualTarget: f.manualTarget ?? null, model: null }), model: null, manualTarget: f.manualTarget ?? null, placed: null };
    });
    return { generatedAt: 'now', courses: [{ course: { id: COURSE, code: 'LING260', color: null }, config, files: views }] };
  }
  async postReport(report: FileSyncReport): Promise<unknown> {
    this.reports.push(report);
    return { ok: true };
  }
  async download(fileId: string, dest: string): Promise<void> {
    const f = this.files.find((x) => x.fileId === fileId);
    if (!f) throw new Error(`no such file ${fileId}`);
    this.downloads.push(fileId);
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, f.bytes);
  }
}

const cfg = (): AgentConfig => ({ server: 'http://fake', auth: {}, device: 'test-mac', cacheDir: path.join(home, 'cache'), courses: { [COURSE]: { root: school } }, model: { enabled: false } });
const ls = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir).sort() : []);

describe('runSync', () => {
  it('places by rule, links from the cache, writes indexes, reports, and is idempotent', async () => {
    const api = new FakeApi([
      { fileId: '1', filename: 'L01.pdf', folderPath: '/Lectures', updatedAt: '2026-09-01T00:00:00Z', bytes: 'lecture one' },
      { fileId: '2', filename: 'hw1.pdf', folderPath: '/Homework', updatedAt: '2026-09-02T00:00:00Z', bytes: 'homework' },
      { fileId: '3', filename: 'starter.zip', folderPath: '/Homework', updatedAt: '2026-09-02T00:00:00Z', bytes: 'zip' },
    ]);
    const dry = await runSync(cfg(), { api, dryRun: true });
    expect(dry).toMatchObject({ placed: 2, skipped: 1 });
    expect(ls(school)).toEqual([]); // dry run touches nothing
    expect(api.reports).toHaveLength(1);
    expect(api.reports[0]!.placed).toEqual([]);

    const s = await runSync(cfg(), { api });
    expect(s).toMatchObject({ placed: 2, skipped: 1, errors: [] });
    expect(ls(path.join(school, 'slides'))).toEqual(['L01.pdf', '_collected.md']);
    expect(ls(path.join(school, 'unsorted'))).toEqual(['_collected.md', 'hw1.pdf']);
    expect(existsSync(path.join(school, 'assignments'))).toBe(false); // nothing landed there: no folder, no index
    const placed = path.join(school, 'slides', 'L01.pdf');
    const cached = path.join(home, 'cache', COURSE, '1-202609010000', 'L01.pdf');
    expect(statSync(placed).ino).toBe(statSync(cached).ino);
    expect(readFileSync(path.join(school, 'slides', '_collected.md'), 'utf8')).toContain('| [L01.pdf](L01.pdf) | slides |  | /Lectures | 2026-09-01 |');
    const report = api.reports[1]!;
    expect(report.device).toBe('test-mac');
    expect(report.placed.map((p) => [p.fileId, p.target])).toEqual([['1', 'slides'], ['2', 'unsorted']]);
    expect(report.targets[COURSE]).toMatchObject({ slides: path.join(school, 'slides'), unsorted: path.join(school, 'unsorted') });

    const again = await runSync(cfg(), { api });
    expect(again).toMatchObject({ placed: 0, unchanged: 2, skipped: 1 });
    expect(api.downloads).toEqual(['1', '2']); // nothing re-downloaded
  });

  it('moves on override, keeps an edited file where it is, and versions a changed upload beside it', async () => {
    const api = new FakeApi([{ fileId: '1', filename: 'L01.pdf', folderPath: '/Lectures', updatedAt: '2026-09-01T00:00:00Z', bytes: 'v1' }]);
    await runSync(cfg(), { api });
    const inSlides = path.join(school, 'slides', 'L01.pdf');
    expect(existsSync(inSlides)).toBe(true);

    // Override → assignments: our untouched link moves.
    api.files[0]!.manualTarget = 'assignments';
    let s = await runSync(cfg(), { api });
    expect(s).toMatchObject({ moved: 1, errors: [] });
    expect(existsSync(inSlides)).toBe(false);
    const inAssign = path.join(school, 'assignments', 'L01.pdf');
    expect(existsSync(inAssign)).toBe(true);
    expect(ls(path.join(school, 'slides'))).toEqual(['_collected.md']); // index kept, now empty

    // The user annotates it (new inode, new bytes). Then the professor re-uploads: the edited copy survives, v2 lands beside it.
    rmSync(inAssign);
    writeFileSync(inAssign, 'v1 + my notes');
    api.files[0]!.updatedAt = '2026-09-10T00:00:00Z';
    api.files[0]!.bytes = 'v2';
    s = await runSync(cfg(), { api });
    expect(s).toMatchObject({ updated: 1, errors: [] });
    expect(readFileSync(inAssign, 'utf8')).toBe('v1 + my notes');
    expect(readFileSync(path.join(school, 'assignments', 'L01 (v2).pdf'), 'utf8')).toBe('v2');

    // Override back to slides while the placed (v2) is ours: it moves; the annotated v1 stays.
    api.files[0]!.manualTarget = 'slides';
    s = await runSync(cfg(), { api });
    expect(s).toMatchObject({ moved: 1, errors: [] });
    expect(ls(path.join(school, 'assignments'))).toEqual(['L01.pdf', '_collected.md']);
    expect(ls(path.join(school, 'slides'))).toEqual(['L01.pdf', '_collected.md']);

    // Skip: our link goes, the report says removed.
    api.files[0]!.manualTarget = 'skip';
    s = await runSync(cfg(), { api });
    expect(s).toMatchObject({ removed: 1, skipped: 1 });
    expect(ls(path.join(school, 'slides'))).toEqual(['_collected.md']);
    expect(api.reports.at(-1)!.removed).toEqual([{ courseId: COURSE, fileId: '1' }]);
  });

  it('copy mode and a course-wide index for folders a sync service owns (iCloud, Obsidian _data)', async () => {
    const api = new FakeApi([
      { fileId: '1', filename: 'L01.pdf', folderPath: '/Lectures', updatedAt: '2026-09-01T00:00:00Z', bytes: 'lecture one' },
      { fileId: '2', filename: 'hw1.pdf', folderPath: '/Homework', updatedAt: '2026-09-02T00:00:00Z', bytes: 'homework' },
    ]);
    const c = cfg();
    c.linkMode = 'copy';
    c.courses[COURSE] = { root: school, targets: { slides: path.join(school, 'Slides') }, index: '_data/canvas.md' };
    const s = await runSync(c, { api });
    expect(s).toMatchObject({ placed: 2, errors: [] });
    const placed = path.join(school, 'Slides', 'L01.pdf');
    const cached = path.join(home, 'cache', COURSE, '1-202609010000', 'L01.pdf');
    expect(statSync(placed).ino).not.toBe(statSync(cached).ino); // a copy, not a link
    expect(ls(path.join(school, 'Slides'))).toEqual(['L01.pdf']); // no _collected.md per folder
    const idx = readFileSync(path.join(school, '_data', 'canvas.md'), 'utf8');
    expect(idx).toContain('# LING260 · Canvas files');
    expect(idx).toContain('| [L01.pdf](../Slides/L01.pdf) | slides |');
    expect(idx).toContain('| [hw1.pdf](../unsorted/hw1.pdf) | unsorted |');
    // Copies are still recognised as ours by hash: a skip removes the copy, an edit protects it.
    api.files[1]!.manualTarget = 'skip';
    await runSync(c, { api });
    expect(existsSync(path.join(school, 'unsorted', 'hw1.pdf'))).toBe(false);
    writeFileSync(placed, 'annotated');
    api.files[0]!.manualTarget = 'skip';
    const s2 = await runSync(c, { api });
    expect(existsSync(placed)).toBe(true);
    expect(s2.errors[0]!.message).toMatch(/changed locally/);
  });

  it('adopts an identical hand-downloaded file instead of making a (2) copy, and folds existing (2) copies back', async () => {
    const api = new FakeApi([
      { fileId: '1', filename: 'L01.pdf', folderPath: '/Lectures', updatedAt: '2026-09-01T00:00:00Z', bytes: 'lecture one' },
      { fileId: '2', filename: 'L02.pdf', folderPath: '/Lectures', updatedAt: '2026-09-01T00:00:00Z', bytes: 'lecture two' },
    ]);
    mkdirSync(path.join(school, 'slides'), { recursive: true });
    writeFileSync(path.join(school, 'slides', 'L01.pdf'), 'lecture one'); // identical hand download
    writeFileSync(path.join(school, 'slides', 'L02.pdf'), 'something else'); // same name, different bytes
    let s = await runSync(cfg(), { api });
    expect(s).toMatchObject({ placed: 2, errors: [] });
    expect(ls(path.join(school, 'slides'))).toEqual(['L01.pdf', 'L02 (2).pdf', 'L02.pdf', '_collected.md']);
    expect(api.reports.at(-1)!.placed.find((p) => p.fileId === '1')!.localPath).toBe(path.join(school, 'slides', 'L01.pdf'));

    // The user replaces their odd L02.pdf with the real one: next run folds our (2) copy onto it.
    writeFileSync(path.join(school, 'slides', 'L02.pdf'), 'lecture two');
    s = await runSync(cfg(), { api });
    expect(ls(path.join(school, 'slides'))).toEqual(['L01.pdf', 'L02.pdf', '_collected.md']);
    expect(s.unchanged).toBe(2);
  });

  it('reports a missing folder mapping once per target instead of failing silently', async () => {
    const api = new FakeApi([{ fileId: '1', filename: 'L01.pdf', folderPath: '/Lectures', updatedAt: '2026-09-01T00:00:00Z', bytes: 'x' }]);
    const c = cfg();
    c.courses[COURSE] = { targets: { assignments: path.join(school, 'hw') } }; // no root, slides unmapped
    const s = await runSync(c, { api });
    expect(s.errors).toHaveLength(1);
    expect(s.errors[0]!.message).toMatch(/no folder for target "slides"/);
    expect(api.reports[0]!.errors).toHaveLength(1);
  });
});
