import { afterEach, describe, expect, it, vi } from 'vitest';
import { commandLine, detectInstallMethod, fetchNpmLatest, runUpgrade, upgradeCommand, type InstallMethod } from './upgrade.js';

afterEach(() => vi.unstubAllGlobals());

describe('detectInstallMethod', () => {
  const cases: [string, InstallMethod][] = [
    ['/usr/local/lib/node_modules/collected-cli/dist/cli.js', 'npm'],
    ['/opt/homebrew/lib/node_modules/collected-cli/dist/cli.js', 'npm'],
    ['/Users/p/.nvm/versions/node/v22.12.0/lib/node_modules/collected-cli/dist/cli.js', 'npm'],
    ['/Users/p/.volta/tools/image/packages/collected-cli/lib/node_modules/collected-cli/dist/cli.js', 'npm'],
    ['C:\\Users\\p\\AppData\\Roaming\\npm\\node_modules\\collected-cli\\dist\\cli.js', 'npm'],
    ['/Users/p/Library/pnpm/global/5/.pnpm/collected-cli@1.2.0/node_modules/collected-cli/dist/cli.js', 'pnpm'],
    ['/home/p/.local/share/pnpm/global/5/node_modules/collected-cli/dist/cli.js', 'pnpm'],
    ['/Users/p/.bun/install/global/node_modules/collected-cli/dist/cli.js', 'bun'],
    ['/Users/p/.npm/_npx/0a1b2c3d/node_modules/collected-cli/dist/cli.js', 'npx'],
    ['/Users/p/dev/collected/agent/dist/cli.js', 'checkout'],
    ['/Users/p/dev/collected/agent/src/cli.ts', 'checkout'],
    ['/Users/p/project/node_modules/collected-cli/dist/cli.js', 'unknown'], // a project-local install
    ['/Users/p/project/node_modules/.pnpm/collected-cli@1.2.0/node_modules/collected-cli/dist/cli.js', 'unknown'],
    ['/usr/local/lib/node_modules/other-tool/node_modules/collected-cli/dist/cli.js', 'unknown'], // another tool's dependency, not ours to upgrade
    ['/usr/local/bin/collected', 'unknown'], // an unresolved symlink
    ['', 'unknown'],
  ];
  it.each(cases)('%s → %s', (argv1, method) => {
    expect(detectInstallMethod(argv1)).toBe(method);
  });
});

describe('upgradeCommand', () => {
  it('names one install command per installer and none for the rest', () => {
    expect(commandLine(upgradeCommand('npm')!)).toBe('npm install -g collected-cli@latest');
    expect(commandLine(upgradeCommand('pnpm')!)).toBe('pnpm add -g collected-cli@latest');
    expect(commandLine(upgradeCommand('bun')!)).toBe('bun add -g collected-cli@latest');
    expect(upgradeCommand('npx')).toBeNull();
    expect(upgradeCommand('checkout')).toBeNull();
    expect(upgradeCommand('unknown')).toBeNull();
  });
});

describe('fetchNpmLatest', () => {
  const stub = (handler: (url: string, init: RequestInit) => Response | Promise<Response>) => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', async (url: string | URL | Request, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      return handler(String(url), init);
    });
    return calls;
  };

  it('reads the version off the registry with a timeout and no redirects', async () => {
    const calls = stub(() => new Response(JSON.stringify({ name: 'collected-cli', version: '1.3.0' }), { status: 200 }));
    expect(await fetchNpmLatest()).toEqual({ version: '1.3.0' });
    expect(calls[0]!.url).toBe('https://registry.npmjs.org/collected-cli/latest');
    expect(calls[0]!.init.redirect).toBe('error');
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
  });

  it('answers null with a reason on a bad status, a bodyless answer, garbage or a network error', async () => {
    stub(() => new Response('', { status: 503 }));
    expect(await fetchNpmLatest()).toEqual({ version: null, error: 'registry answered 503' });
    stub(() => new Response(JSON.stringify({ version: 'latest' }), { status: 200 }));
    expect(await fetchNpmLatest()).toEqual({ version: null, error: 'registry answered without a version' });
    stub(() => new Response('<html>', { status: 200 }));
    expect((await fetchNpmLatest()).version).toBeNull();
    stub(() => {
      throw new TypeError('fetch failed');
    });
    expect(await fetchNpmLatest()).toEqual({ version: null, error: 'fetch failed' });
    stub(() => {
      const e = new Error('aborted');
      e.name = 'TimeoutError';
      throw e;
    });
    expect((await fetchNpmLatest({ timeoutMs: 10_000 })).error).toBe('no answer from the registry in 10 s');
  });
});

describe('runUpgrade', () => {
  function harness(argv1: string, latest: { version: string | null; error?: string }, opts: { dryRun?: boolean; verbose?: boolean; exit?: number; newVersion?: string | null } = {}) {
    const out: string[] = [];
    const err: string[] = [];
    const ran: string[] = [];
    const code = runUpgrade({
      argv1,
      current: '1.2.0',
      dryRun: !!opts.dryRun,
      verbose: !!opts.verbose,
      say: (l) => out.push(l),
      warn: (l) => err.push(l),
      realpath: (p) => p,
      latest: async () => latest,
      run: async (cmd, args) => {
        ran.push([cmd, ...args].join(' '));
        return opts.exit ?? 0;
      },
      newVersion: () => ('newVersion' in opts ? (opts.newVersion ?? null) : '1.3.0'),
    });
    return { code, out, err, ran };
  }
  const npmPath = '/usr/local/lib/node_modules/collected-cli/dist/cli.js';

  it('says which version it installs, prints the command, runs it, and prints the new version', async () => {
    const h = harness(npmPath, { version: '1.3.0' });
    expect(await h.code).toBe(0);
    expect(h.ran).toEqual(['npm install -g collected-cli@latest']);
    expect(h.out).toEqual(['collected-cli 1.2.0 → 1.3.0 (the newest on npm)', 'running: npm install -g collected-cli@latest', 'collected-cli 1.3.0']);
    expect(h.err).toEqual([]);
  });

  it('--dry-run prints and runs nothing; pnpm and bun get their own commands', async () => {
    const pnpm = harness('/Users/p/Library/pnpm/global/5/.pnpm/collected-cli@1.2.0/node_modules/collected-cli/dist/cli.js', { version: '1.3.0' }, { dryRun: true });
    expect(await pnpm.code).toBe(0);
    expect(pnpm.ran).toEqual([]);
    expect(pnpm.out.at(-1)).toBe('would run: pnpm add -g collected-cli@latest');
    const bun = harness('/Users/p/.bun/install/global/node_modules/collected-cli/dist/cli.js', { version: '1.3.0' }, { dryRun: true });
    await bun.code;
    expect(bun.out.at(-1)).toBe('would run: bun add -g collected-cli@latest');
  });

  it('does nothing when npm has nothing newer, and says so', async () => {
    const same = harness(npmPath, { version: '1.2.0' });
    expect(await same.code).toBe(0);
    expect(same.ran).toEqual([]);
    expect(same.out).toEqual(['collected-cli 1.2.0 is the newest on npm']);
    const ahead = harness(npmPath, { version: '1.1.0' });
    expect(await ahead.code).toBe(0);
    expect(ahead.out).toEqual(['collected-cli 1.2.0 is newer than npm\u2019s 1.1.0'.replace('\u2019', "'")]);
  });

  it('installs @latest anyway when the registry cannot be asked, quietly unless verbose', async () => {
    const quiet = harness(npmPath, { version: null, error: 'ENOTFOUND' });
    expect(await quiet.code).toBe(0);
    expect(quiet.err).toEqual([]);
    expect(quiet.ran).toEqual(['npm install -g collected-cli@latest']);
    const loud = harness(npmPath, { version: null, error: 'ENOTFOUND' }, { verbose: true });
    await loud.code;
    expect(loud.err).toEqual(['could not ask npm which version is newest (ENOTFOUND); installing @latest anyway']);
  });

  it('prints the npm command and exits 1 when it cannot tell how the CLI was installed', async () => {
    const unknown = harness('/Users/p/project/node_modules/collected-cli/dist/cli.js', { version: '1.3.0' });
    expect(await unknown.code).toBe(1);
    expect(unknown.ran).toEqual([]);
    expect(unknown.out.at(-1)).toContain('npm install -g collected-cli@latest');
    const checkout = harness('/Users/p/dev/collected/agent/dist/cli.js', { version: '1.3.0' });
    expect(await checkout.code).toBe(1);
    expect(checkout.out.at(-1)).toContain('git pull, then pnpm build:cli');
    const npx = harness('/Users/p/.npm/_npx/0a1b/node_modules/collected-cli/dist/cli.js', { version: '1.3.0' });
    expect(await npx.code).toBe(1);
    expect(npx.out.at(-1)).toContain('npx cache');
  });

  it('passes the installer\u2019s exit code through and says "done" when the new binary cannot be asked', async () => {
    const failed = harness(npmPath, { version: '1.3.0' }, { exit: 243 });
    expect(await failed.code).toBe(243);
    expect(failed.err).toEqual(['npm exited 243']);
    const mute = harness(npmPath, { version: '1.3.0' }, { newVersion: null });
    expect(await mute.code).toBe(0);
    expect(mute.out.at(-1)).toBe('done');
  });
});
