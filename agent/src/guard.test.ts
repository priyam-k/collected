import { describe, expect, it } from 'vitest';
import { assertSecureUrl, badTarget, isPrivateHost, unsafePattern } from './guard.js';

describe('guard', () => {
  it('accepts only the course targets, spelled the way the server allows', () => {
    const allowed = ['slides', 'hw-1', 'unsorted', 'skip'];
    expect(badTarget('slides', allowed)).toBeNull();
    expect(badTarget('hw-1', allowed)).toBeNull();
    expect(badTarget('readings', allowed)).toMatch(/not one of this course's targets/);
    expect(badTarget('../slides', allowed)).toMatch(/not a valid name/);
    expect(badTarget('/Users/me/Library/LaunchAgents', allowed)).toMatch(/not a valid name/);
    expect(badTarget('Slides', allowed)).toMatch(/not a valid name/);
    expect(badTarget('', allowed)).toMatch(/not a valid name/);
  });

  it('allows https anywhere and http only to this machine', () => {
    expect(assertSecureUrl('https://collected.example.com', 'server').hostname).toBe('collected.example.com');
    expect(assertSecureUrl('http://localhost:3000', 'server').port).toBe('3000');
    expect(assertSecureUrl('http://127.0.0.1:3000/', 'server').hostname).toBe('127.0.0.1');
    expect(assertSecureUrl('http://[::1]:3000', 'server').hostname).toBe('[::1]');
    expect(() => assertSecureUrl('http://collected.example.com', 'server')).toThrow(/must be https/);
    expect(() => assertSecureUrl('http://192.168.1.5:3000', 'the server URL')).toThrow(/the server URL must be https/);
    expect(() => assertSecureUrl('ftp://x', 'server')).toThrow(/must be https/);
    expect(() => assertSecureUrl('not a url', 'model.baseUrl')).toThrow(/not a URL/);
  });

  it('knows a private host when it sees one', () => {
    for (const h of ['localhost', 'foo.localhost', 'printer.local', '127.0.0.1', '127.9.9.9', '0.0.0.0', '10.0.0.5', '172.16.0.1', '172.31.255.254', '192.168.1.1', '169.254.169.254', '::1', '[::1]', 'fe80::1', 'fc00::1', 'fd12::1', '::ffff:10.0.0.1']) {
      expect(isPrivateHost(h), h).toBe(true);
    }
    for (const h of ['umd.instructure.com', 'inst-fs-iad-prod.inscloudgate.net', '8.8.8.8', '172.32.0.1', '172.15.0.1', '192.169.0.1', '2606:4700::1111', 'notlocal.com']) {
      expect(isPrivateHost(h), h).toBe(false);
    }
  });

  it('refuses long and nested-quantifier patterns, keeps ordinary ones', () => {
    expect(unsafePattern(null)).toBeNull();
    expect(unsafePattern('^/Lecture Notes')).toBeNull();
    expect(unsafePattern('\\.(zip|py)$')).toBeNull();
    expect(unsafePattern('(hw|project)\\s*\\d+')).toBeNull();
    expect(unsafePattern('(a|b)+')).toBeNull(); // a quantified group with no quantifier inside is fine
    expect(unsafePattern('\\(x+\\)+')).toBeNull(); // escaped parens are literals
    expect(unsafePattern('(a+)+')).toMatch(/nested quantifier/);
    expect(unsafePattern('(x*)*$')).toMatch(/nested quantifier/);
    expect(unsafePattern('^(\\w+\\s?){2,}$')).toMatch(/nested quantifier/);
    expect(unsafePattern('((a+)b)+')).toMatch(/nested quantifier/);
    expect(unsafePattern('a'.repeat(201))).toMatch(/longer than 200/);
  });
});
