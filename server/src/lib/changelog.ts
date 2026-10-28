import type { ChangelogEntry } from '@collected/shared';

/**
 * CHANGELOG.md is machine-read by the update check, so the format is strict:
 *
 *   ## 0.1.0 — 2026-10-28 · recommended
 *   - a bullet per user-visible change
 *
 * The separator after the version is an em dash (or a plain hyphen), the level is `recommended` or `optional` after a
 * middle dot. `## Unreleased` and any other heading that does not match is skipped together with its bullets.
 */
const HEADING = /^##\s+(\d+\.\d+\.\d+)\s+[—–-]\s+(\d{4}-\d{2}-\d{2})\s+[·•]\s+(recommended|optional)\s*$/;
const BULLET = /^\s*[-*]\s+(.*\S)\s*$/;

export function parseChangelog(text: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  let current: ChangelogEntry | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('## ')) {
      const m = HEADING.exec(line);
      current = m ? { version: m[1]!, date: m[2]!, level: m[3] as ChangelogEntry['level'], notes: [] } : null;
      if (current) entries.push(current);
      continue;
    }
    if (!current) continue;
    const b = BULLET.exec(line);
    if (b) current.notes.push(b[1]!);
  }
  return entries;
}

export function parseSemver(v: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Negative when a < b, zero when equal, positive when a > b, on major.minor.patch only. Unparseable versions sort lowest. */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  for (let i = 0; i < 3; i++) {
    if (pa[i]! !== pb[i]!) return pa[i]! - pb[i]!;
  }
  return 0;
}

/** Entries strictly newer than `running`, newest first (sorted by version, not by file order). */
export function entriesNewerThan(entries: ChangelogEntry[], running: string): ChangelogEntry[] {
  return entries.filter((e) => compareSemver(e.version, running) > 0).sort((a, b) => compareSemver(b.version, a.version));
}
