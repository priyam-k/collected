import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { DEFAULT_JOB_STAGES } from '@collected/shared';
import { ApiError, type Api } from './api.js';
import { TOOLS, buildServer, callTool } from './mcp.js';

const COURSES = [{ id: '2026-fall-enme480-0102', code: 'ENME480', name: 'Robotics', role: 'student', term: '2026-fall', schedule: {}, links: [], notes: '', hidden: false, canvasCourseId: '1', color: null }];

function fakeApi(gets: Record<string, unknown> = {}) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const api = {
    get: async (path: string) => {
      calls.push({ method: 'GET', path });
      if (path === '/api/courses') return COURSES;
      const hit = Object.keys(gets).find((k) => path.startsWith(k));
      if (!hit) throw new ApiError(`unexpected GET ${path}`, 404);
      return gets[hit];
    },
    send: async (method: string, path: string, body?: unknown) => {
      calls.push({ method, path, body });
      if (path === '/api/jobs' && method === 'POST') throw new ApiError('this token has no write access to jobs', 403, { error: 'this token has no write access to jobs' });
      if (path.startsWith('/api/jobs/') && method === 'PATCH') return { id: 'manual:1', company: 'Beta', title: 'Intern', state: (body as { state: string }).state };
      return { ok: true };
    },
  } as unknown as Api;
  return { api, calls };
}

const deps = (api: Api) => ({ api, version: '0.0.0-test' });
const spec = (name: string) => TOOLS.find((t) => t.name === name)!;

describe('mcp tools', () => {
  it('names are unique and every tool maps to argv the CLI parses', () => {
    expect(new Set(TOOLS.map((t) => t.name)).size).toBe(TOOLS.length);
    expect(spec('assignments').argv({ course: '480', days: 7, all: true })).toEqual(['--course', '480', '--days', '7', '--all']);
    expect(spec('assignments').argv({})).toEqual([]);
    expect(spec('jobs_search').argv({ query: 'software intern', tracked: true })).toEqual(['search', 'software intern', '--tracked']);
    expect(spec('jobs_set').argv({ id: 'manual:1', state: 'oa', notes: 'HackerRank by Fri' })).toEqual(['set', 'manual:1', 'oa', '--notes', 'HackerRank by Fri']);
    expect(spec('jobs_set').argv({ id: 'manual:1', nextAt: '2026-11-10' })).toEqual(['set', 'manual:1', '--next-at', '2026-11-10']);
    expect(spec('jobs_add').argv({ company: 'Beta', title: 'Intern', force: false })).toEqual(['add', 'Beta', 'Intern']);
    expect(spec('schedule_set').argv({ course: 'enme480', kind: 'lecture', meetings: ['mon,wed 14:00-14:50 @ CHE 2110'] })).toEqual(['set', 'enme480', 'lecture', 'mon,wed 14:00-14:50 @ CHE 2110']);
    expect(spec('event_add').argv({ title: 'Dentist', at: 'fri 17:00', for: '30m' })).toEqual(['add', 'Dentist', '--at', 'fri 17:00', '--for', '30m']);
    expect(spec('canvas_show').argv({ course: '480', kind: 'syllabus' })).toEqual(['show', '480', 'syllabus']);
    expect(spec('resync').argv({})).toEqual([]);
  });

  it('reads are read-only, jobs_rm is the one destructive tool', () => {
    const readOnly = TOOLS.filter((t) => t.readOnly).map((t) => t.name);
    expect(readOnly).toEqual(expect.arrayContaining(['courses', 'agenda', 'grades', 'jobs_search', 'canvas_get', 'event_calendars']));
    expect(readOnly).not.toEqual(expect.arrayContaining(['jobs_set', 'task_add', 'resync']));
    expect(TOOLS.filter((t) => t.destructive).map((t) => t.name)).toEqual(['jobs_rm']);
  });

  it('runs a command with --json and returns the server\'s refusal as an error, not a throw', async () => {
    const f = fakeApi({ '/api/jobs/stages': DEFAULT_JOB_STAGES, '/api/jobs/manual%3A1': { id: 'manual:1', company: 'Beta', title: 'Intern', state: 'applied', notes: '', url: null } });
    const ok = await callTool(deps(f.api), spec('courses'), {});
    expect(ok.isError).toBeUndefined();
    expect(JSON.parse(ok.text)).toHaveLength(1);
    const moved = await callTool(deps(f.api), spec('jobs_set'), { id: 'manual:1', state: 'oa' });
    expect(moved.isError).toBeUndefined();
    const denied = await callTool(deps(f.api), spec('jobs_add'), { company: 'Beta', title: 'Intern' });
    expect(denied.isError).toBe(true);
    expect(denied.text).toContain('no write access to jobs');
    await expect(callTool(deps(f.api), spec('jobs_show'), {})).rejects.toThrow();
  });

  it('serves the tools over the protocol', async () => {
    const f = fakeApi();
    const server = buildServer(deps(f.api));
    const client = new Client({ name: 'test', version: '0' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    const listed = await client.listTools();
    expect(listed.tools.map((t) => t.name)).toEqual(TOOLS.map((t) => t.name));
    expect(listed.tools.find((t) => t.name === 'courses')?.annotations?.readOnlyHint).toBe(true);
    const r = (await client.callTool({ name: 'courses', arguments: {} })) as { content: { type: string; text: string }[]; isError?: boolean };
    expect(r.isError).toBeFalsy();
    expect(JSON.parse(r.content[0]!.text)[0].code).toBe('ENME480');
    const bad = (await client.callTool({ name: 'jobs_add', arguments: { company: 'Beta', title: 'Intern' } })) as { content: { text: string }[]; isError?: boolean };
    expect(bad.isError).toBe(true);
    expect(bad.content[0]!.text).toContain('no write access to jobs');
    const res = await client.readResource({ uri: 'collected://help' });
    expect((res.contents[0] as { text: string }).text).toContain('collected:');
    await client.close();
  });
});
