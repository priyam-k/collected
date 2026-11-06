import { describe, expect, it } from 'vitest';
import { describeScopes, formatScopes, isFullScopes, normalizeScopes, parseScopes, scopeGrants, scopeGrantsAny } from '@collected/shared';

describe('token scopes', () => {
  it('null and all-write both mean everything', () => {
    expect(isFullScopes(null)).toBe(true);
    expect(isFullScopes({ courses: 'write', jobs: 'write', calendar: 'write', tasks: 'write' })).toBe(true);
    expect(isFullScopes({ courses: 'write' })).toBe(false);
    expect(normalizeScopes({ courses: 'write', jobs: 'write', calendar: 'write', tasks: 'write' })).toBeNull();
  });

  it('write implies read; a missing area is closed', () => {
    const s = { jobs: 'write', courses: 'read' } as const;
    expect(scopeGrants(s, 'jobs', 'read')).toBe(true);
    expect(scopeGrants(s, 'jobs', 'write')).toBe(true);
    expect(scopeGrants(s, 'courses', 'write')).toBe(false);
    expect(scopeGrants(s, 'calendar', 'read')).toBe(false);
    expect(scopeGrants(null, 'calendar', 'write')).toBe(true);
    expect(scopeGrantsAny({})).toBe(false);
    expect(scopeGrantsAny({ tasks: 'read' })).toBe(true);
  });

  it('normalizes unknown keys and values away', () => {
    expect(normalizeScopes({ jobs: 'read', nope: 'write', courses: 'admin' })).toEqual({ jobs: 'read' });
    expect(normalizeScopes('jobs')).toEqual({});
    expect(normalizeScopes(undefined)).toBeNull();
  });

  it('parses and prints the compact CLI form', () => {
    expect(parseScopes('all')).toBeNull();
    expect(parseScopes('courses:rw,jobs:r')).toEqual({ courses: 'write', jobs: 'read' });
    expect(parseScopes('tasks=write calendar:read')).toEqual({ tasks: 'write', calendar: 'read' });
    expect(parseScopes('jobs:r,jobs:rw')).toEqual({ jobs: 'write' });
    expect(parseScopes('courses:rw,jobs:rw,calendar:rw,tasks:rw')).toBeNull();
    expect(() => parseScopes('grades:r')).toThrow(/unknown scope area/);
    expect(() => parseScopes('jobs')).toThrow(/expected/);
    expect(formatScopes(null)).toBe('all');
    expect(formatScopes({ courses: 'write', jobs: 'read' })).toBe('courses:rw,jobs:r');
    expect(formatScopes({})).toBe('none');
    expect(describeScopes({ courses: 'write', jobs: 'read' })).toBe('courses: read, write · jobs: read');
    expect(describeScopes(null)).toBe('everything');
  });
});
