import { describe, expect, it } from 'vitest';
import { safeHref } from './url';

describe('safeHref', () => {
  it('passes http and https URLs through unchanged', () => {
    expect(safeHref('https://umd.instructure.com/courses/1')).toBe('https://umd.instructure.com/courses/1');
    expect(safeHref('http://localhost:3000/x?y=1#z')).toBe('http://localhost:3000/x?y=1#z');
  });
  it('rejects other schemes, relative paths and junk', () => {
    for (const u of ['javascript:alert(1)', 'data:text/html,hi', 'vbscript:x', 'file:///etc/passwd', '/relative', '#', '', null, undefined, 'not a url', '//evil.example']) {
      expect(safeHref(u)).toBeUndefined();
    }
  });
});
