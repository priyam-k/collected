import { describe, expect, it } from 'vitest';
import { allowedSources, scopeDenial } from './scopes.js';

describe('scopeDenial', () => {
  const jobsRead = { jobs: 'read' } as const;
  const jobsWrite = { jobs: 'write' } as const;
  const calendarWrite = { calendar: 'write' } as const;

  it('an unrestricted token passes everything', () => {
    expect(scopeDenial(null, 'DELETE', '/api/jobs/manual:x')).toBeNull();
    expect(scopeDenial(undefined, 'POST', '/api/sources/sync')).toBeNull();
  });

  it('reads need read, writes need write, in the route\'s area', () => {
    expect(scopeDenial(jobsRead, 'GET', '/api/jobs?query=x')).toBeNull();
    expect(scopeDenial(jobsRead, 'GET', '/api/jobs/stages')).toBeNull();
    expect(scopeDenial(jobsRead, 'POST', '/api/jobs')).toBe('this token has no write access to jobs');
    expect(scopeDenial(jobsRead, 'PATCH', '/api/jobs/x/state')).toMatch(/write access to jobs/);
    expect(scopeDenial(jobsWrite, 'PATCH', '/api/jobs/x/state')).toBeNull();
    expect(scopeDenial(jobsWrite, 'GET', '/api/courses')).toBe('this token has no read access to courses');
    expect(scopeDenial(jobsWrite, 'GET', '/api/grades')).toMatch(/courses/);
    expect(scopeDenial(jobsWrite, 'GET', '/api/canvas/raw?path=x')).toMatch(/courses/);
    expect(scopeDenial(jobsWrite, 'GET', '/api/todo/status')).toMatch(/tasks/);
    expect(scopeDenial(calendarWrite, 'POST', '/api/calendar/events')).toBeNull();
    expect(scopeDenial(calendarWrite, 'POST', '/api/todoist/tasks/quick')).toMatch(/write access to tasks/);
  });

  it('health, me and versions are open to every token', () => {
    expect(scopeDenial(jobsRead, 'GET', '/api/auth/me')).toBeNull();
    expect(scopeDenial(jobsRead, 'GET', '/api/health')).toBeNull();
    expect(scopeDenial(jobsRead, 'GET', '/api/system/version')).toBeNull();
  });

  it('sources: status for anyone with a read, a sync per area, everything only with every write', () => {
    expect(scopeDenial(jobsRead, 'GET', '/api/sources')).toBeNull();
    expect(scopeDenial(jobsRead, 'GET', '/api/sources/canvas')).toBeNull();
    expect(scopeDenial(jobsRead, 'GET', '/api/sources/canvas/summary')).toBeNull();
    expect(scopeDenial(jobsWrite, 'POST', '/api/sources/jobs/sync')).toBeNull();
    expect(scopeDenial(jobsWrite, 'POST', '/api/sources/canvas/sync')).toMatch(/write access to courses/);
    expect(scopeDenial(jobsWrite, 'POST', '/api/sources/sync')).toMatch(/cannot sync everything/);
    expect(scopeDenial({ courses: 'write', jobs: 'write', calendar: 'write', tasks: 'write' }, 'POST', '/api/sources/sync')).toBeNull();
    expect(scopeDenial(jobsWrite, 'PUT', '/api/sources/canvas/config')).toMatch(/courses/);
  });

  it('agenda rows: readable with any read, written only as coursework', () => {
    expect(scopeDenial(calendarWrite, 'GET', '/api/items?from=a&to=b')).toBeNull();
    expect(scopeDenial(calendarWrite, 'POST', '/api/items/x/override')).toMatch(/write access to courses/);
    expect(scopeDenial({ courses: 'write' }, 'POST', '/api/items/manual')).toBeNull();
    expect(allowedSources(calendarWrite)).toEqual(['gcal', 'gcal_ical']);
    expect(allowedSources({ courses: 'read', tasks: 'read' })).toEqual(['canvas', 'canvas_ical', 'gradescope', 'todoist', 'gtasks', 'manual']);
    expect(allowedSources(null)).toBeNull();
  });

  it('a push preview is a read', () => {
    expect(scopeDenial({ tasks: 'read' }, 'POST', '/api/todoist/push?dryRun=1')).toBeNull();
    expect(scopeDenial({ tasks: 'read' }, 'POST', '/api/gtasks/push?dryRun=0')).toMatch(/write access to tasks/);
  });

  it('a route in no area is closed to a scoped token', () => {
    expect(scopeDenial(jobsWrite, 'GET', '/api/settings/jobs.stages')).toMatch(/not in any of its areas/);
    expect(scopeDenial({ courses: 'write', jobs: 'write', calendar: 'write', tasks: 'write' }, 'GET', '/api/settings/x')).toMatch(/not in any/);
    expect(scopeDenial(jobsWrite, 'GET', '/api/whatever')).toMatch(/not in any/);
  });
});
