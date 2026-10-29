import { describe, expect, it } from 'vitest';
import { sourcesToSync, takeFreshnessFlags, type SourceFreshness } from './freshness.js';

const now = new Date('2026-10-29T12:00:00Z');
const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000).toISOString();
const row = (id: SourceFreshness['id'], over: Partial<SourceFreshness> = {}): SourceFreshness => ({ id, enabled: true, status: 'connected', lastSuccessAt: at(5), running: false, ...over });

describe('sourcesToSync', () => {
  const rows = [
    row('canvas', { lastSuccessAt: at(45) }),
    row('canvas_ical', { status: 'disconnected', lastSuccessAt: null }),
    row('gradescope', { lastSuccessAt: at(10) }),
    row('gcal', { status: 'needs_auth', lastSuccessAt: at(300) }),
    row('gcal_ical', { lastSuccessAt: null }),
    row('todoist', { lastSuccessAt: at(31) }),
    row('gtasks', { enabled: false, lastSuccessAt: at(400) }),
    row('jobs', { lastSuccessAt: at(120) }),
  ];

  it('picks the connected sources a dashboard read depends on that are older than the age', () => {
    expect(sourcesToSync('agenda', rows, now, 30)).toEqual(['canvas', 'gcal_ical', 'todoist']);
    expect(sourcesToSync('todo', rows, now, 30)).toEqual(['canvas', 'gcal_ical', 'todoist']);
    expect(sourcesToSync('grades', rows, now, 60)).toEqual(['gcal_ical']);
  });

  it('jobs reads touch the jobs feed only; courses, sources and links touch nothing', () => {
    expect(sourcesToSync('jobs', rows, now, 30)).toEqual(['jobs']);
    expect(sourcesToSync('jobs', rows, now, 180)).toEqual([]);
    for (const cmd of ['courses', 'sources', 'link', 'canvas', 'resync', 'nonsense']) expect(sourcesToSync(cmd, rows, now, 1)).toEqual([]);
  });

  it('--fresh syncs every connected relevant source; --stale-ok none; a running one is left alone', () => {
    expect(sourcesToSync('assignments', rows, now, 30, { fresh: true })).toEqual(['canvas', 'gradescope', 'gcal_ical', 'todoist']);
    expect(sourcesToSync('assignments', rows, now, 30, { staleOk: true })).toEqual([]);
    expect(sourcesToSync('assignments', rows, now, 30, { fresh: true, staleOk: true })).toEqual([]);
    const busy = rows.map((r) => (r.id === 'canvas' ? { ...r, running: true } : r));
    expect(sourcesToSync('dates', busy, now, 30)).toEqual(['gcal_ical', 'todoist']);
  });

  it('a source that failed or needs a credential is never synced from a read', () => {
    const broken = [row('canvas', { status: 'error', lastSuccessAt: at(500) }), row('todoist', { status: 'needs_auth', lastSuccessAt: null })];
    expect(sourcesToSync('agenda', broken, now, 30)).toEqual([]);
    expect(sourcesToSync('agenda', broken, now, 30, { fresh: true })).toEqual([]);
  });

  it('is exact at the boundary', () => {
    expect(sourcesToSync('agenda', [row('canvas', { lastSuccessAt: at(30) })], now, 30)).toEqual([]);
    expect(sourcesToSync('agenda', [row('canvas', { lastSuccessAt: at(30.01) })], now, 30)).toEqual(['canvas']);
  });
});

describe('takeFreshnessFlags', () => {
  it('lifts the two flags out and leaves the rest in order', () => {
    expect(takeFreshnessFlags(['--course', 'x', '--fresh', '--json'])).toEqual({ flags: { fresh: true }, rest: ['--course', 'x', '--json'] });
    expect(takeFreshnessFlags(['--stale-ok'])).toEqual({ flags: { staleOk: true }, rest: [] });
    expect(takeFreshnessFlags(['a', 'b'])).toEqual({ flags: {}, rest: ['a', 'b'] });
  });
});
