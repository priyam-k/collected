import { describe, expect, it } from 'vitest';
import { dueToIso, taskToRow } from './ingest.js';

describe('todoist due parsing', () => {
  it('handles every shape Todoist sends without throwing', () => {
    expect(dueToIso(null)).toEqual({ dueAt: null, allDay: false });
    expect(dueToIso({ date: '2026-09-07' })).toEqual({ dueAt: new Date('2026-09-07T23:59:00').toISOString(), allDay: true });
    expect(dueToIso({ date: '2026-09-07T18:00:00' }).allDay).toBe(false);
    expect(dueToIso({ date: '2026-09-07T18:00:00', timezone: 'America/New_York' }).dueAt).toBe('2026-09-07T22:00:00.000Z');
    expect(dueToIso({ date: '2026-09-07', datetime: '2026-09-07T22:00:00Z' }).dueAt).toBe('2026-09-07T22:00:00.000Z');
    expect(dueToIso({ date: 'garbage' })).toEqual({ dueAt: null, allDay: false });
  });

  it('maps a task and recognises mirrors', () => {
    const row = taskToRow(
      { id: 't1', content: 'Read ch. 1', description: 'https://x\n\ncollected:canvas:assignment:1', project_id: 'p1', labels: ['homework'], due: { date: '2026-09-08T23:00:00' }, checked: false },
      { projects: new Map([['p1', { id: 'p1', name: 'School' }]]), sections: new Map() },
    );
    expect(row.id).toBe('todoist:t1');
    expect((row.raw as { mirror: boolean; mirrorOf: string }).mirror).toBe(true);
    expect((row.raw as { mirrorOf: string }).mirrorOf).toBe('canvas:assignment:1');
    expect((row.raw as { projectName: string }).projectName).toBe('School');
    expect(row.status).toBe('open');
  });
});
