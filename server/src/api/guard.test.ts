import { describe, expect, it } from 'vitest';
import { canvasApiPath } from './canvas.js';
import { crossSite, identityAllows } from './index.js';
import { isAllowedOutboundUrl, isPrivateHost } from '../lib/http.js';

describe('identityAllows', () => {
  it('lets a person do anything and the helper key do one thing', () => {
    expect(identityAllows('me@example.com', 'DELETE', '/api/courses/x')).toBe(true);
    expect(identityAllows('me@example.com', 'POST', '/api/import')).toBe(true);
    expect(identityAllows('helper', 'POST', '/api/sources/canvas/cookie')).toBe(true);
    expect(identityAllows('helper', 'GET', '/api/items')).toBe(false);
    expect(identityAllows('helper', 'GET', '/api/export')).toBe(false);
  });

  it('keeps a service token to what the CLI needs', () => {
    const svc = 'service:macbook-air';
    for (const [m, p] of [
      ['GET', '/api/items'],
      ['GET', '/api/file-sync/manifest'],
      ['POST', '/api/file-sync/report'],
      ['GET', '/api/canvas/raw'],
      ['GET', '/api/canvas/files/1/open'],
      ['PUT', '/api/courses/x'],
      ['POST', '/api/items/x/override'],
      ['POST', '/api/todoist/tasks/quick'],
      ['POST', '/api/gtasks/tasks/quick'],
      ['POST', '/api/gtasks/tasks/L1:T1/close'],
      ['POST', '/api/todoist/push?dryRun=1'],
      ['POST', '/api/gtasks/push?dryRun=1&force=1'],
      ['GET', '/api/todoist/config'],
      ['GET', '/api/gtasks/config'],
      ['GET', '/api/todo/status'],
      ['POST', '/api/sources/canvas/sync'],
      ['PATCH', '/api/jobs/x/state'],
    ] as const)
      expect(identityAllows(svc, m, p), `${m} ${p}`).toBe(true);
    for (const [m, p] of [
      ['GET', '/api/export'],
      ['POST', '/api/import'],
      ['DELETE', '/api/demo'],
      ['DELETE', '/api/courses/x'],
      ['PUT', '/api/sources/gradescope/config'],
      ['DELETE', '/api/sources/gradescope/config'],
      ['PATCH', '/api/sources/jobs/meta'],
      ['PUT', '/api/settings/jobs.filter'],
      ['PUT', '/api/layout'],
      ['GET', '/api/google/start'],
      ['GET', '/api/todoist/connect'],
      ['POST', '/api/todoist/disconnect'],
      ['GET', '/api/google/start?source=gtasks'],
      ['PUT', '/api/settings/todo.defaultApp'],
      ['POST', '/api/todoist/push'],
      ['POST', '/api/todoist/push?force=1'],
      ['POST', '/api/gtasks/push'],
      ['POST', '/api/gtasks/push?dryRun=0'],
      ['PUT', '/api/todoist/config'],
      ['PUT', '/api/gtasks/config'],
      ['POST', '/api/sources/canvas/cookie'],
    ] as const)
      expect(identityAllows(svc, m, p), `${m} ${p}`).toBe(false);
    expect(identityAllows(svc, 'GET', '/api/settings')).toBe(true);
  });
});

describe('crossSite', () => {
  const site = 'https://collected.example.com';
  it('passes same-origin and header-less requests, refuses everything else', () => {
    expect(crossSite({}, site)).toBe(false);
    expect(crossSite({ origin: site }, site)).toBe(false);
    expect(crossSite({ origin: site, secFetchSite: 'same-origin' }, site)).toBe(false);
    expect(crossSite({ origin: 'https://evil.example' }, site)).toBe(true);
    expect(crossSite({ origin: 'null' }, site)).toBe(true);
    expect(crossSite({ secFetchSite: 'cross-site' }, site)).toBe(true);
    expect(crossSite({ origin: 'not a url' }, site)).toBe(true);
    expect(crossSite({ origin: 'http://localhost:5173' }, 'http://localhost:5173')).toBe(false);
  });
});

describe('canvasApiPath', () => {
  const base = 'https://umd.instructure.com';
  it('accepts API paths with a query and normalises them', () => {
    expect(canvasApiPath('/api/v1/courses/7/pages', base)).toBe('/api/v1/courses/7/pages');
    expect(canvasApiPath('/api/v1/courses/7/pages?per_page=50&include[]=items', base)).toBe('/api/v1/courses/7/pages?per_page=50&include[]=items');
  });
  it('rejects every way out of /api/v1 on the configured host', () => {
    for (const bad of [
      '/api/v1/../../login',
      '/api/v1/%2e%2e/%2e%2e/login',
      '/api/v1/.%2e/.%2e/conversations',
      '/api/v1//courses',
      '/api/v1/courses/7/pages#x',
      '/api/v1/users/self?access_token=abc',
      '/api/v1/users/self?as_user_id=1',
      'https://evil.test/api/v1/x',
      '/login',
      'api/v1/courses',
      '/api/v1/courses/7 pages',
      '/api/v1/courses\\7',
    ])
      expect(canvasApiPath(bad, base), bad).toBeNull();
  });
});

describe('outbound URL policy', () => {
  it('knows the private ranges', () => {
    for (const h of ['localhost', 'foo.localhost', 'printer.local', 'metadata.google.internal', '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.9.9', '192.168.1.1', '169.254.169.254', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1', '100.64.0.1'])
      expect(isPrivateHost(h), h).toBe(true);
    for (const h of ['umd.instructure.com', '8.8.8.8', '172.32.0.1', '2606:4700::1111']) expect(isPrivateHost(h), h).toBe(false);
  });
  it('allows https to public hosts and http only to loopback', () => {
    expect(isAllowedOutboundUrl('https://umd.instructure.com')).toBe(true);
    expect(isAllowedOutboundUrl('http://localhost:4010/canvas')).toBe(true);
    expect(isAllowedOutboundUrl('http://umd.instructure.com')).toBe(false);
    expect(isAllowedOutboundUrl('https://169.254.169.254/computeMetadata/v1/')).toBe(false);
    expect(isAllowedOutboundUrl('https://10.0.0.5:8080')).toBe(false);
    expect(isAllowedOutboundUrl('https://user:pw@example.com')).toBe(false);
    expect(isAllowedOutboundUrl('ftp://example.com')).toBe(false);
    expect(isAllowedOutboundUrl('not a url')).toBe(false);
  });
});
