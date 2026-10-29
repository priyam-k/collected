import { describe, expect, it } from 'vitest';
import type { CourseRow } from '../../db/schema.js';
import { loadFixtureText } from './fixture-client.js';
import { parseCanvasIcs } from './ical.js';

const ours = [
  { id: 'cmsc422', code: 'CMSC422', archived: false },
  { id: 'ling260', code: 'LING260', archived: false },
  { id: 'stat410', code: 'STAT410', archived: false },
] as CourseRow[];

describe('canvas ical', () => {
  it('parses assignments and events and links courses from the summary suffix', () => {
    const rows = parseCanvasIcs(loadFixtureText('feed.ics'), ours);
    expect(rows.map((r) => [r.kind, r.externalId, r.courseId])).toEqual([
      ['assignment', 'assignment:7775093', 'cmsc422'],
      ['assignment', 'assignment:7781449', 'ling260'],
      ['event', 'event:9001', 'cmsc422'],
      ['event', 'event:9002', 'stat410'],
    ]);
    expect(rows[0]!.title).toBe('HW01: Warm up');
    expect(rows[0]!.dueAt).toBe('2026-09-08T03:59:59.000Z');
    expect(rows[2]!.endsAt).toBe('2026-10-01T23:30:00.000Z');
    expect(rows[3]!.allDay).toBe(true);
    expect(rows.every((r) => r.status === 'open')).toBe(true);
  });
});
