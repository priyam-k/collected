import { readFileSync } from 'node:fs';
import path from 'node:path';
import { CookieJar } from 'tough-cookie';
import pino from 'pino';
import { CanvasClient } from './client.js';

const here = path.resolve(import.meta.dirname, 'fixtures');
export const loadFixture = <T>(name: string): T => JSON.parse(readFileSync(path.join(here, name), 'utf8')) as T;
export const loadFixtureText = (name: string): string => readFileSync(path.join(here, name), 'utf8');

/**
 * A CanvasClient whose fetch answers from fixtures. Used by tests and by `cli demo canvas`
 * so the class widgets can be developed without a live session.
 */
export function fixtureCanvasClient(baseUrl = 'https://umd.instructure.com'): CanvasClient {
  const routes: Array<[RegExp, () => unknown]> = [
    [/\/api\/v1\/courses\?/, () => loadFixture('courses.json')],
    [/\/api\/v1\/courses\/1408462\/assignments/, () => loadFixture('assignments.json')],
    [/\/api\/v1\/courses\/\d+\/assignments/, () => []],
    [/\/api\/v1\/planner\/items/, () => loadFixture('planner-items.json')],
    [/\/api\/v1\/announcements/, () => loadFixture('announcements.json')],
    [
      /\/api\/v1\/courses\/1408462\?/,
      () => ({
        id: 1408462,
        syllabus_body:
          '<h2>CMSC422</h2><p>Grading: 50% homework, 50% exams. Contact: prof@umd.edu</p><p><a class="instructure_file_link" href="https://umd.instructure.com/courses/1408462/files/99000001?wrap=1" data-api-endpoint="https://umd.instructure.com/api/v1/courses/1408462/files/99000001">syllabus.pdf</a> <a href="/courses/1408462/files/99000002/download">locked.pdf</a></p>',
      }),
    ],
    [/\/api\/v1\/courses\/\d+\?/, () => ({ syllabus_body: null })],
    [/\/api\/v1\/courses\/1408462\/modules/, () => loadFixture('modules.json')],
    [/\/api\/v1\/courses\/\d+\/modules/, () => []],
    // Linked from the syllabus, in a hidden folder: not in the listing, reachable by id. 99000002 answers 404 (no route).
    [/\/api\/v1\/courses\/1408462\/files\/99000001/, () => ({ id: 99000001, display_name: 'syllabus.pdf', filename: 'syllabus.pdf', 'content-type': 'application/pdf', size: 88000, updated_at: '2026-08-28T12:00:00Z', hidden_for_user: true, locked_for_user: false, folder_id: 5559 })],
    [/\/files\/9900000\d/, () => null],
    [/\/api\/v1\/courses\/1408462\/files/, () => loadFixture('files.json')],
    [/\/api\/v1\/courses\/\d+\/files/, () => []],
    [/\/api\/v1\/courses\/1408462\/folders/, () => loadFixture('folders.json')],
    [/\/api\/v1\/courses\/\d+\/folders/, () => []],
    [/\/api\/v1\/courses\/1408462\/assignment_groups/, () => loadFixture('assignment_groups.json')],
    [/\/api\/v1\/courses\/\d+\/assignment_groups/, () => []],
  ];
  const fakeFetch: typeof fetch = async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const hit = routes.find(([re]) => re.test(url));
    const res = hit
      ? new Response(`while(1);${JSON.stringify(hit[1]())}`, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } })
      : new Response('{"errors":[{"message":"not found"}]}', { status: 404, headers: { 'content-type': 'application/json' } });
    Object.defineProperty(res, 'url', { value: url });
    return res;
  };
  return new CanvasClient(baseUrl, new CookieJar(), pino({ level: 'silent' }), fakeFetch);
}
