import { describe, expect, it } from 'vitest';
import { compareSemver, entriesNewerThan, parseChangelog, parseSemver } from './changelog.js';

const SAMPLE = `# Changelog

Every user-visible change gets a bullet.

## Unreleased

- something not shipped yet

## 0.2.0 — 2026-11-05 · optional
- Second release, first bullet
* Second release, asterisk bullet

## 0.1.1 - 2026-10-30 · recommended

- Plain hyphen separator still parses

## 0.1.0 — 2026-10-28 · recommended
- Sign-in and CLI tokens
  - an indented sub-bullet also counts
Some prose that is not a bullet is ignored.

## 0.0.9 — 2026-10-01 · mandatory
- bad level: skipped with its bullets

## not a version — 2026-10-01 · optional
- skipped too
`;

describe('parseChangelog', () => {
  it('reads versioned sections and their bullets, skips Unreleased and malformed headings', () => {
    const entries = parseChangelog(SAMPLE);
    expect(entries.map((e) => e.version)).toEqual(['0.2.0', '0.1.1', '0.1.0']);
    expect(entries[0]).toEqual({ version: '0.2.0', date: '2026-11-05', level: 'optional', notes: ['Second release, first bullet', 'Second release, asterisk bullet'] });
    expect(entries[1]!.level).toBe('recommended');
    expect(entries[2]!.notes).toEqual(['Sign-in and CLI tokens', 'an indented sub-bullet also counts']);
  });

  it('returns nothing for an empty or unrelated file', () => {
    expect(parseChangelog('')).toEqual([]);
    expect(parseChangelog('# README\n\n- a bullet with no heading')).toEqual([]);
  });

  it('parses the repository CHANGELOG.md', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const text = readFileSync(path.resolve(import.meta.dirname, '../../../CHANGELOG.md'), 'utf8');
    const entries = parseChangelog(text);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]!.notes.length).toBeGreaterThan(0);
    for (const e of entries) expect(parseSemver(e.version)).not.toBeNull();
  });
});

describe('compareSemver', () => {
  it('orders by major, minor, patch numerically', () => {
    expect(compareSemver('0.1.0', '0.1.0')).toBe(0);
    expect(compareSemver('0.1.1', '0.1.0')).toBeGreaterThan(0);
    expect(compareSemver('0.2.0', '0.1.9')).toBeGreaterThan(0);
    expect(compareSemver('1.0.0', '0.99.99')).toBeGreaterThan(0);
    expect(compareSemver('0.1.10', '0.1.9')).toBeGreaterThan(0);
    expect(compareSemver('0.1.0', '0.1.1')).toBeLessThan(0);
  });

  it('accepts a v prefix and ignores pre-release and build metadata', () => {
    expect(compareSemver('v1.2.3', '1.2.3')).toBe(0);
    expect(compareSemver('1.2.3-rc.1', '1.2.3+build')).toBe(0);
    expect(parseSemver('1.2')).toBeNull();
    expect(parseSemver('test')).toBeNull();
  });

  it('sorts an unparseable version below any real one', () => {
    expect(compareSemver('test', '0.0.1')).toBeLessThan(0);
    expect(compareSemver('0.0.1', 'dev')).toBeGreaterThan(0);
    expect(compareSemver('dev', 'test')).toBe(0);
  });
});

describe('entriesNewerThan', () => {
  it('keeps only strictly newer entries, newest first', () => {
    const entries = parseChangelog(SAMPLE);
    expect(entriesNewerThan(entries, '0.1.0').map((e) => e.version)).toEqual(['0.2.0', '0.1.1']);
    expect(entriesNewerThan(entries, '0.2.0')).toEqual([]);
    expect(entriesNewerThan(entries, '0.0.1').map((e) => e.version)).toEqual(['0.2.0', '0.1.1', '0.1.0']);
  });
});
