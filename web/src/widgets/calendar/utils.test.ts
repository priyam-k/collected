import { describe, expect, it } from 'vitest';
import type { EffectiveItem } from '@collected/shared';
import { HOUR_END, HOUR_START, placeDay, type Placed } from './utils';

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

  it('clamps events to the grid', () => {
    const gridMin = (HOUR_END - HOUR_START) * 60;
    const p = place(ev('early', [6, 0], [8, 0]), ev('late', [22, 0], [23, 59]), ev('night', [23, 30], [23, 45]), ev('dawn', [5, 0], [6, 0]));
    expect(p('early')).toMatchObject({ top: 0, bottom: 60 });
    expect(p('late').bottom).toBe(gridMin);
    expect(p('night').bottom).toBe(gridMin);
    expect(p('night').top).toBeLessThan(gridMin);
    expect(p('dawn').top).toBe(0);
    expect(p('dawn').bottom).toBeGreaterThan(0);
  });
});
