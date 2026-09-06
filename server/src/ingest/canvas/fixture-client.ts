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
    [/\/api\/v1\/courses\/1408462\?/, () => ({ id: 1408462, syllabus_body: '<h2>CMSC422</h2><p>Grading: 50% homework, 50% exams. Contact: prof@umd.edu</p>' })],
    [/\/api\/v1\/courses\/\d+\?/, () => ({ syllabus_body: null })],
    [/\/api\/v1\/courses\/1408462\/modules/, () => loadFixture('modules.json')],
    [/\/api\/v1\/courses\/\d+\/modules/, () => []],
    [/\/api\/v1\/courses\/1408462\/files/, () => loadFixture('files.json')],
    [/\/api\/v1\/courses\/\d+\/files/, () => []],
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
