import { describe, expect, it } from 'vitest';
import type { CourseRow } from '../../db/schema.js';
import { loadFixture } from './fixture-client.js';
import {
  assignmentToRow,
  enrollmentRole,
  filesToContent,
  matchCourses,
  modulesToContent,
  plannerToRow,
  stripHtml,
  termLabel,
  type CanvasAssignment,
  type CanvasCourse,
  type CanvasFile,
  type CanvasModule,
  type PlannerItem,
} from './map.js';

const course = (over: Partial<CourseRow>): CourseRow =>
  ({
    id: 'x',
    term: '2026-fall',
    code: 'CMSC422',
    section: '0101',
    name: null,
    role: 'student',
    canvasCourseId: null,
    gradescopeCourseId: null,
    submitsVia: 'both',
    color: null,
    links: [],
    schedule: {},
    notes: null,
    archived: false,
    createdAt: '',
    updatedAt: '',
    ...over,
  }) as CourseRow;

describe('termLabel', () => {
  it('maps slugs to Canvas term names', () => {
    expect(termLabel('2026-fall')).toBe('Fall 2026');
    expect(termLabel('2027-spring')).toBe('Spring 2027');
    expect(termLabel('Fall 2026')).toBe('Fall 2026');
  });
});

describe('matchCourses', () => {
  const canvas = loadFixture<CanvasCourse[]>('courses.json');

  it('matches by code + term and auto-fills ids', () => {
    const ours = [course({ id: 'cmsc422', code: 'CMSC422' }), course({ id: 'math423', code: 'MATH423', section: '0301' })];
    const { matched, autoFilled } = matchCourses(ours, canvas);
    expect(matched.get('cmsc422')?.id).toBe(1408462);
    expect(matched.get('math423')?.id).toBe(1410485);
    expect(autoFilled.map((a) => a.canvasCourseId).sort()).toEqual(['1408462', '1410485']);
  });

  it('disambiguates the two CMSC330 shells by term and role', () => {
    const ours = [course({ id: 'cmsc330-ta', code: 'CMSC330', role: 'ta' })];
    const { matched } = matchCourses(ours, canvas);
    expect(matched.get('cmsc330-ta')?.id).toBe(1408293);
    expect(enrollmentRole(matched.get('cmsc330-ta')!)).toBe('ta');
  });

  it('honours an explicit canvasCourseId and leaves unknown explicit ids alone', () => {
    const ours = [course({ id: 'a', code: 'ZZZ999', canvasCourseId: '1412264' }), course({ id: 'b', code: 'CMSC422', canvasCourseId: '1' })];
    const { matched, autoFilled } = matchCourses(ours, canvas);
    expect(matched.get('a')).toBeUndefined(); // 1412264 not in fixture list
    expect(matched.get('b')).toBeUndefined();
    expect(autoFilled).toEqual([]);
  });

  it('does not match a course from another term', () => {
    const ours = [course({ id: 'old', code: 'CMSC330', term: '2026-spring', role: 'student' })];
    expect(matchCourses(ours, canvas).matched.get('old')?.id).toBe(1398424);
    const none = [course({ id: 'none', code: 'CMSC330', term: '2025-fall' })];
    expect(matchCourses(none, canvas).matched.size).toBe(0);
  });
});

describe('assignmentToRow', () => {
  const asg = loadFixture<CanvasAssignment[]>('assignments.json');
  const cc = { courseId: 'cmsc422', role: 'student' as const };

  it('maps submission states to item statuses', () => {
    const rows = asg.map((a) => assignmentToRow(a, cc, 'https://umd.instructure.com'));
    expect(rows.map((r) => r.status)).toEqual(['open', 'graded', 'late', 'open']);
    expect(rows[1]!.score).toBe(95);
    expect(rows[0]!.externalId).toBe('assignment:7775093');
    expect(rows[0]!.dueAt).toBe('2026-09-08T03:59:59.000Z');
    expect(rows[0]!.description).toMatch(/warm up exercise/);
  });

  it('keeps TA-course assignments informational', () => {
    const row = assignmentToRow(asg[1]!, { courseId: 'cmsc330', role: 'ta' }, 'https://umd.instructure.com');
    expect(row.status).toBe('open');
    expect((row.raw as { ta: boolean }).ta).toBe(true);
  });
});

describe('plannerToRow', () => {
  const planner = loadFixture<PlannerItem[]>('planner-items.json');
  const cc = { courseId: 'c', role: 'student' as const };
  const base = 'https://umd.instructure.com';

  it('maps assignments, quizzes, announcements, events and drops bare discussions', () => {
    const kinds = planner.map((p) => plannerToRow(p, cc, base)?.kind ?? null);
    expect(kinds).toEqual(['announcement', 'assignment', null, 'assignment', 'announcement', 'assignment', 'assignment', 'assignment', 'assignment', 'event']);
  });

  it('derives status from submissions and planner overrides', () => {
    const byTitle = Object.fromEntries(planner.map((p) => [p.plannable.title, plannerToRow(p, cc, base)]));
    expect(byTitle['Syllabus Agreement']!.status).toBe('graded');
    expect(byTitle['8/31 In Class']!.status).toBe('late');
    expect(byTitle['Read Plato\'s Meno']!.status).toBe('missing');
    expect(byTitle['Homework 1: Discussion post "Introductions"']!.status).toBe('done'); // marked complete
    expect(byTitle['HW01: Warm up']!.externalId).toBe('assignment:7775093'); // quiz → its assignment id
    expect(byTitle['HW01: Warm up']!.status).toBe('open');
  });

  it('makes relative urls absolute and keeps event times', () => {
    const ev = plannerToRow(planner.at(-1)!, cc, base)!;
    expect(ev.url).toBe('https://umd.instructure.com/calendar?event_id=9001&include_contexts=course_1408462');
    expect(ev.startsAt).toBe('2026-10-01T22:00:00.000Z');
    expect(ev.endsAt).toBe('2026-10-01T23:30:00.000Z');
  });
});

describe('course content', () => {
  it('flattens modules, skipping subheaders and unpublished items', () => {
    const rows = modulesToContent(loadFixture<CanvasModule[]>('modules.json'), 'cmsc422', 'https://umd.instructure.com');
    expect(rows.map((r) => r.title)).toEqual(['lecture01_intro.pdf', 'Course textbook (CIML)', 'HW01: Warm up', 'DecisionTreesNotes.pdf']);
    expect(rows[1]!.url).toBe('https://umd.instructure.com/courses/1408462/modules/items/30003');
    expect(rows[0]!.moduleName).toMatch(/Week 1/);
    expect(rows[3]!.position).toBeGreaterThan(rows[2]!.position!);
  });

  it('drops hidden files', () => {
    const rows = filesToContent(loadFixture<CanvasFile[]>('files.json'), 'cmsc422');
    expect(rows.map((r) => r.title)).toEqual(['lecture03_knn.pdf', 'DecisionTreesNotes.pdf', 'decisionTreeCode.zip']);
  });

  it('strips html', () => {
    expect(stripHtml('<p>Hi <b>there</b>&amp; friends</p><ul><li>a</li><li>b</li></ul>')).toBe('Hi there& friends\na\nb');
  });
});
