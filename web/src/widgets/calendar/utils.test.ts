import { describe, expect, it } from 'vitest';
import type { EffectiveItem } from '@collected/shared';
import { GRID_MINUTES, placeDay, type Placed } from './utils';

/** A timed event on Oct 28 from h1:m1 to h2:m2 (local time). */
function ev(id: string, start: [number, number], end: [number, number]): EffectiveItem {
  const at = ([h, m]: [number, number]) => new Date(2026, 9, 28, h, m).toISOString();
  return { id, kind: 'event', allDay: false, startsAt: at(start), endsAt: at(end), dueAt: null, raw: {} } as unknown as EffectiveItem;
}

/** Lays out the events and returns a lookup by id that fails the test on a missing id. */
function place(...events: EffectiveItem[]): (id: string) => Placed {
  const placed = placeDay(events);
  return (id) => placed.find((p) => p.item.id === id) ?? expect.unreachable(`no ${id}`);
}

describe('placeDay', () => {
  it('gives events that do not overlap the full width', () => {
    const p = place(ev('a', [9, 0], [10, 0]), ev('b', [10, 0], [11, 0]));
    expect(p('a')).toMatchObject({ col: 0, cols: 1 });
    expect(p('b')).toMatchObject({ col: 0, cols: 1 });
  });

  it('puts overlapping events side by side and reuses a freed column', () => {
    const p = place(ev('a', [9, 0], [11, 0]), ev('b', [9, 30], [10, 0]), ev('c', [10, 0], [10, 30]));
    expect(p('a')).toMatchObject({ col: 0, cols: 2 });
    expect(p('b')).toMatchObject({ col: 1, cols: 2 });
    expect(p('c')).toMatchObject({ col: 1, cols: 2 });
  });

  it('places events by minutes after midnight, early morning and late night included', () => {
    const p = place(ev('dawn', [5, 0], [6, 0]), ev('early', [6, 0], [8, 0]), ev('late', [22, 0], [23, 59]));
    expect(p('dawn')).toMatchObject({ top: 300, bottom: 360 });
    expect(p('early')).toMatchObject({ top: 360, bottom: 480 });
    expect(p('late')).toMatchObject({ top: 1320, bottom: 1439 });
  });

  it('clamps events to the day', () => {
    const across = ev('across', [23, 0], [23, 0]);
    (across as { endsAt: string }).endsAt = new Date(2026, 9, 29, 1, 0).toISOString();
    const p = place(across, ev('night', [23, 55], [23, 59]), ev('midnight', [0, 0], [0, 5]));
    expect(p('across')).toMatchObject({ top: 1380, bottom: GRID_MINUTES });
    expect(p('night').bottom).toBe(GRID_MINUTES);
    expect(p('night').top).toBeLessThan(23 * 60 + 55);
    expect(p('midnight').top).toBe(0);
    expect(p('midnight').bottom).toBeGreaterThan(5);
  });
});
