import { describe, expect, it } from 'vitest';
import { canvasFileUrl, canvasOrigin, previewKind } from './canvas';

describe('canvasOrigin', () => {
  it('takes the first instructure or canvas.* https origin', () => {
    expect(canvasOrigin([null, 'https://umd.instructure.com/files/1/download'])).toBe('https://umd.instructure.com');
    expect(canvasOrigin(['https://canvas.school.edu/courses/2'])).toBe('https://canvas.school.edu');
    expect(canvasOrigin(['https://instructure.com/x'])).toBe('https://instructure.com');
  });
  it('ignores look-alike and non-https hosts and falls back', () => {
    for (const u of ['https://evil-instructure.com/', 'https://notcanvas.example/', 'https://canvas-phish.example/', 'http://umd.instructure.com/', 'https://x.instructure.com.evil/', 'https://canvas/', 'nonsense']) {
      expect(canvasOrigin([u])).toBe('https://umd.instructure.com');
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
