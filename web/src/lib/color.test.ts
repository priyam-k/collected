import { describe, expect, it } from 'vitest';
import { safeColor } from './color';

describe('safeColor', () => {
  it('accepts 3, 6 and 8 digit hex', () => {
    expect(safeColor('#abc')).toBe('#abc');
    expect(safeColor('#2563eb')).toBe('#2563eb');
    expect(safeColor('#2563EB80')).toBe('#2563EB80');
  });
  it('rejects anything that could reach into the style', () => {
    for (const c of ['red', 'var(--ink)', 'url(x)', '#2563eb; background: url(//evil)', '#2563e', '#abcd', '2563eb', '', null, undefined]) {
      expect(safeColor(c)).toBeUndefined();
    }
  });
});
