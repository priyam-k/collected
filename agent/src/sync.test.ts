import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decideFile, fileSyncConfigSchema, type EffectiveItem, type FileSyncFileView, type FileSyncManifest, type FileSyncReport } from '@collected/shared';
import type { SyncApi } from './api.js';
import type { AgentConfig } from './config.js';
import type { CourseContentRow } from './facts.js';
import { sha256Text } from './place.js';
import { pullFile } from './pull.js';
import { runSync } from './sync.js';

/* The whole placement flow against a fake server, in a temp "vault". */

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
    { name: 'readings', description: 'readings' },
    { name: 'assignments', description: 'homework' },
  ],
  rules: [
    { target: 'skip', name: '\\.(zip|py)$' },
    { target: 'readings', folder: '^/Readings', flatten: true },
    { target: 'slides', folder: '^/Lecture Notes', flatten: true },
    { target: 'slides', folder: '^/Blank Notes' },
    { target: 'assignments', name: '\\.md$' },
  ],
  fallback: 'unsorted',
});

interface FakeFile {
  fileId: string;
  filename: string;
  folderPath: string | null;
  updatedAt: string;
  bytes: string;
  size?: number;
  manualTarget?: string | null;
}
const T1 = '2026-09-01T12:00:00Z';
const T2 = '2026-09-20T12:00:00Z';

class FakeApi implements SyncApi {
  reports: FileSyncReport[] = [];
  downloads: string[] = [];
  assignments: EffectiveItem[] = [];
  announcements: EffectiveItem[] = [];
  content: CourseContentRow[] = [];
  constructor(public files: FakeFile[]) {}
  async getManifest(): Promise<FileSyncManifest> {
    const views: FileSyncFileView[] = this.files.map((f) => {
      const file = { courseId: COURSE, fileId: f.fileId, title: f.filename, filename: f.filename, folderPath: f.folderPath, moduleName: null, modulePosition: null, contentType: 'application/pdf', size: f.size ?? f.bytes.length, updatedAt: f.updatedAt };
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
  async getItems(_course: string, kind: 'assignment' | 'announcement'): Promise<EffectiveItem[]> {
    return kind === 'assignment' ? this.assignments : this.announcements;
  }
  async getCourseContent(): Promise<CourseContentRow[]> {
    return this.content;
  }
}

const cfg = (over: Partial<AgentConfig> = {}): AgentConfig => ({ server: 'http://fake', auth: {}, device: 'test-mac', cacheDir: path.join(home, 'cache'), linkMode: 'copy', courses: { [COURSE]: { root: school } }, model: { enabled: false }, ...over });
const ls = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir).sort() : []);
const read = (...p: string[]): string => readFileSync(path.join(school, ...p), 'utf8');
const put = (body: string, ...p: string[]): string => {
  const f = path.join(school, ...p);
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, body);
  return f;
};
const lecture = (over: Partial<FakeFile> = {}): FakeFile => ({ fileId: '1', filename: 'L01.pdf', folderPath: '/Lecture Notes', updatedAt: T1, bytes: 'lecture one', ...over });

describe('layout and basics', () => {
  it('places under display names in mirrored folders, with Canvas mtimes, an index per folder, and no rewrites on a second run', async () => {
    const api = new FakeApi([
      lecture(),
      lecture({ fileId: '2', filename: 'L02.pdf', bytes: 'lecture two' }),
      { fileId: '3', filename: 'Chapter1.pdf', folderPath: '/Blank Notes', updatedAt: T1, bytes: 'blank' },
      { fileId: '4', filename: 'Plato: Meno.pdf', folderPath: '/Readings/Unit 1: Meaning', updatedAt: T1, bytes: 'plato' },
      { fileId: '5', filename: 'hw1.pdf', folderPath: '/', updatedAt: T1, bytes: 'homework' },
      { fileId: '6', filename: 'starter.zip', folderPath: '/p1', updatedAt: T1, bytes: 'zip' },
    ]);
    const dry = await runSync(cfg(), { api, dryRun: true });
    expect(dry).toMatchObject({ placed: 5, skipped: 1 });
    expect(ls(school)).toEqual([]);
    expect(api.reports[0]!.placed).toEqual([]);

    const s = await runSync(cfg(), { api });
    expect(s).toMatchObject({ placed: 5, skipped: 1, errors: [] });
    expect(ls(path.join(school, 'slides'))).toEqual(['Blank Notes', 'L01.pdf', 'L02.pdf', '_collected.md']);
    expect(ls(path.join(school, 'slides', 'Blank Notes'))).toEqual(['Chapter1.pdf', '_collected.md']);
    expect(ls(path.join(school, 'readings', 'Unit 1 - Meaning'))).toEqual(['Plato - Meno.pdf', '_collected.md']);
    expect(ls(path.join(school, 'unsorted'))).toEqual(['_collected.md', 'hw1.pdf']);
    expect(existsSync(path.join(school, 'assignments'))).toBe(false);
    expect(statSync(path.join(school, 'slides', 'L01.pdf')).mtime.toISOString()).toBe('2026-09-01T12:00:00.000Z');
    expect(read('slides', '_collected.md')).toContain('| [L01.pdf](<L01.pdf>) | slides |  |  | /Lecture Notes/L01.pdf | 2026-09-01 |');
    const report = api.reports[1]!;
    expect(report.placed.map((p) => [p.fileId, p.target])).toEqual([['1', 'slides'], ['2', 'slides'], ['3', 'slides'], ['4', 'readings'], ['5', 'unsorted']]);
    expect(report.targets[COURSE]).toMatchObject({ slides: path.join(school, 'slides'), readings: path.join(school, 'readings') });

    const idxBefore = statSync(path.join(school, 'slides', '_collected.md')).mtimeMs;
    const again = await runSync(cfg(), { api });
    expect(again).toMatchObject({ placed: 0, moved: 0, updated: 0, unchanged: 5, skipped: 1 });
    expect(api.downloads).toEqual(['1', '2', '3', '4', '5']);
    expect(statSync(path.join(school, 'slides', '_collected.md')).mtimeMs).toBe(idxBefore);
  });

  it('reports a missing folder mapping once per target instead of failing silently', async () => {
    const api = new FakeApi([lecture()]);
    const s = await runSync(cfg({ courses: { [COURSE]: { targets: { assignments: path.join(school, 'hw') } } } }), { api });
    expect(s.errors).toHaveLength(1);
    expect(s.errors[0]!.message).toMatch(/no folder for target "slides"/);
  });
});

describe('never a second copy', () => {
  it('adopts an identical file the user already has, under any name, and treats it as theirs from then on', async () => {
    const mine = put('lecture one', 'Slides-old', 'My Lecture 1.pdf');
    put('lecture one', '_data', 'extracts', 'L01.md'); // machine folder: not a candidate
    const api = new FakeApi([lecture()]);
    let s = await runSync(cfg(), { api });
    expect(s).toMatchObject({ adopted: 1, placed: 0, errors: [] });
    expect(existsSync(path.join(school, 'slides'))).toBe(false);
    expect(api.reports.at(-1)!.placed).toEqual([{ courseId: COURSE, fileId: '1', target: 'slides', localPath: mine }]);

    // A new decision does not move it; a skip does not delete it; a new Canvas version leaves it and lands separately.
    api.files[0]!.manualTarget = 'assignments';
    s = await runSync(cfg(), { api });
    expect(s).toMatchObject({ unchanged: 1, moved: 0 });
    expect(readFileSync(mine, 'utf8')).toBe('lecture one');
    api.files[0]!.manualTarget = 'skip';
    await runSync(cfg(), { api });
    expect(existsSync(mine)).toBe(true);
    api.files[0]!.manualTarget = null;
    api.files[0]!.updatedAt = T2;
    api.files[0]!.bytes = 'lecture one, revised';
    s = await runSync(cfg(), { api });
    expect(s).toMatchObject({ placed: 1 });
    expect(read('slides', 'L01.pdf')).toBe('lecture one, revised');
    expect(readFileSync(mine, 'utf8')).toBe('lecture one');
  });

  it('folds a copy it placed earlier onto an identical file of the user', async () => {
    const api = new FakeApi([lecture(), lecture({ fileId: '2', filename: 'L02.pdf', bytes: 'lecture two' })]);
    await runSync(cfg(), { api });
    expect(ls(path.join(school, 'slides'))).toEqual(['L01.pdf', 'L02.pdf', '_collected.md']);
    const hand = put('lecture one', 'slides', 'Lecture_1_intro.pdf');
    const s = await runSync(cfg(), { api });
    expect(s).toMatchObject({ adopted: 1, unchanged: 2 });
    expect(ls(path.join(school, 'slides'))).toEqual(['L02.pdf', 'Lecture_1_intro.pdf', '_collected.md']);
    expect(api.reports.at(-1)!.placed).toEqual([{ courseId: COURSE, fileId: '1', target: 'slides', localPath: hand }]);
    expect(read('slides', '_collected.md')).toContain('| [Lecture_1_intro.pdf](<Lecture_1_intro.pdf>) | slides (your copy) |');
  });
});

describe('versions, edits, deletions', () => {
  it('replaces its untouched copy in place, keeps an edited one with the new version beside it, and respects a deletion', async () => {
    const api = new FakeApi([lecture({ bytes: 'v1' })]);
    await runSync(cfg(), { api });
    const f = path.join(school, 'slides', 'L01.pdf');

    api.files[0] = lecture({ bytes: 'v2', updatedAt: T2 });
    let s = await runSync(cfg(), { api });
    expect(s).toMatchObject({ updated: 1, errors: [] });
    expect(ls(path.join(school, 'slides'))).toEqual(['L01.pdf', '_collected.md']);
    expect(readFileSync(f, 'utf8')).toBe('v2');
    expect(statSync(f).mtime.toISOString()).toBe('2026-09-20T12:00:00.000Z');

    writeFileSync(f, 'v2 + my notes');
    api.files[0] = lecture({ bytes: 'v3', updatedAt: '2026-09-25T12:00:00Z' });
    s = await runSync(cfg(), { api });
    expect(s).toMatchObject({ updated: 1 });
    expect(readFileSync(f, 'utf8')).toBe('v2 + my notes');
    expect(read('slides', 'L01 (v2).pdf')).toBe('v3');

    rmSync(path.join(school, 'slides', 'L01 (v2).pdf'));
    s = await runSync(cfg(), { api });
    expect(s).toMatchObject({ unchanged: 1, placed: 0, updated: 0 });
    expect(existsSync(path.join(school, 'slides', 'L01 (v2).pdf'))).toBe(false); // deleted by the user: stays deleted
  });

  it('renames and moves its untouched copy when the display name or the target changes, keeping the mtime', async () => {
    const api = new FakeApi([lecture()]);
    await runSync(cfg(), { api });
    api.files[0]!.filename = 'Lecture 1: Intro.pdf';
    let s = await runSync(cfg(), { api });
    expect(s).toMatchObject({ moved: 1, placed: 0, errors: [] });
    expect(ls(path.join(school, 'slides'))).toEqual(['Lecture 1 - Intro.pdf', '_collected.md']);
    expect(statSync(path.join(school, 'slides', 'Lecture 1 - Intro.pdf')).mtime.toISOString()).toBe('2026-09-01T12:00:00.000Z');
    expect(api.downloads).toEqual(['1']);

    api.files[0]!.manualTarget = 'assignments'; // manual: mirrors the Canvas folder, no flattening
    s = await runSync(cfg(), { api });
    expect(s).toMatchObject({ moved: 1 });
    expect(existsSync(path.join(school, 'slides'))).toBe(false); // emptied folder (index included) is gone
    expect(ls(path.join(school, 'assignments', 'Lecture Notes'))).toEqual(['Lecture 1 - Intro.pdf', '_collected.md']);

    // Edited, then re-targeted: the edited copy stays, a fresh one goes to the new home, and the run says so.
    writeFileSync(path.join(school, 'assignments', 'Lecture Notes', 'Lecture 1 - Intro.pdf'), 'annotated');
    api.files[0]!.manualTarget = 'readings';
    s = await runSync(cfg(), { api });
    expect(s.errors[0]!.message).toMatch(/changed locally/);
    expect(read('assignments', 'Lecture Notes', 'Lecture 1 - Intro.pdf')).toBe('annotated');
    expect(read('readings', 'Lecture Notes', 'Lecture 1 - Intro.pdf')).toBe('lecture one');
  });
});

describe('skips', () => {
  it('removes its copy when a file becomes skipped, never downloads over the size cap, keeps what was pulled by hand', async () => {
    const api = new FakeApi([lecture(), { fileId: '7', filename: 'recording.pdf', folderPath: '/Lecture Notes', updatedAt: T1, bytes: 'x', size: 500 * 1024 * 1024 }, { fileId: '8', filename: 'knn.py', folderPath: '/p1', updatedAt: T1, bytes: 'def knn(): pass' }]);
    let s = await runSync(cfg(), { api });
    expect(s).toMatchObject({ placed: 1, skipped: 2 });
    expect(api.downloads).toEqual(['1']);

    const pulled = await pullFile(cfg(), '8', path.join(school, 'assignments', 'p1'), { api });
    expect(pulled).toMatchObject({ alreadyThere: false, title: 'knn.py' });
    expect(read('assignments', 'p1', 'knn.py')).toBe('def knn(): pass');
    api.files[0]!.manualTarget = 'skip';
    s = await runSync(cfg(), { api });
    expect(s).toMatchObject({ removed: 1 });
    expect(existsSync(path.join(school, 'slides'))).toBe(false);
    expect(read('assignments', 'p1', 'knn.py')).toBe('def knn(): pass'); // pulled: survives the skip rule
    expect((await pullFile(cfg(), '8', path.join(school, 'elsewhere'), { api })).alreadyThere).toBe(true);
  });
});

describe('Markdown handouts', () => {
  it('writes them with frontmatter under a name from the first heading, and rewrites a pre-transform copy', async () => {
    const raw = '# Project 1: Fundamentals of Classification [100 pts total]\n\nBuild it.\n';
    const api = new FakeApi([{ fileId: '9', filename: 'INSTRUCTIONS.md', folderPath: '/p1', updatedAt: T1, bytes: raw }]);
    let s = await runSync(cfg(), { api });
    expect(s).toMatchObject({ placed: 1, errors: [] });
    const name = 'LING260 Project 1 - Fundamentals of Classification.md';
    expect(ls(path.join(school, 'assignments', 'p1'))).toEqual([name, '_collected.md']);
    expect(read('assignments', 'p1', name)).toBe(`---\nsource: canvas\ncanvas_id: "9"\ncanvas_path: "/p1/INSTRUCTIONS.md"\nupdated: 2026-09-01\n---\n\n${raw}`);
    s = await runSync(cfg(), { api });
    expect(s).toMatchObject({ unchanged: 1, placed: 0, moved: 0 });

    // A copy placed before the transform existed: raw bytes at Admin/INSTRUCTIONS.md.
    rmSync(path.join(school, 'assignments'), { recursive: true });
    const legacy = put(raw, 'admin', 'INSTRUCTIONS.md');
    const statePath = path.join(home, 'state.json');
    const st = JSON.parse(readFileSync(statePath, 'utf8'));
    st.placements[`${COURSE}/9`] = { ...st.placements[`${COURSE}/9`], localPath: legacy, desired: undefined, handout: undefined, target: 'admin', sha256: sha256Text(raw) };
    writeFileSync(statePath, JSON.stringify(st));
    s = await runSync(cfg(), { api });
    expect(s.errors).toEqual([]);
    expect(existsSync(path.join(school, 'admin'))).toBe(false);
    expect(ls(path.join(school, 'assignments', 'p1'))).toEqual([name, '_collected.md']);
  });
});

describe('course index and facts', () => {
  it('writes one index and the assignments, announcements and syllabus files; lists removed and skipped files; rewrites nothing unchanged', async () => {
    const api = new FakeApi([lecture(), lecture({ fileId: '2', filename: 'L02.pdf', bytes: 'lecture two' }), { fileId: '8', filename: 'knn.py', folderPath: '/p1', updatedAt: T1, bytes: 'code' }]);
    api.assignments = [
      { id: 'canvas:assignment:2', title: 'Homework 2', dueAt: '2026-10-15T03:59:00.000Z', points: 20, score: null, status: 'open', effectiveDone: false, source: 'canvas', url: 'https://canvas/a/2', description: null, raw: {}, linkedIds: [] },
      { id: 'canvas:assignment:1', title: 'Homework 1', dueAt: '2026-10-08T03:59:00.000Z', points: 10, score: 9, status: 'graded', effectiveDone: true, source: 'canvas', url: 'https://canvas/a/1', description: 'Problems 1-5 from chapter 2.', raw: { submissionTypes: ['online_upload'] }, linkedIds: ['gradescope:assignment:5'] },
    ] as unknown as EffectiveItem[];
    api.announcements = [{ id: 'canvas:announcement:1', title: 'Room change', startsAt: '2026-09-28T14:00:00.000Z', url: 'https://canvas/n/1', description: 'We meet in IRB 0318 on Thursday.' }] as unknown as EffectiveItem[];
    api.content = [{ kind: 'syllabus', title: 'Syllabus', url: 'https://canvas/syllabus', raw: { text: 'Grading: 50% homework, 50% exams.' } }];
    const c = cfg({ courses: { [COURSE]: { root: school, index: '_data/canvas.md', facts: '_data' } } });
    await runSync(c, { api });

    expect(ls(path.join(school, '_data'))).toEqual(['announcements.md', 'assignments.md', 'canvas.md', 'syllabus.md']);
    expect(ls(path.join(school, 'slides'))).toEqual(['L01.pdf', 'L02.pdf']); // no per-folder index when the course has one
    const idx = read('_data', 'canvas.md');
    expect(idx).toContain('| [L01.pdf](<../slides/L01.pdf>) | slides |  |  | /Lecture Notes/L01.pdf | 2026-09-01 | 11 B | 1 |');
    expect(idx).toContain('## Not synced (on demand)');
    expect(idx).toContain('| knn.py | /p1/knn.py | 4 B | 8 |');
    const asg = read('_data', 'assignments.md');
    expect(asg.indexOf('Homework 1')).toBeLessThan(asg.indexOf('Homework 2')); // soonest due first
    expect(asg).toContain('| 2026-10-08T03:59:00.000Z | 10 | graded | 9 / 10 | canvas (+linked) | online_upload | [open](https://canvas/a/1) |');
    expect(asg).toContain('### Homework 1');
    expect(asg).toContain('Problems 1-5 from chapter 2.');
    expect(read('_data', 'announcements.md')).toContain('We meet in IRB 0318 on Thursday.');
    expect(read('_data', 'syllabus.md')).toContain('Grading: 50% homework, 50% exams.');

    const before = ['assignments.md', 'canvas.md'].map((n) => statSync(path.join(school, '_data', n)).mtimeMs);
    await runSync(c, { api });
    expect(['assignments.md', 'canvas.md'].map((n) => statSync(path.join(school, '_data', n)).mtimeMs)).toEqual(before);

    api.files = api.files.filter((f) => f.fileId !== '2'); // gone from Canvas: stays on disk, listed as removed
    await runSync(c, { api });
    expect(existsSync(path.join(school, 'slides', 'L02.pdf'))).toBe(true);
    const after = read('_data', 'canvas.md');
    expect(after).toContain('## Removed from Canvas');
    expect(after.indexOf('L02.pdf')).toBeGreaterThan(after.indexOf('## Removed from Canvas'));
  });
});
