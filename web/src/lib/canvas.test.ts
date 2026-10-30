import { describe, expect, it } from 'vitest';
import { canvasCookieBlocker, canvasCookieHeader, canvasCookiePaste, canvasFileUrl, canvasOrigin, normalizeCanvasBaseUrl, previewKind } from './canvas';

describe('canvasOrigin', () => {
  it('takes the first instructure or canvas.* https origin', () => {
    expect(canvasOrigin([null, 'https://umd.instructure.com/files/1/download'])).toBe('https://umd.instructure.com');
    expect(canvasOrigin(['https://canvas.school.edu/courses/2'])).toBe('https://canvas.school.edu');
    expect(canvasOrigin(['https://instructure.com/x'])).toBe('https://instructure.com');
  });
  it('ignores look-alike and non-https hosts and yields null', () => {
    for (const u of ['https://evil-instructure.com/', 'https://notcanvas.example/', 'https://canvas-phish.example/', 'http://umd.instructure.com/', 'https://x.instructure.com.evil/', 'https://canvas/', 'nonsense']) {
      expect(canvasOrigin([u])).toBeNull();
    }
  });
  it('prefers an instructure.com origin over a canvas.* one wherever it sits in the list', () => {
    expect(canvasOrigin(['https://canvas.attacker.net/x', 'https://umd.instructure.com/a'])).toBe('https://umd.instructure.com');
    expect(canvasOrigin(['https://umd.instructure.com/a', 'https://canvas.attacker.net/x'])).toBe('https://umd.instructure.com');
  });
});

describe('previewKind', () => {
  it('trusts the content type when there is one', () => {
    expect(previewKind('syllabus.pdf', 'application/pdf')).toBe('pdf');
    expect(previewKind('syllabus.pdf', 'text/html')).toBeNull();
    expect(previewKind('syllabus.pdf', 'text/html; charset=utf-8')).toBeNull();
    expect(previewKind('photo.bin', 'image/png')).toBe('image');
    expect(previewKind('notes.txt', 'application/octet-stream')).toBeNull();
  });
  it('falls back to the extension only without a content type', () => {
    expect(previewKind('syllabus.pdf', '')).toBe('pdf');
    expect(previewKind('syllabus.pdf', null)).toBe('pdf');
    expect(previewKind('photo.JPG')).toBe('image');
    expect(previewKind('notes.docx')).toBeNull();
  });
});

describe('canvasFileUrl', () => {
  it('encodes the id', () => {
    expect(canvasFileUrl(123)).toBe('/api/canvas/files/123/open');
    expect(canvasFileUrl('1/../x?y', { download: true })).toBe('/api/canvas/files/1%2F..%2Fx%3Fy/open?download=1');
  });
});

describe('normalizeCanvasBaseUrl', () => {
  it('turns a bare host, a URL with a path, or http into https://<host>', () => {
    expect(normalizeCanvasBaseUrl('umd.instructure.com')).toBe('https://umd.instructure.com');
    expect(normalizeCanvasBaseUrl('  umd.instructure.com/courses/1?x=1#y  ')).toBe('https://umd.instructure.com');
    expect(normalizeCanvasBaseUrl('http://umd.instructure.com')).toBe('https://umd.instructure.com');
    expect(normalizeCanvasBaseUrl('HTTPS://Canvas.School.EDU/')).toBe('https://canvas.school.edu');
    expect(normalizeCanvasBaseUrl('canvas.school.edu:8443/login')).toBe('https://canvas.school.edu:8443');
  });
  it('yields null when there is no host to use', () => {
    for (const s of ['', '   ', 'https://', 'umd', 'umd instructure', 'canvas.', 'https://user:pw@umd.instructure.com', 'not a url at all']) {
      expect(normalizeCanvasBaseUrl(s)).toBeNull();
    }
  });
});

describe('canvasCookieBlocker', () => {
  it('names the missing piece, address first, and clears once both are usable', () => {
    expect(canvasCookieBlocker(null, '')).toBe('Enter your Canvas address first');
    expect(canvasCookieBlocker(null, 'canvas_session=x')).toBe('Enter your Canvas address first');
    expect(canvasCookieBlocker('https://umd.instructure.com', '  ')).toBe('Paste the cookie value');
    expect(canvasCookieBlocker('https://umd.instructure.com', 'just some token text')).toBe('That is not a cookie yet');
    expect(canvasCookieBlocker('https://umd.instructure.com', 'canvas_session=abc; _csrf=1')).toBeNull();
  });
});

describe('canvasCookieHeader', () => {
  it('prefixes a bare value with the picked name, base64 padding included', () => {
    expect(canvasCookieHeader('canvas_session', '  abc123  ')).toBe('canvas_session=abc123');
    expect(canvasCookieHeader('_normandy_session', 'abc==')).toBe('_normandy_session=abc==');
    expect(canvasCookieHeader('canvas_session', ' ')).toBe('');
  });
  it('sends a paste that names its cookie as written, and says which session cookie it is', () => {
    expect(canvasCookieHeader('_normandy_session', 'canvas_session=abc')).toBe('canvas_session=abc');
    expect(canvasCookiePaste('canvas_session=abc')).toEqual({ asIs: true, name: 'canvas_session' });
    expect(canvasCookiePaste('_csrf=1; _normandy_session=x')).toEqual({ asIs: true, name: '_normandy_session' });
    expect(canvasCookiePaste('_normandy_session=x; canvas_session=y')).toEqual({ asIs: true, name: 'canvas_session' });
    expect(canvasCookiePaste('other=1')).toEqual({ asIs: true, name: null });
    expect(canvasCookiePaste('abc==')).toEqual({ asIs: false, name: null });
  });
});
