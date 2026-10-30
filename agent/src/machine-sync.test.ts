import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Course, FileSyncManifest } from '@collected/shared';
import type { CollectedApi } from './api.js';
import { defaultConfig, defaultLocalDataDir, loadConfig, saveConfig, type AgentConfig } from './config.js';
import { LocalApi } from './local.js';
import { describeFileSync, machineSync } from './machine-sync.js';

/*
 * Bare `collected sync` against the in-process app over a throwaway data directory: the sources first (the same
 * `sync all` path), then the file sync. No network: the jobs feed is switched off before any run, the other sources
 * have no credential and end as `disconnected`, and the one course with the file sync on is not linked to a folder here,
 * so nothing is downloaded or written.
 */
describe('machineSync in local mode', () => {
  let home: string;
  let api: LocalApi;
  let cfg: AgentConfig;
  const savedHome = process.env.COLLECTED_AGENT_HOME;

  beforeAll(async () => {
    home = mkdtempSync(path.join(tmpdir(), 'collected-machine-sync-'));
    process.env.COLLECTED_AGENT_HOME = home;
    const fresh = defaultConfig('local');
    fresh.local = { dataDir: defaultLocalDataDir() };
    saveConfig(fresh);
    cfg = loadConfig();
    api = await LocalApi.open(cfg, { logLevel: 'silent' });
    await api.send('PUT', '/api/sources/jobs/enabled', { enabled: false });
  }, 30_000);
  afterAll(() => {
    if (savedHome === undefined) delete process.env.COLLECTED_AGENT_HOME;
    else process.env.COLLECTED_AGENT_HOME = savedHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('with no course syncing files: every enabled source runs, then the file half says there is nothing to do', async () => {
    const lines: string[] = [];
    const r = await machineSync(cfg, { api, log: (l) => lines.push(l) });
    expect(r.sources).not.toBeNull();
    const ids = r.sources!.map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(['canvas', 'gradescope', 'todoist']));
    expect(ids).not.toContain('jobs');
    for (const s of r.sources!) expect(s.running).toBe(false);
    expect(r.sources!.find((s) => s.id === 'canvas')).toMatchObject({ status: 'disconnected' });
    expect(r.sourceErrors).toBe(0);
    expect(r.files).toBeNull();
    expect(r.fileErrors).toBe(0);
    const text = lines.join('\n');
    expect(text).toMatch(/Source\s+Status/);
    expect(text).toMatch(/canvas\s+disconnected/);
    expect(lines.at(-1)).toContain('no course has the file sync on');
  }, 30_000);

  it('runs the sources and then the file sync once a course has it on, in that order', async () => {
    await api.demo('canvas');
    const courses = await api.get<Course[]>('/api/courses');
    const c = courses.find((x) => x.code === 'CMSC422')!;
    await api.send('PUT', `/api/courses/${encodeURIComponent(c.id)}`, { fileSync: { enabled: true, targets: [{ name: 'slides', description: 'lecture slides' }], rules: [], fallback: 'model' } });
    const manifest = await api.getManifest();
    expect(manifest.courses.map((m) => m.course.code)).toEqual(['CMSC422']);

    const lines: string[] = [];
    const r = await machineSync(cfg, { api, log: (l) => lines.push(l), now: (() => { let t = 0; return () => (t += 1500); })() });
    expect(r.sources).not.toBeNull();
    expect(r.files).toMatchObject({ courses: 1, placed: 0, errors: [] });
    const table = lines.findIndex((l) => /Source\s+Status/.test(l));
    const files = lines.findIndex((l) => l.startsWith('CMSC422: no folder on this machine'));
    expect(table).toBeGreaterThanOrEqual(0);
    expect(files).toBeGreaterThan(table);
    expect(lines.at(-1)).toBe('1 course: 0 new, 0 updated, 0 moved, 0 adopted, 0 removed, 0 unchanged, 0 skipped in 1.5 s');
  }, 30_000);

  it('--dry-run skips the sources and says so; the file flags still apply', async () => {
    const lines: string[] = [];
    const r = await machineSync(cfg, { api, dryRun: true, course: 'cmsc422', noModel: true, log: (l) => lines.push(l) });
    expect(r.sources).toBeNull();
    expect(r.sourceErrors).toBe(0);
    expect(lines[0]).toContain('dry run: the sources are not synced');
    expect(lines.join('\n')).not.toMatch(/Source\s+Status/);
    expect(r.files).toMatchObject({ courses: 1 });
    expect(lines.at(-1)).toMatch(/^dry run: 1 course: /);
  }, 30_000);
});

describe('machineSync against a server', () => {
  it('runs the file sync only; the server keeps its own sources', async () => {
    const calls: string[] = [];
    const empty: FileSyncManifest = { courses: [] } as unknown as FileSyncManifest;
    const api = {
      get: async (p: string) => { calls.push(`GET ${p}`); throw new Error(`unexpected GET ${p}`); },
      send: async (m: string, p: string) => { calls.push(`${m} ${p}`); return { ok: true }; },
      getManifest: async () => { calls.push('manifest'); return empty; },
      postReport: async () => { calls.push('report'); return { ok: true as const }; },
      download: async () => { throw new Error('no downloads'); },
      getItems: async () => [],
      getCourseContent: async () => [],
      postCanvasCookie: async () => ({ ok: true, outcome: null }),
    } as unknown as CollectedApi;
    const cfg: AgentConfig = { ...defaultConfig('https://collected.example.com'), cacheDir: path.join(tmpdir(), 'collected-no-cache') };
    const lines: string[] = [];
    const r = await machineSync(cfg, { api, log: (l) => lines.push(l), now: (() => { let t = 0; return () => (t += 200); })() });
    expect(r.sources).toBeNull();
    expect(r.files).toMatchObject({ courses: 0 });
    expect(calls.filter((c) => c.includes('/api/sources'))).toEqual([]);
    expect(lines).toEqual(['0 courses: 0 new, 0 updated, 0 moved, 0 adopted, 0 removed, 0 unchanged, 0 skipped in 0.2 s']);
  });

  it('the summary line reads as it always has', () => {
    const base = { courses: 2, placed: 1, updated: 0, moved: 0, adopted: 0, removed: 0, skipped: 0, unchanged: 3, pending: 2, classified: 1, errors: [{ message: 'x' }] };
    expect(describeFileSync(base, true, 2300)).toBe('dry run: 2 courses: 1 new, 0 updated, 0 moved, 0 adopted, 0 removed, 3 unchanged, 0 skipped, 2 waiting for the model, 1 classified, 1 error in 2.3 s');
  });
});
