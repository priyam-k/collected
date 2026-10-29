import { describe, expect, it } from 'vitest';
import { loadGsFixture } from './fixture-client.js';
import { gsTimeToIso, parseAccount, parseInstructorAssignments, parseStudentCourse, wallClockToIso } from './parse.js';

describe('gradescope parsers', () => {
  it('parses the account page into courses with role and term', () => {
    const courses = parseAccount(loadGsFixture('account.html'));
    expect(courses.map((c) => [c.id, c.shortname, c.term, c.role])).toEqual([
      ['3001001', 'CMSC 330', 'Fall 2026', 'ta'],
      ['3001002', 'CMSC 422', 'Fall 2026', 'student'],
      ['3001003', 'MATH423', 'Fall 2026', 'student'],
      ['3001004', 'CMSC330', 'Spring 2026', 'student'],
      ['3001005', 'CMSC351', 'Spring 2026', 'student'],
    ]);
    expect(courses[1]!.name).toBe('Introduction to Machine Learning');
  });

  it('parses the student table: ids from links or submit buttons, status, score, dates, late due', () => {
    const rows = parseStudentCourse(loadGsFixture('student-course.html'));
    expect(rows.map((r) => [r.id, r.title, r.status])).toEqual([
      ['8499802', 'PS1', 'no_submission'],
      ['8499810', 'HW02: Decision Trees', 'graded'],
      ['8499820', 'Quiz 1', 'late'],
      ['8499830', 'Reading response 1', 'no_submission'],
    ]);
    expect(rows[0]!.dueAt).toBe('2026-09-19T03:59:00.000Z'); // 23:59 EDT
    expect(rows[0]!.lateDueAt).toBe('2026-09-20T03:59:00.000Z');
    expect(rows[0]!.releaseAt).toBe('2026-09-02T19:30:00.000Z');
    expect(rows[1]!.score).toBe(95);
    expect(rows[1]!.points).toBe(100);
    expect(rows[1]!.url).toBe('/courses/3001002/assignments/8499810/submissions/312000001');
    expect(rows[0]!.url).toBeNull();
  });

  it('parses instructor assignments from the embedded React props', () => {
    const { assignments, timezone } = parseInstructorAssignments(loadGsFixture('instructor-assignments.html'));
    expect(timezone).toBe('America/New_York');
    expect(assignments.map((a) => [a.id, a.title, a.gradingProgress, a.numActiveSubmissions])).toEqual([
      ['8502830', 'P1', 100, 2],
      ['8502840', 'Quiz 1', 35, 140],
    ]);
    expect(assignments[0]!.dueAt).toBe('2026-09-15T03:59:00.000Z');
    expect(assignments[0]!.hardDueAt).toBe('2026-09-16T03:59:00.000Z');
    expect(assignments[1]!.hardDueAt).toBeNull();
    expect(assignments[1]!.openRegradeRequests).toBe(3);
  });

  it('converts time formats', () => {
    expect(gsTimeToIso('2026-09-18 23:59:00 -0400')).toBe('2026-09-19T03:59:00.000Z');
    expect(wallClockToIso('2026-01-15T09:00', 'America/New_York')).toBe('2026-01-15T14:00:00.000Z'); // EST
    expect(wallClockToIso('2026-07-15T09:00', 'America/New_York')).toBe('2026-07-15T13:00:00.000Z'); // EDT
    expect(wallClockToIso(null, 'America/New_York')).toBeNull();
  });
});
