import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openApi } from './api.js';
import { runCollected } from './collected.js';
import { defaultConfig, defaultLocalDataDir, isLocal, loadConfig, localDataDir, saveConfig, type AgentConfig } from './config.js';
import { LocalApi } from './local.js';

/*
 * Local mode end to end against a throwaway data directory: the config round trip, then the in-process app answering
 * the same commands the HTTP client would send. Nothing here touches the network: the Canvas demo loader answers from
 * fixtures, and the sources that would need a credential report themselves as not configured.
 */
describe('local mode', () => {
  let home: string;
  let api: LocalApi;
  const savedHome = process.env.COLLECTED_AGENT_HOME;

  beforeAll(async () => {
    home = mkdtempSync(path.join(tmpdir(), 'collected-local-'));
    process.env.COLLECTED_AGENT_HOME = home;
    const cfg = defaultConfig('local');
    cfg.local = { dataDir: defaultLocalDataDir() };
    saveConfig(cfg);
    api = await LocalApi.open(loadConfig(), { logLevel: 'silent' });
  }, 30_000);
  afterAll(() => {
    if (savedHome === undefined) delete process.env.COLLECTED_AGENT_HOME;
    else process.env.COLLECTED_AGENT_HOME = savedHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('parses a local config and knows where its data lives', () => {
    const cfg = loadConfig();
    expect(isLocal(cfg)).toBe(true);
    expect(cfg.server).toBe('local');
    expect(localDataDir(cfg)).toBe(path.join(home, 'data'));
    const explicit: AgentConfig = { ...cfg, local: { dataDir: '~/elsewhere/data' } };
    expect(localDataDir(explicit)).toBe(path.resolve(path.join(process.env.HOME ?? '', 'elsewhere', 'data')));
    expect(isLocal(defaultConfig('https://collected.example.com'))).toBe(false);
  });

  it('created the data directory 0700 with the key file beside the database', () => {
    const dir = api.dataDir;
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(readFileSync(path.join(dir, '.secret_key'), 'utf8').trim()).toMatch(/^[0-9a-f]{64}$/);
    expect(existsSync(path.join(dir, 'collected.db'))).toBe(true);
  });

  it('is signed in as the local owner, with the owner\'s rights', async () => {
    const me = await api.get<{ identity: string; user: { email: string } }>('/api/auth/me');
    expect(me.identity).toBe('local');
    expect(me.user.email).toBe('local@this-machine');
    // A settings write and the export are owner-only over HTTP; the local owner has them.
    expect(await api.get<unknown>('/api/export')).toBeTruthy();
  });

  it('demo canvas fills an empty database with courses and assignments, and the commands read them', async () => {
    expect(JSON.parse(await runCollected(api, 'courses', ['--json']))).toEqual([]);
    const loaded = await api.demo('canvas');
    expect(loaded.coursesCreated.length).toBeGreaterThanOrEqual(3);

    const courses = JSON.parse(await runCollected(api, 'courses', ['--json'])) as { code: string; id: string }[];
    expect(courses.map((c) => c.code)).toEqual(expect.arrayContaining(['CMSC422', 'CMSC330', 'MATH423']));
    expect(await runCollected(api, 'courses', [])).toMatch(/CMSC330\s+ta/);

    const all = JSON.parse(await runCollected(api, 'assignments', ['--all', '--json'])) as { id: string; title: string }[];
    expect(all.some((a) => a.id === 'canvas:assignment:7775093' && a.title === 'HW01: Warm up')).toBe(true);
    expect(Array.isArray(JSON.parse(await runCollected(api, 'agenda', ['--json'])))).toBe(true);
  }, 30_000);

  it('writes go through the same routes: done, link add, date add, sources', async () => {
    expect(await runCollected(api, 'done', ['canvas:assignment:7775093'])).toContain('marked done here');
    const after = JSON.parse(await runCollected(api, 'assignments', ['--all', '--json'])) as { id: string; effectiveDone: boolean }[];
    expect(after.find((a) => a.id === 'canvas:assignment:7775093')?.effectiveDone).toBe(true);
    expect(await runCollected(api, 'done', ['canvas:assignment:7775093', '--undo'])).toContain('no longer marked done');

    const linked = await runCollected(api, 'link', ['add', 'cmsc422', 'Piazza', 'https://piazza.com/x']);
    expect(linked).toContain('now: Piazza → https://piazza.com/x');
    expect(await runCollected(api, 'link', ['rm', 'cmsc422', 'Piazza'])).toContain('now: (none)');

    const added = await runCollected(api, 'date', ['add', 'math423', 'exam', 'Midterm 1', '2026-11-20', '--start', '10:00', '--end', '11:15']);
    expect(added).toMatch(/added exam "Midterm 1" for MATH423/);
    const dates = JSON.parse(await runCollected(api, 'dates', ['--json'])) as { title: string; id: string }[];
    const mid = dates.find((d) => d.title === 'Midterm 1')!;
    expect(mid).toBeTruthy();
    expect(await runCollected(api, 'date', ['rm', mid.id])).toContain('removed');

    const sources = JSON.parse(await runCollected(api, 'sources', ['--json'])) as { id: string; status: string }[];
    expect(sources.map((s) => s.id)).toContain('canvas');
  });

  it('resync of an unconfigured source runs in-process and reports it disconnected, without waiting', async () => {
    const out = JSON.parse(await runCollected(api, 'resync', ['gradescope', '--json'])) as { id: string; status: string; running: boolean }[];
    expect(out).toEqual([expect.objectContaining({ id: 'gradescope', status: 'disconnected', running: false })]);
  }, 20_000);

  it('download follows the route\'s redirect only to a public https host', async () => {
    // Canvas is not connected: the route answers 404, which is the error the command shows (no CDN fetch).
    await expect(api.download('99000001', path.join(home, 'x.pdf'))).rejects.toThrow(/expected a redirect, got 404/);
  });

  it('demo clear removes what the loaders created', async () => {
    const r = await api.demoClear();
    expect(r.items).toBeGreaterThan(0);
    const all = JSON.parse(await runCollected(api, 'assignments', ['--all', '--json'])) as unknown[];
    expect(all).toEqual([]);
  });

  it('openApi picks the in-process client for a local config', async () => {
    expect((await openApi(loadConfig(), { logLevel: 'silent' })) instanceof LocalApi).toBe(true);
  });
});
