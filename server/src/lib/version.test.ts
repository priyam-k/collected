import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveBuildInfo, shortSha } from './version.js';

const dirs: string[] = [];
const scratch = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'collected-version-'));
  dirs.push(d);
  mkdirSync(path.join(d, 'server'));
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('resolveBuildInfo', () => {
  it('prefers the env, then build-info.json, then dev (no .git here)', () => {
    const root = scratch();
    expect(resolveBuildInfo(root, undefined)).toEqual({ commit: 'dev', builtAt: null });
    writeFileSync(path.join(root, 'server', 'build-info.json'), JSON.stringify({ commit: 'abc1234', builtAt: '2026-10-28T00:00:00Z' }));
    expect(resolveBuildInfo(root, undefined)).toEqual({ commit: 'abc1234', builtAt: '2026-10-28T00:00:00Z' });
    expect(resolveBuildInfo(root, 'fedcba9876543210fedcba9876543210fedcba98')).toEqual({ commit: 'fedcba9', builtAt: '2026-10-28T00:00:00Z' });
  });

  it('treats "dev" and garbage in the file as unknown', () => {
    const root = scratch();
    writeFileSync(path.join(root, 'server', 'build-info.json'), JSON.stringify({ commit: 'dev', builtAt: '' }));
    expect(resolveBuildInfo(root, 'dev')).toEqual({ commit: 'dev', builtAt: null });
    writeFileSync(path.join(root, 'server', 'build-info.json'), 'not json');
    expect(resolveBuildInfo(root, undefined)).toEqual({ commit: 'dev', builtAt: null });
  });

  it('shortens a full sha and leaves a short one alone', () => {
    expect(shortSha('ABCDEF0123456789abcdef0123456789abcdef01')).toBe('abcdef0');
    expect(shortSha('abc1234')).toBe('abc1234');
  });
});
