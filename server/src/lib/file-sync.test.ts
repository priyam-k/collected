import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { decideFile, fileSyncConfigSchema, type FileSyncFile } from '@collected/shared';
import { courseContent, courses } from '../db/schema.js';
import { testContext } from '../test-util.js';
import { applyReport, buildManifest, courseView, setManualTarget } from './file-sync.js';

const cfg = fileSyncConfigSchema.parse({
  enabled: true,
  targets: [
    { name: 'slides', description: 'lecture slides and notes' },
    { name: 'assignments', description: 'problem sets and handouts' },
  ],
  rules: [
    { target: 'slides', folder: '^/Lectures' },
    { target: 'assignments', name: '^hw\\d+', module: null, folder: null },
    { target: 'skip', name: '\\.zip$' },
  ],
  fallback: 'model',
  threshold: 0.6,
});

const file = (over: Partial<FileSyncFile>): FileSyncFile => ({
  courseId: 'c1',
  fileId: '1',
  title: 'x.pdf',
  filename: 'x.pdf',
  folderPath: null,
  moduleName: null,
  contentType: 'application/pdf',
  size: 10,
  updatedAt: '2026-09-01T00:00:00Z',
  ...over,
});

describe('decideFile', () => {
  it('manual beats rules beats model beats fallback', () => {
    const f = file({ folderPath: '/Lectures/Week 1', filename: 'hw1.pdf' });
    expect(decideFile(cfg, f, { manualTarget: 'assignments', model: null })?.decidedBy).toBe('manual');
    expect(decideFile(cfg, f, { manualTarget: null, model: null })).toMatchObject({ target: 'slides', decidedBy: 'rule' });
    const noRule = file({ folderPath: '/Misc', filename: 'notes.pdf' });
    expect(decideFile(cfg, noRule, { manualTarget: null, model: null })).toBeNull(); // fallback=model → wait
    expect(decideFile(cfg, noRule, { manualTarget: null, model: { target: 'slides', confidence: 0.9 } })).toMatchObject({ target: 'slides', decidedBy: 'model', confidence: 0.9 });
    expect(decideFile(cfg, noRule, { manualTarget: null, model: { target: 'slides', confidence: 0.4 } })).toMatchObject({ target: 'unsorted', decidedBy: 'model' });
  });

  it('rules can skip, need every given field, and honour the non-model fallbacks', () => {
    expect(decideFile(cfg, file({ filename: 'starter.zip' }), { manualTarget: null, model: null })).toMatchObject({ target: 'skip', decidedBy: 'rule' });
    // folder rule needs a folder; a file with none can't match it.
    expect(decideFile(cfg, file({ folderPath: null, filename: 'lecture.pdf' }), { manualTarget: null, model: null })).toBeNull();
    const unsorted = { ...cfg, fallback: 'unsorted' as const };
    expect(decideFile(unsorted, file({ filename: 'q.pdf' }), { manualTarget: null, model: null })).toMatchObject({ target: 'unsorted', decidedBy: 'fallback' });
    const skip = { ...cfg, fallback: 'skip' as const };
    expect(decideFile(skip, file({ filename: 'q.pdf' }), { manualTarget: null, model: null })).toMatchObject({ target: 'skip', decidedBy: 'fallback' });
  });
});

describe('config schema', () => {
  it('rejects reserved and duplicate target names and rules pointing nowhere', () => {
    expect(fileSyncConfigSchema.safeParse({ targets: [{ name: 'skip' }] }).success).toBe(false);
    expect(fileSyncConfigSchema.safeParse({ targets: [{ name: 'a' }, { name: 'a' }] }).success).toBe(false);
    expect(fileSyncConfigSchema.safeParse({ targets: [{ name: 'a' }], rules: [{ target: 'b', name: 'x' }] }).success).toBe(false);
    expect(fileSyncConfigSchema.safeParse({ targets: [{ name: 'a' }], rules: [{ target: 'a' }] }).success).toBe(false);
    expect(fileSyncConfigSchema.safeParse({ targets: [{ name: 'a' }], rules: [{ target: 'a', name: '(' }] }).success).toBe(false);
    expect(fileSyncConfigSchema.safeParse({ targets: [{ name: 'Slides ' }], rules: [{ target: 'slides', name: 'x' }] }).success).toBe(true);
  });
});

describe('manifest and report', () => {
  it('derives decisions, stores model answers and placements, and applies overrides', async () => {
    const ctx = await testContext();
    await ctx.db.insert(courses).values([
      { id: 'c1', term: '2026-fall', code: 'LING260', fileSync: cfg },
      { id: 'c2', term: '2026-fall', code: 'MATH423', fileSync: { ...cfg, enabled: false } },
      { id: 'c3', term: '2026-fall', code: 'STAT410' },
    ]);
    await ctx.db.insert(courseContent).values([
      { id: 'c1:file:1', courseId: 'c1', kind: 'file', externalId: '1', title: 'L01.pdf', url: null, raw: { folderPath: '/Lectures', filename: 'L01.pdf', size: 5 } },
      { id: 'c1:file:2', courseId: 'c1', kind: 'file', externalId: '2', title: 'mystery.pdf', url: null, raw: { folderPath: '/Misc', filename: 'mystery.pdf' } },
      { id: 'c2:file:9', courseId: 'c2', kind: 'file', externalId: '9', title: 'off.pdf', url: null, raw: {} },
    ]);

    let m = await buildManifest(ctx);
    expect(m.courses.map((c) => c.course.id)).toEqual(['c1']); // enabled only
    const [c1] = m.courses;
    expect(c1!.files.find((f) => f.fileId === '1')?.decision).toMatchObject({ target: 'slides', decidedBy: 'rule' });
    expect(c1!.files.find((f) => f.fileId === '2')?.decision).toBeNull();

    await applyReport(ctx, {
      device: 'mbp',
      model: true,
      targets: { c1: { slides: '/Users/p/school/ling260/slides' } },
      decisions: [{ courseId: 'c1', fileId: '2', target: 'assignments', confidence: 0.81, probabilities: { assignments: 0.81, slides: 0.1, skip: 0.09 } }],
      placed: [{ courseId: 'c1', fileId: '1', target: 'slides', localPath: '/Users/p/school/ling260/slides/L01.pdf' }],
      removed: [],
      errors: [],
    });
    m = await buildManifest(ctx);
    const f2 = m.courses[0]!.files.find((f) => f.fileId === '2')!;
    expect(f2.decision).toMatchObject({ target: 'assignments', decidedBy: 'model', confidence: 0.81 });
    expect(f2.model?.probabilities).toMatchObject({ assignments: 0.81 });
    expect(m.courses[0]!.files.find((f) => f.fileId === '1')?.placed).toMatchObject({ device: 'mbp', target: 'slides' });

    // Raising the threshold re-sorts without re-running the model.
    await ctx.db.update(courses).set({ fileSync: { ...cfg, threshold: 0.9 } }).where(eq(courses.id, 'c1'));
    const row = (await ctx.db.query.courses.findFirst({ where: eq(courses.id, 'c1') }))!;
    expect((await courseView(ctx, row))!.files.find((f) => f.fileId === '2')?.decision).toMatchObject({ target: 'unsorted', decidedBy: 'model' });

    // A manual override wins over everything; null clears it.
    await setManualTarget(ctx, 'c1', '2', 'skip');
    expect((await courseView(ctx, row))!.files.find((f) => f.fileId === '2')?.decision).toMatchObject({ target: 'skip', decidedBy: 'manual' });
    await setManualTarget(ctx, 'c1', '2', null);
    expect((await courseView(ctx, row))!.files.find((f) => f.fileId === '2')?.decision?.decidedBy).toBe('model');
  });
});
