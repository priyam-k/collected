import { describe, expect, it } from 'vitest';
import type { AppContext } from '../context.js';
import { getSetting } from './settings.js';
import { testContext } from '../test-util.js';
import { UPDATE_SETTING_KEY, UPDATE_STEPS, createUpdateChecker, matchesUpdateAllowList, systemVersion } from './updates.js';

describe('matchesUpdateAllowList', () => {
  it('counts code, the image, the lockfile and the changelog', () => {
    for (const f of ['server/src/index.ts', 'web/src/App.tsx', 'shared/src/types.ts', 'agent/src/cli.ts', 'Dockerfile', 'docker-compose.yml', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'CHANGELOG.md', './server/x.ts']) {
      expect(matchesUpdateAllowList(f), f).toBe(true);
    }
  });
  it('ignores docs, workflows, design notes, the e2e suite and look-alike paths', () => {
    for (const f of ['README.md', 'docs/self-host.md', '.github/workflows/ci.yml', 'artifacts/DECISIONS.md', 'e2e/tests/board.spec.ts', 'CONTRIBUTING.md', 'docker-compose.build.yml', 'servers/x.ts', 'scripts/deploy.sh', 'skills/foo/SKILL.md']) {
      expect(matchesUpdateAllowList(f), f).toBe(false);
    }
  });
});

type Route = { status: number; body: string };

function fakeFetch(routes: Record<string, Route | (() => Route)>, calls: string[] = []): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.redirect).toBe('error');
    const hit = Object.entries(routes).find(([k]) => url.includes(k));
    if (!hit) throw new TypeError(`fetch failed: ${url}`);
    const r = typeof hit[1] === 'function' ? hit[1]() : hit[1];
    return new Response(r.body, { status: r.status });
  }) as typeof fetch;
}

const compareBody = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    ahead_by: 3,
    status: 'behind',
    html_url: 'https://github.com/priyam-k/collected/compare/abc1234...main',
    merge_base_commit: { sha: 'abc1234abc1234abc1234abc1234abc1234abc12' },
    commits: [{ sha: '1111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }, { sha: '2222222aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }, { sha: '3333333aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }],
    files: [{ filename: 'README.md' }],
    ...over,
  });

const CHANGELOG = '## 0.2.0 — 2026-11-05 · optional\n- newer\n\n## 0.1.0 — 2026-10-28 · recommended\n- current\n';

async function built(commit = 'abc1234', version = '0.1.0'): Promise<AppContext> {
  const ctx = await testContext();
  ctx.version = version;
  ctx.build = { commit, builtAt: '2026-10-28T00:00:00Z' };
  return ctx;
}

describe('createUpdateChecker', () => {
  it('reports ahead, matters=false for a docs-only change, the upstream version and the newer changelog entries', async () => {
    const ctx = await built();
    const calls: string[] = [];
    const checker = createUpdateChecker(ctx, {
      fetch: fakeFetch(
        {
          '/compare/abc1234...main': { status: 200, body: compareBody() },
          '/main/package.json': { status: 200, body: JSON.stringify({ version: '0.2.0' }) },
          '/main/CHANGELOG.md': { status: 200, body: CHANGELOG },
        },
        calls,
      ),
      now: () => new Date('2026-10-29T12:00:00Z'),
    });
    const s = await checker.check();
    expect(s.error).toBeNull();
    expect(s.current).toEqual(systemVersion(ctx));
    expect(s.current).toMatchObject({ version: '0.1.0', commit: 'abc1234', repo: 'priyam-k/collected' });
    expect(s.upstream).toEqual({
      commit: '3333333',
      version: '0.2.0',
      ahead: 3,
      matters: false,
      checkedAt: '2026-10-29T12:00:00.000Z',
      url: 'https://github.com/priyam-k/collected/compare/abc1234...main',
    });
    expect(s.changelog.map((e) => e.version)).toEqual(['0.2.0']);
    expect(s.steps).toEqual(UPDATE_STEPS);
    expect(calls[0]).toBe('https://api.github.com/repos/priyam-k/collected/compare/abc1234...main');
    // persisted so a restart keeps the result
    const stored = await getSetting<{ upstream: { ahead: number } }>(ctx, UPDATE_SETTING_KEY);
    expect(stored?.upstream.ahead).toBe(3);
    const fresh = createUpdateChecker(ctx, { fetch: fakeFetch({}) });
    expect((await fresh.status()).upstream?.ahead).toBe(3);
  });

  it('matters when a changed file is on the allow-list', async () => {
    const ctx = await built();
    const checker = createUpdateChecker(ctx, {
      fetch: fakeFetch({
        '/compare/': { status: 200, body: compareBody({ files: [{ filename: 'docs/self-host.md' }, { filename: 'server/src/lib/updates.ts' }] }) },
        '/main/package.json': { status: 200, body: JSON.stringify({ version: '0.1.0' }) },
        '/main/CHANGELOG.md': { status: 404, body: '' },
      }),
    });
    const s = await checker.check();
    expect(s.upstream?.matters).toBe(true);
    expect(s.upstream?.version).toBe('0.1.0');
    expect(s.changelog).toEqual([]);
  });

  it('is up to date when ahead_by is 0', async () => {
    const ctx = await built();
    const checker = createUpdateChecker(ctx, {
      fetch: fakeFetch({
        '/compare/': { status: 200, body: compareBody({ ahead_by: 0, status: 'identical', commits: [], files: [] }) },
        '/main/': { status: 200, body: JSON.stringify({ version: '0.1.0' }) },
      }),
    });
    const s = await checker.check();
    expect(s.upstream).toMatchObject({ ahead: 0, matters: false, commit: 'abc1234' });
  });

  it('a dev build makes no request and says why', async () => {
    const ctx = await built('dev');
    const calls: string[] = [];
    const s = await createUpdateChecker(ctx, { fetch: fakeFetch({}, calls) }).check();
    expect(calls).toEqual([]);
    expect(s.upstream).toBeNull();
    expect(s.error).toMatch(/development build/);
  });

  it('a 404 from compare (commit not on GitHub) reports upstream null with a clear error', async () => {
    const ctx = await built('f00dcaf');
    const s = await createUpdateChecker(ctx, { fetch: fakeFetch({ '/compare/': { status: 404, body: '{"message":"Not Found"}' } }) }).check();
    expect(s.upstream).toBeNull();
    expect(s.error).toMatch(/f00dcaf is not on github.com\/priyam-k\/collected/);
  });

  it('a failed check sets error and keeps the last good upstream; the next good check clears it', async () => {
    const ctx = await built();
    let fail = false;
    const checker = createUpdateChecker(ctx, {
      fetch: fakeFetch({
        '/compare/': () => (fail ? { status: 403, body: 'rate limited' } : { status: 200, body: compareBody() }),
        '/main/': { status: 200, body: JSON.stringify({ version: '0.1.0' }) },
      }),
    });
    const good = await checker.check();
    expect(good.upstream?.ahead).toBe(3);
    fail = true;
    const bad = await checker.check();
    expect(bad.error).toMatch(/403/);
    expect(bad.upstream?.ahead).toBe(3);
    // and a network error (fetch rejects) is the same story
    const dead = createUpdateChecker(ctx, { fetch: fakeFetch({}) });
    const s = await dead.check();
    expect(s.error).toMatch(/update check failed/);
    expect(s.upstream?.ahead).toBe(3);
    fail = false;
    expect((await checker.check()).error).toBeNull();
  });

  it('a changelog fetch failure keeps the compare result', async () => {
    const ctx = await built();
    const s = await createUpdateChecker(ctx, { fetch: fakeFetch({ '/compare/': { status: 200, body: compareBody() } }) }).check();
    expect(s.error).toBeNull();
    expect(s.upstream?.ahead).toBe(3);
    expect(s.upstream?.version).toBeNull();
  });

  it('concurrent checks share one run', async () => {
    const ctx = await built();
    const calls: string[] = [];
    const checker = createUpdateChecker(ctx, { fetch: fakeFetch({ '/compare/': { status: 200, body: compareBody() }, '/main/': { status: 200, body: '{}' } }, calls) });
    await Promise.all([checker.check(), checker.check(), checker.check()]);
    expect(calls.filter((u) => u.includes('/compare/'))).toHaveLength(1);
  });

  it('does nothing when disabled', async () => {
    const ctx = await built();
    (ctx.env as { UPDATE_CHECK_DISABLED: boolean }).UPDATE_CHECK_DISABLED = true;
    const calls: string[] = [];
    const s = await createUpdateChecker(ctx, { fetch: fakeFetch({}, calls) }).check();
    expect(calls).toEqual([]);
    expect(s.upstream).toBeNull();
    expect(s.error).toMatch(/UPDATE_CHECK_DISABLED/);
  });
});
