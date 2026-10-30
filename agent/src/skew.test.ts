import { describe, expect, it } from 'vitest';
import { NOTICE_INTERVAL_MS, SkewError, VersionWatch, decideSkew, maybeNotice, noticeDue, noticeLine } from './skew.js';
import type { SkewState } from './state.js';

/* The three states, the once-a-day gate and the line, all pure; the watch that throws from inside a request. */

const headers = (h: Record<string, string>) => new Headers(h);

describe('decideSkew', () => {
  const cases: [string, string | null, string | null, 'ok' | 'behind' | 'refuse', string?][] = [
    // client, server header, minClient header, expected kind, expected line fragment
    ['1.2.0', '1.2.0', '1.2.0', 'ok'],
    ['1.2.0', '1.2.7', '1.2.0', 'ok'], // a patch behind is silent
    ['1.3.0', '1.2.0', '1.2.0', 'ok'], // client ahead within the major
    ['1.2.0', null, null, 'ok'], // older server: no header
    ['1.2.0', '', null, 'ok'],
    ['1.2.0', 'latest', null, 'ok'], // malformed header
    ['1.2.0', '1.3', null, 'ok'],
    ['garbage', '1.3.0', '1.2.0', 'ok'], // a client that cannot read its own version never refuses
    ['1.2.0', '1.3.0', '1.2.0', 'behind', 'collected-cli 1.2.0 · server 1.3.0 · run: collected upgrade'],
    ['1.2.0', '1.3.0', null, 'behind', 'collected-cli 1.2.0 · server 1.3.0 · run: collected upgrade'], // no minClient header: same major is enough
    ['1.2.0', '1.3.0-rc.1', null, 'behind'],
    ['1.2.0', '1.3.0', '1.3.0', 'refuse', 'this server needs collected-cli >= 1.3.0'],
    ['1.2.0', '1.5.2', '1.2.1', 'refuse', 'collected-cli 1.2.0 · server 1.5.2 · run: collected upgrade · this server needs collected-cli >= 1.2.1'],
    ['1.2.0', '1.3.0', 'nope', 'behind'], // an unreadable minClient falls back to the major rule
    ['1.2.0', '2.0.0', '2.0.0', 'refuse', 'collected-cli 1.2.0 · server 2.0.0 · run: collected upgrade · this server needs collected-cli >= 2.0.0'],
    ['1.2.0', '2.1.0', null, 'refuse', 'this server needs collected-cli >= 2.0.0'],
    ['2.0.0', '1.3.0', '1.2.0', 'refuse', 'this server takes collected-cli 1.x: npm install -g collected-cli@1'],
  ];
  it.each(cases)('client %s · server %s · minClient %s → %s', (client, server, minClient, kind, fragment) => {
    const d = decideSkew({ client, server, minClient });
    expect(d.kind).toBe(kind);
    if (fragment) expect((d as { line: string }).line).toContain(fragment);
    if (d.kind !== 'ok') expect(d.line.startsWith(`collected-cli ${client} · server ${server}`)).toBe(true);
  });
});

describe('VersionWatch', () => {
  it('records the headers and throws once, from the first answer that cannot be talked to', () => {
    const w = new VersionWatch('1.2.0');
    w.see(headers({}));
    expect(w.server).toBeNull();
    w.see(headers({ 'x-collected-version': '1.2.3', 'x-collected-min-client': '1.2.0' }));
    expect(w.server).toBe('1.2.3');
    expect(w.minClient).toBe('1.2.0');

    const refused = new VersionWatch('1.2.0');
    expect(() => refused.see(headers({ 'x-collected-version': '2.0.0', 'x-collected-min-client': '2.0.0' }))).toThrow(SkewError);
    // Decided once: a later answer (the command is over anyway) does not throw again.
    expect(() => refused.see(headers({ 'x-collected-version': '2.0.0' }))).not.toThrow();
    let err: SkewError | null = null;
    try {
      new VersionWatch('1.2.0').see(headers({ 'x-collected-version': '1.9.0', 'x-collected-min-client': '1.5.0' }));
    } catch (e) {
      err = e as SkewError;
    }
    expect(err?.exitCode).toBe(2);
    expect(err?.message).toBe('collected-cli 1.2.0 · server 1.9.0 · run: collected upgrade · this server needs collected-cli >= 1.5.0');
  });

  it('ignores a malformed header and never throws for a behind-but-allowed server', () => {
    const w = new VersionWatch('1.2.0');
    expect(() => w.see(headers({ 'x-collected-version': 'v?' }))).not.toThrow();
    expect(w.server).toBeNull();
    expect(() => w.see(headers({ 'x-collected-version': '1.4.0', 'x-collected-min-client': '1.0.0' }))).not.toThrow();
    expect(w.server).toBe('1.4.0');
  });
});

describe('noticeDue', () => {
  const now = new Date('2026-10-29T12:00:00Z');
  const at = (ms: number) => new Date(now.getTime() + ms).toISOString();
  const st = (lastSkewNoticeAt: string | null, lastServerVersion: string | null = null) => ({ lastSkewNoticeAt, lastServerVersion });
  const cases: [string, ReturnType<typeof st>, string | null, boolean][] = [
    ['never ran', st(null), '1.3.0', true],
    ['ran a minute ago', st(at(-60_000)), '1.3.0', false],
    ['ran 23 h 59 m ago', st(at(-NOTICE_INTERVAL_MS + 60_000)), null, false],
    ['ran exactly 24 h ago', st(at(-NOTICE_INTERVAL_MS)), null, true],
    ['ran two days ago', st(at(-2 * NOTICE_INTERVAL_MS)), '1.3.0', true],
    ['unreadable timestamp', st('yesterday'), null, true],
    ['an hour in the future (clock moved)', st(at(3_600_000)), null, false],
    ['far in the future', st(at(3 * NOTICE_INTERVAL_MS)), null, true],
    ['recent, same server', st(at(-60_000), '1.3.0'), '1.3.0', false],
    ['recent, the server moved', st(at(-60_000), '1.3.0'), '1.4.0', true],
    ['recent, local mode after a server run', st(at(-60_000), '1.3.0'), null, false],
  ];
  it.each(cases)('%s → %s', (_name, state, server, due) => {
    expect(noticeDue(state, now, server)).toBe(due);
  });
});

describe('noticeLine', () => {
  it('says what is ahead of this CLI, and nothing when nothing is', () => {
    expect(noticeLine('1.2.0', '1.2.0', '1.2.0', '1.2.0')).toBeNull();
    expect(noticeLine('1.2.0', null, null, null)).toBeNull();
    expect(noticeLine('1.2.0', null, null, '1.1.0')).toBeNull();
    expect(noticeLine('1.2.0', null, null, 'soon')).toBeNull();
    expect(noticeLine('1.2.0', '1.3.0', '1.2.0', null)).toBe('collected-cli 1.2.0 · server 1.3.0 · run: collected upgrade');
    expect(noticeLine('1.2.0', '1.3.0', '1.2.0', '1.3.0')).toBe('collected-cli 1.2.0 · server 1.3.0 · 1.3.0 on npm · run: collected upgrade');
    expect(noticeLine('1.2.0', null, null, '1.3.0')).toBe('collected-cli 1.2.0 · 1.3.0 on npm · run: collected upgrade');
    expect(noticeLine('1.2.0', '1.2.0', '1.2.0', '1.3.0')).toBe('collected-cli 1.2.0 · 1.3.0 on npm · run: collected upgrade');
  });
});

describe('maybeNotice', () => {
  const now = new Date('2026-10-29T12:00:00Z');
  function harness(initial: SkewState, npm: { version: string | null; error?: string } | null) {
    let state = { ...initial };
    const lines: string[] = [];
    let asked = 0;
    const run = (server: string | null, verbose = false) =>
      maybeNotice({
        client: '1.2.0',
        server,
        minClient: server ? '1.2.0' : null,
        verbose,
        warn: (l) => lines.push(l),
        now,
        state: { load: () => state, save: (p) => (state = { ...state, ...p }) },
        npmLatest: npm
          ? async () => {
              asked++;
              return npm;
            }
          : undefined,
      });
    return { run, lines, state: () => state, asked: () => asked };
  }

  it('asks npm once a day, remembers the answer and the server, prints the line', async () => {
    const h = harness({ lastSkewNoticeAt: null, lastServerVersion: null, npmLatest: null }, { version: '1.3.0' });
    await h.run('1.3.0');
    expect(h.lines).toEqual(['collected-cli 1.2.0 · server 1.3.0 · 1.3.0 on npm · run: collected upgrade']);
    expect(h.state()).toEqual({ lastSkewNoticeAt: now.toISOString(), lastServerVersion: '1.3.0', npmLatest: '1.3.0' });
    await h.run('1.3.0');
    expect(h.asked()).toBe(1);
    expect(h.lines).toHaveLength(1);
  });

  it('is silent about a network failure unless verbose, and keeps the cached npm answer', async () => {
    const quiet = harness({ lastSkewNoticeAt: null, lastServerVersion: null, npmLatest: '1.2.0' }, { version: null, error: 'ENOTFOUND' });
    await quiet.run(null);
    expect(quiet.lines).toEqual([]);
    expect(quiet.state().npmLatest).toBe('1.2.0');
    const loud = harness({ lastSkewNoticeAt: null, lastServerVersion: null, npmLatest: null }, { version: null, error: 'ENOTFOUND' });
    await loud.run(null, true);
    expect(loud.lines).toEqual(['npm version check: ENOTFOUND']);
  });

  it('keeps the last server version through a local-mode run and does not ask npm when the check is off', async () => {
    const h = harness({ lastSkewNoticeAt: null, lastServerVersion: '1.3.0', npmLatest: null }, null);
    await h.run(null);
    expect(h.state().lastServerVersion).toBe('1.3.0');
    expect(h.lines).toEqual([]);
  });
});
