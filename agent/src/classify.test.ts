import { describe, expect, it } from 'vitest';
import { fileSyncConfigSchema, type FileSyncFile } from '@collected/shared';
import { classify, modelUnavailable } from './classify.js';

const cfg = fileSyncConfigSchema.parse({ targets: [{ name: 'slides', description: 'lecture slides' }, { name: 'hw', description: 'homework' }], skipHint: 'junk' });
const file: FileSyncFile = { courseId: 'c', fileId: '1', title: 'L03.pdf', filename: 'L03.pdf', folderPath: '/Lectures', moduleName: null, modulePosition: null, contentType: 'application/pdf', size: 1, updatedAt: null };

describe('classify over the systemone API', () => {
  it('sends the Jev request shape with a bearer key and reads choice, probabilities, confidence', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ model: 'jev-1.13.0', answers: { target: { choice: 'slides', probabilities: { slides: 0.91, hw: 0.05, skip: 0.04 }, confidence: 0.91 } } }), { status: 200 });
    }) as typeof fetch;
    const ans = await classify({ enabled: true, apiKey: 'k1' }, cfg, file, fetchImpl);
    expect(ans).toEqual({ target: 'slides', confidence: 0.91, probabilities: { slides: 0.91, hw: 0.05, skip: 0.04 } });
    expect(calls[0]!.url).toBe('https://api.typesafe.ai/v1/systemone');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer k1');
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body.model).toBe('jev-latest');
    expect(body.state).toEqual({ title: 'L03.pdf', filename: 'L03.pdf', folder: '/Lectures', type: 'application/pdf' }); // nulls dropped
    expect(body.questions.target).toMatchObject({ type: 'choice', criteria: { slides: 'lecture slides', hw: 'homework', skip: 'junk' } });
  });

  it('retries once on 429, surfaces auth errors, and works against a keyless local server', async () => {
    let n = 0;
    const flaky = (async () => (n++ === 0 ? new Response('slow down', { status: 429, headers: { 'retry-after': '0' } }) : new Response(JSON.stringify({ answers: { target: { choice: 'hw', probabilities: { hw: 0.7 } } } }), { status: 200 }))) as typeof fetch;
    const ans = await classify({ enabled: true, baseUrl: 'http://localhost:8000/' }, cfg, file, flaky);
    expect(ans).toMatchObject({ target: 'hw', confidence: 0.7 }); // confidence falls back to the chosen probability
    expect(n).toBe(2);
    const denied = (async () => new Response('{"error":"bad key"}', { status: 401 })) as typeof fetch;
    await expect(classify({ enabled: true, apiKey: 'x' }, cfg, file, denied)).rejects.toThrow(/401 \(check the API key\)/);
  });

  it('knows when it cannot run', () => {
    expect(modelUnavailable({ enabled: false })).toMatch(/turned off/);
    expect(modelUnavailable({ enabled: true })).toMatch(/API key/);
    expect(modelUnavailable({ enabled: true, apiKey: 'k' })).toBeNull();
    expect(modelUnavailable({ enabled: true, baseUrl: 'http://localhost:8000' })).toBeNull();
  });
});
