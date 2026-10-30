import { createCipheriv, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BROWSER_ORDER, decryptChromiumValue, decryptChromiumValueWindows, deriveChromiumKey, deriveLinuxChromiumKey, describeScan, firefoxDefaultProfiles, firefoxRoots, hostKeyHash, isFirefoxFamily, scanBrowser, type ScanOptions } from './browser-cookies.js';

/* Fixtures are built the way the browsers write their stores, so decryption and enumeration are exercised end to end. */

const PASSWORD = 'test-safe-storage-password';
const KEY = deriveChromiumKey(PASSWORD);
const reader = () => PASSWORD;
const HOST = 'umd.instructure.com';
/** The macOS fixture tree, whatever machine runs the tests. */
const mac = (home: string): ScanOptions => ({ home, platform: 'darwin', keychainPassword: reader });

/** Encrypt a value exactly as Chromium does on macOS; with `hostKey` set, prepend the Chrome 130+ 32-byte hash. */
function encryptChromium(plain: string, hostKey?: string): Buffer {
  const iv = Buffer.alloc(16, 0x20);
  const cipher = createCipheriv('aes-128-cbc', KEY, iv);
  const body = hostKey !== undefined ? Buffer.concat([hostKeyHash(hostKey), Buffer.from(plain)]) : Buffer.from(plain);
  return Buffer.concat([Buffer.from('v10'), cipher.update(body), cipher.final()]);
}

/** Chrome `expires_utc`: microseconds since 1601. */
const webkit = (unixMs: number): bigint => BigInt(Math.round(unixMs)) * 1000n + 11644473600000000n;
const FUTURE = webkit(Date.now() + 86_400_000 * 365);
const PAST = webkit(Date.now() - 86_400_000);

interface Row {
  host: string;
  name: string;
  enc?: Buffer;
  value?: string;
  expires?: bigint;
}

function writeChromiumStore(file: string, rows: Row[], layout: 'flat' | 'network' = 'flat'): void {
  const dir = layout === 'network' ? path.join(path.dirname(file), 'Network') : path.dirname(file);
  mkdirSync(dir, { recursive: true });
  const target = path.join(dir, 'Cookies');
  const db = new DatabaseSync(target);
  db.exec('CREATE TABLE cookies(host_key TEXT, name TEXT, encrypted_value BLOB, value TEXT, expires_utc INTEGER)');
  const stmt = db.prepare('INSERT INTO cookies(host_key,name,encrypted_value,value,expires_utc) VALUES(?,?,?,?,?)');
  for (const r of rows) stmt.run(r.host, r.name, r.enc ?? null, r.value ?? '', r.expires ?? FUTURE);
  db.close();
}

function chromeProfileDir(home: string, profile: string): string {
  return path.join(home, 'Library', 'Application Support', 'Google', 'Chrome', profile);
}

let home: string;
beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 'collected-home-'));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('decryptChromiumValue', () => {
  it('decrypts the pre-130 format (no host-key prefix)', () => {
    expect(decryptChromiumValue(encryptChromium('plain-session-value'), KEY)).toBe('plain-session-value');
  });

  it('decrypts the Chrome 130+ format and strips the 32-byte host-key hash', () => {
    expect(decryptChromiumValue(encryptChromium('abc123cookie', HOST), KEY)).toBe('abc123cookie');
  });

  it('returns null on the wrong key rather than throwing', () => {
    const wrong = deriveChromiumKey('nope');
    const out = decryptChromiumValue(encryptChromium('x', HOST), wrong);
    expect(out === null || out !== 'x').toBe(true);
  });
});

describe('scanBrowser chromium', () => {
  it('reads the session cookie from the default profile, decrypting with the injected Keychain password', () => {
    writeChromiumStore(path.join(chromeProfileDir(home, 'Default'), 'Cookies'), [
      { host: HOST, name: 'canvas_session', enc: encryptChromium('SESSIONTOKEN', HOST) },
      { host: HOST, name: '_csrf_token', enc: encryptChromium('ignore-me', HOST) },
    ]);
    const scan = scanBrowser('chrome', HOST, ['canvas_session', '_normandy_session', '_legacy_normandy_session'], mac(home));
    expect(scan.installed).toBe(true);
    expect(scan.profiles).toHaveLength(1);
    expect(scan.profiles[0]!.profile).toBe('Default');
    expect(scan.profiles[0]!.cookies).toEqual([{ name: 'canvas_session', value: 'SESSIONTOKEN' }]);
  });

  it('enumerates profiles with Default first, and reads a Network/Cookies layout', () => {
    writeChromiumStore(path.join(chromeProfileDir(home, 'Profile 1'), 'Cookies'), [{ host: HOST, name: 'canvas_session', enc: encryptChromium('P1', HOST) }]);
    writeChromiumStore(path.join(chromeProfileDir(home, 'Default'), 'placeholder'), [{ host: HOST, name: 'canvas_session', enc: encryptChromium('DEF', HOST) }], 'network');
    const scan = scanBrowser('chrome', HOST, ['canvas_session'], mac(home));
    expect(scan.profiles.map((p) => p.profile)).toEqual(['Default', 'Profile 1']);
    expect(scan.profiles[0]!.cookies[0]!.value).toBe('DEF');
    expect(scan.profiles[1]!.cookies[0]!.value).toBe('P1');
  });

  it('skips expired cookies and keeps session (expires 0) cookies', () => {
    writeChromiumStore(path.join(chromeProfileDir(home, 'Default'), 'Cookies'), [
      { host: HOST, name: '_normandy_session', enc: encryptChromium('OLD', HOST), expires: PAST },
      { host: HOST, name: 'canvas_session', enc: encryptChromium('NOW', HOST), expires: 0n },
    ]);
    const scan = scanBrowser('chrome', HOST, ['canvas_session', '_normandy_session'], mac(home));
    expect(scan.profiles[0]!.cookies).toEqual([{ name: 'canvas_session', value: 'NOW' }]);
  });

  it('matches cookies set on a parent domain', () => {
    writeChromiumStore(path.join(chromeProfileDir(home, 'Default'), 'Cookies'), [{ host: '.instructure.com', name: 'canvas_session', enc: encryptChromium('PARENT', HOST) }]);
    const scan = scanBrowser('chrome', HOST, ['canvas_session'], mac(home));
    expect(scan.profiles[0]!.cookies[0]!.value).toBe('PARENT');
  });

  it('reports installed:false when the browser is not present', () => {
    const scan = scanBrowser('brave', HOST, ['canvas_session'], mac(home));
    expect(scan).toEqual({ browser: 'brave', installed: false, profiles: [], scanned: 0 });
  });

  it('reports an error (not a throw) when the Keychain prompt is denied', () => {
    writeChromiumStore(path.join(chromeProfileDir(home, 'Default'), 'Cookies'), [{ host: HOST, name: 'canvas_session', enc: encryptChromium('X', HOST) }]);
    const deny = () => {
      throw new Error('User interaction is not allowed.');
    };
    const scan = scanBrowser('chrome', HOST, ['canvas_session'], { ...mac(home), keychainPassword: deny });
    expect(scan.installed).toBe(true);
    expect(scan.profiles).toHaveLength(0);
    expect(scan.error).toMatch(/Keychain/);
  });
});

describe('scanBrowser firefox', () => {
  function writeFirefoxStore(home2: string, profile: string, rows: { host: string; name: string; value: string; expiry?: number }[]): void {
    writeFirefoxStoreAt(path.join(home2, 'Library', 'Application Support', 'Firefox', 'Profiles', profile), rows);
  }
  function writeFirefoxStoreAt(dir: string, rows: { host: string; name: string; value: string; expiry?: number }[]): void {
    mkdirSync(dir, { recursive: true });
    const db = new DatabaseSync(path.join(dir, 'cookies.sqlite'));
    db.exec('CREATE TABLE moz_cookies(name TEXT, value TEXT, host TEXT, expiry INTEGER)');
    const stmt = db.prepare('INSERT INTO moz_cookies(name,value,host,expiry) VALUES(?,?,?,?)');
    const future = Math.round(Date.now() / 1000) + 86_400 * 365;
    for (const r of rows) stmt.run(r.name, r.value, r.host, r.expiry ?? future);
    db.close();
  }

  it('reads unencrypted values and prefers the default-release profile', () => {
    writeFirefoxStore(home, 'aaaa.default-release', [
      { host: HOST, name: 'canvas_session', value: 'FFVALUE' },
      { host: HOST, name: 'canvas_session_expired', value: 'OLD', expiry: Math.round(Date.now() / 1000) - 10 },
    ]);
    writeFirefoxStore(home, 'bbbb.other', [{ host: HOST, name: 'canvas_session', value: 'OTHER' }]);
    const scan = scanBrowser('firefox', HOST, ['canvas_session'], { home, platform: 'darwin' });
    expect(scan.installed).toBe(true);
    expect(scan.profiles[0]!.profile).toBe('aaaa.default-release');
    expect(scan.profiles[0]!.cookies).toEqual([{ name: 'canvas_session', value: 'FFVALUE' }]);
  });

  it('is read on Windows under %APPDATA%\\Mozilla\\Firefox\\Profiles, with no decryption', () => {
    const roaming = path.join(home, 'Roaming');
    writeFirefoxStoreAt(path.join(roaming, 'Mozilla', 'Firefox', 'Profiles', 'q1w2.default-release'), [{ host: HOST, name: 'canvas_session', value: 'WINFF' }]);
    const scan = scanBrowser('firefox', HOST, ['canvas_session'], { home, platform: 'win32', env: { APPDATA: roaming, LOCALAPPDATA: path.join(home, 'Local') } });
    expect(scan.installed).toBe(true);
    expect(scan.scanned).toBe(1);
    expect(scan.profiles[0]).toEqual({ profile: 'q1w2.default-release', cookies: [{ name: 'canvas_session', value: 'WINFF' }] });
    // The macOS tree is not consulted on Windows.
    expect(scanBrowser('firefox', HOST, ['canvas_session'], { home, platform: 'darwin' }).installed).toBe(false);
  });

  it('is read on Linux from ~/.mozilla/firefox and the snap sandbox, profiles directly in the root', () => {
    writeFirefoxStoreAt(path.join(home, '.mozilla', 'firefox', 'abcd.default-release'), [{ host: HOST, name: 'canvas_session', value: 'DEB' }]);
    writeFirefoxStoreAt(path.join(home, 'snap', 'firefox', 'common', '.mozilla', 'firefox', 'efgh.default'), [{ host: HOST, name: 'canvas_session', value: 'SNAP' }]);
    const scan = scanBrowser('firefox', HOST, ['canvas_session'], { home, platform: 'linux', env: {} });
    expect(scan.scanned).toBe(2);
    expect(scan.profiles.map((p) => [p.profile, p.cookies[0]!.value])).toEqual([
      ['abcd.default-release', 'DEB'],
      ['efgh.default', 'SNAP'],
    ]);
  });

  it('puts the profile profiles.ini marks as default first', () => {
    const root = path.join(home, '.mozilla', 'firefox');
    writeFirefoxStoreAt(path.join(root, 'aaaa.default-release'), [{ host: HOST, name: 'canvas_session', value: 'STALE' }]);
    writeFirefoxStoreAt(path.join(root, 'zzzz.work'), [{ host: HOST, name: 'canvas_session', value: 'CURRENT' }]);
    writeFileSync(path.join(root, 'profiles.ini'), ['[Install4F96D1932A9F858E]', 'Default=zzzz.work', 'Locked=1', '', '[Profile1]', 'Name=default-release', 'IsRelative=1', 'Path=aaaa.default-release', '', '[Profile0]', 'Name=work', 'IsRelative=1', 'Path=zzzz.work', 'Default=1', ''].join('\n'));
    expect(firefoxDefaultProfiles(path.join(root, 'profiles.ini'))).toEqual(['zzzz.work']);
    const scan = scanBrowser('firefox', HOST, ['canvas_session'], { home, platform: 'linux', env: {} });
    expect(scan.profiles[0]!.profile).toBe('zzzz.work');
    // A Windows-style relative path still names the folder.
    writeFileSync(path.join(root, 'profiles.ini'), ['[Install1]', 'Default=Profiles\\aaaa.default-release'].join('\n'));
    expect(firefoxDefaultProfiles(path.join(root, 'profiles.ini'))).toEqual(['aaaa.default-release']);
    expect(firefoxDefaultProfiles(path.join(root, 'nope.ini'))).toEqual([]);
  });
});

describe('scanBrowser chromium on Windows', () => {
  const WIN_KEY = randomBytes(32);
  /** A DPAPI blob stands in for the wrapped key: the injected unprotect maps it to WIN_KEY and nothing else. */
  const DPAPI_BLOB = Buffer.from('opaque-dpapi-bytes-for-the-test');
  const unprotect = (blob: Buffer): Buffer => {
    if (!blob.equals(DPAPI_BLOB)) throw new Error('unexpected blob');
    return Buffer.from(WIN_KEY);
  };
  /** Encrypt as Chromium on Windows does: v10 + 12-byte nonce + AES-256-GCM ciphertext + 16-byte tag. */
  function encryptWindows(plain: string, hostKey?: string, prefix = 'v10'): Buffer {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', WIN_KEY, nonce);
    const body = hostKey !== undefined ? Buffer.concat([hostKeyHash(hostKey), Buffer.from(plain)]) : Buffer.from(plain);
    const enc = Buffer.concat([cipher.update(body), cipher.final()]);
    return Buffer.concat([Buffer.from(prefix), nonce, enc, cipher.getAuthTag()]);
  }
  function winUserData(browserDir: string[]): string {
    return path.join(home, 'Local', ...browserDir);
  }
  function writeLocalState(userData: string, key: Buffer | null = DPAPI_BLOB): void {
    mkdirSync(userData, { recursive: true });
    const encrypted_key = key ? Buffer.concat([Buffer.from('DPAPI'), key]).toString('base64') : undefined;
    writeFileSync(path.join(userData, 'Local State'), JSON.stringify({ os_crypt: encrypted_key ? { encrypted_key } : {} }));
  }
  const win = (): ScanOptions => ({ home, platform: 'win32', env: { LOCALAPPDATA: path.join(home, 'Local'), APPDATA: path.join(home, 'Roaming') }, dpapiUnprotect: unprotect });

  it('decryptChromiumValueWindows handles both plaintext layouts and a wrong key', () => {
    expect(decryptChromiumValueWindows(encryptWindows('abc'), WIN_KEY)).toBe('abc');
    expect(decryptChromiumValueWindows(encryptWindows('abc', HOST), WIN_KEY)).toBe('abc');
    expect(decryptChromiumValueWindows(encryptWindows('abc', HOST), randomBytes(32))).toBeNull();
    expect(decryptChromiumValueWindows(encryptWindows('abc', HOST, 'v20'), WIN_KEY)).toBeNull();
  });

  it('reads Chrome from %LOCALAPPDATA%, unwrapping the Local State key through the injected DPAPI', () => {
    const userData = winUserData(['Google', 'Chrome', 'User Data']);
    writeLocalState(userData);
    writeChromiumStore(path.join(userData, 'Default', 'placeholder'), [{ host: HOST, name: 'canvas_session', enc: encryptWindows('WINTOKEN', HOST) }], 'network');
    const scan = scanBrowser('chrome', HOST, ['canvas_session'], win());
    expect(scan.installed).toBe(true);
    expect(scan.error).toBeUndefined();
    expect(scan.profiles).toEqual([{ profile: 'Default', cookies: [{ name: 'canvas_session', value: 'WINTOKEN' }] }]);
    // The macOS tree is empty, so the same browser is "not installed" there.
    expect(scanBrowser('chrome', HOST, ['canvas_session'], mac(home)).installed).toBe(false);
  });

  it('knows the Edge and Brave folders', () => {
    for (const [browser, dir] of [
      ['edge', ['Microsoft', 'Edge', 'User Data']],
      ['brave', ['BraveSoftware', 'Brave-Browser', 'User Data']],
    ] as const) {
      const userData = winUserData([...dir]);
      writeLocalState(userData);
      writeChromiumStore(path.join(userData, 'Default', 'Cookies'), [{ host: HOST, name: 'canvas_session', enc: encryptWindows(browser.toUpperCase(), HOST) }]);
      expect(scanBrowser(browser, HOST, ['canvas_session'], win()).profiles[0]!.cookies[0]!.value).toBe(browser.toUpperCase());
    }
    expect(scanBrowser('arc', HOST, ['canvas_session'], win()).installed).toBe(false);
  });

  it('reports app-bound (v20) cookies as a reason, not as a missing cookie', () => {
    const userData = winUserData(['Google', 'Chrome', 'User Data']);
    writeLocalState(userData);
    writeChromiumStore(path.join(userData, 'Default', 'Cookies'), [{ host: HOST, name: 'canvas_session', enc: encryptWindows('BOUND', HOST, 'v20') }]);
    const scan = scanBrowser('chrome', HOST, ['canvas_session'], win());
    expect(scan.installed).toBe(true);
    expect(scan.profiles).toHaveLength(0);
    expect(scan.error).toBe('Chrome protects its cookies with app-bound encryption on Windows; use Firefox, or paste the cookie from DevTools (Settings → Sources)');
    expect(describeScan(scan, HOST)).toMatch(/^chrome: Chrome protects/);
    // Edge says Edge.
    const edge = winUserData(['Microsoft', 'Edge', 'User Data']);
    writeLocalState(edge);
    writeChromiumStore(path.join(edge, 'Default', 'Cookies'), [{ host: HOST, name: 'canvas_session', enc: encryptWindows('BOUND', HOST, 'v20') }]);
    expect(scanBrowser('edge', HOST, ['canvas_session'], win()).error).toMatch(/^Edge protects/);
  });

  it('reports a DPAPI failure or a missing key as a reason', () => {
    const userData = winUserData(['Google', 'Chrome', 'User Data']);
    writeLocalState(userData);
    writeChromiumStore(path.join(userData, 'Default', 'Cookies'), [{ host: HOST, name: 'canvas_session', enc: encryptWindows('X', HOST) }]);
    const broken = scanBrowser('chrome', HOST, ['canvas_session'], {
      ...win(),
      dpapiUnprotect: () => {
        throw new Error('CryptUnprotectData failed');
      },
    });
    expect(broken.error).toMatch(/DPAPI.*CryptUnprotectData failed/);
    writeLocalState(userData, null);
    expect(scanBrowser('chrome', HOST, ['canvas_session'], win()).error).toMatch(/no os_crypt\.encrypted_key/);
  });
});

describe('scanBrowser chromium on Linux', () => {
  const BASIC_KEY = deriveLinuxChromiumKey();
  function encryptLinux(plain: string, key: Buffer, prefix: 'v10' | 'v11', hostKey?: string): Buffer {
    const iv = Buffer.alloc(16, 0x20);
    const cipher = createCipheriv('aes-128-cbc', key, iv);
    const body = hostKey !== undefined ? Buffer.concat([hostKeyHash(hostKey), Buffer.from(plain)]) : Buffer.from(plain);
    return Buffer.concat([Buffer.from(prefix), cipher.update(body), cipher.final()]);
  }
  const linux = (keyring?: (app: string) => string | undefined): ScanOptions => ({ home, platform: 'linux', env: {}, linuxKeyringPassword: keyring ?? (() => undefined) });

  it('derives the basic-store key with one round of peanuts, unlike macOS', () => {
    expect(BASIC_KEY.equals(deriveChromiumKey('peanuts'))).toBe(false);
    expect(BASIC_KEY).toHaveLength(16);
  });

  it('reads v10 and v11 values under ~/.config with the basic password', () => {
    const root = path.join(home, '.config', 'google-chrome');
    writeChromiumStore(path.join(root, 'Default', 'Cookies'), [
      { host: HOST, name: 'canvas_session', enc: encryptLinux('BASIC10', BASIC_KEY, 'v10', HOST) },
      { host: HOST, name: '_normandy_session', enc: encryptLinux('BASIC11', BASIC_KEY, 'v11') },
    ]);
    const scan = scanBrowser('chrome', HOST, ['canvas_session', '_normandy_session'], linux());
    expect(scan.error).toBeUndefined();
    expect(scan.profiles[0]!.cookies).toEqual([
      { name: 'canvas_session', value: 'BASIC10' },
      { name: '_normandy_session', value: 'BASIC11' },
    ]);
  });

  it('knows the chromium, brave and edge folders', () => {
    for (const [browser, dir] of [
      ['chromium', 'chromium'],
      ['brave', 'BraveSoftware/Brave-Browser'],
      ['edge', 'microsoft-edge'],
    ] as const) {
      writeChromiumStore(path.join(home, '.config', dir, 'Default', 'Cookies'), [{ host: HOST, name: 'canvas_session', enc: encryptLinux(browser, BASIC_KEY, 'v10', HOST) }]);
      expect(scanBrowser(browser, HOST, ['canvas_session'], linux()).profiles[0]!.cookies[0]!.value).toBe(browser);
    }
    expect(scanBrowser('arc', HOST, ['canvas_session'], linux()).installed).toBe(false);
  });

  it('uses the keyring password for v11 when secret-tool answers', () => {
    const ringKey = deriveLinuxChromiumKey('random-keyring-secret');
    writeChromiumStore(path.join(home, '.config', 'google-chrome', 'Default', 'Cookies'), [{ host: HOST, name: 'canvas_session', enc: encryptLinux('RING', ringKey, 'v11', HOST) }]);
    const asked: string[] = [];
    const scan = scanBrowser('chrome', HOST, ['canvas_session'], linux((app) => (asked.push(app), 'random-keyring-secret')));
    expect(asked).toEqual(['chrome']);
    expect(scan.profiles[0]!.cookies[0]!.value).toBe('RING');
  });

  it('reports a locked keyring when v11 decrypts to garbage with every password it has', () => {
    const ringKey = deriveLinuxChromiumKey('random-keyring-secret');
    writeChromiumStore(path.join(home, '.config', 'google-chrome', 'Default', 'Cookies'), [{ host: HOST, name: 'canvas_session', enc: encryptLinux('RING', ringKey, 'v11', HOST) }]);
    const scan = scanBrowser('chrome', HOST, ['canvas_session'], linux());
    expect(scan.installed).toBe(true);
    expect(scan.profiles).toHaveLength(0);
    expect(scan.error).toMatch(/locked by the desktop keyring.*paste the cookie/);
  });
});

describe('describeScan', () => {
  it('says not installed, how many profiles lacked the cookie, or the reason', () => {
    expect(describeScan({ browser: 'brave', installed: false, profiles: [], scanned: 0 }, HOST)).toBe('brave: not installed');
    expect(describeScan({ browser: 'firefox', installed: true, profiles: [], scanned: 2 }, HOST)).toBe('firefox: 2 profiles, no session cookie for umd.instructure.com');
    expect(describeScan({ browser: 'chrome', installed: true, profiles: [], scanned: 1 }, HOST)).toBe('chrome: 1 profile, no session cookie for umd.instructure.com');
    expect(describeScan({ browser: 'chrome', installed: true, profiles: [], scanned: 1, error: 'boom' }, HOST)).toBe('chrome: boom');
  });
});

describe('Firefox forks (zen, librewolf, floorp, waterfox)', () => {
  function writeStoreAt(dir: string, value: string): void {
    mkdirSync(dir, { recursive: true });
    const db = new DatabaseSync(path.join(dir, 'cookies.sqlite'));
    db.exec('CREATE TABLE moz_cookies(name TEXT, value TEXT, host TEXT, expiry INTEGER)');
    db.prepare('INSERT INTO moz_cookies(name,value,host,expiry) VALUES(?,?,?,?)').run('canvas_session', value, HOST, Math.round(Date.now() / 1000) + 86_400 * 365);
    db.close();
  }

  it('resolves each fork\'s roots per platform from its own definition, and firefox keeps its three Linux roots', () => {
    const win = { home: '/h', platform: 'win32' as const, env: { APPDATA: 'C:/Users/me/AppData/Roaming' } };
    expect(firefoxRoots({ home: '/h', platform: 'darwin' }, 'zen')).toEqual([{ ini: '/h/Library/Application Support/zen/profiles.ini', profilesDir: '/h/Library/Application Support/zen/Profiles' }]);
    expect(firefoxRoots(win, 'zen')).toEqual([{ ini: 'C:/Users/me/AppData/Roaming/zen/profiles.ini', profilesDir: 'C:/Users/me/AppData/Roaming/zen/Profiles' }]);
    expect(firefoxRoots({ home: '/h', platform: 'linux' }, 'zen')).toEqual([
      { ini: '/h/.zen/profiles.ini', profilesDir: '/h/.zen' },
      { ini: '/h/.var/app/app.zen_browser.zen/.zen/profiles.ini', profilesDir: '/h/.var/app/app.zen_browser.zen/.zen' },
    ]);
    expect(firefoxRoots({ home: '/h', platform: 'linux' }, 'firefox').map((r) => r.profilesDir)).toEqual(['/h/.mozilla/firefox', '/h/snap/firefox/common/.mozilla/firefox', '/h/.var/app/org.mozilla.firefox/.mozilla/firefox']);
    expect(firefoxRoots({ home: '/h', platform: 'darwin' }, 'librewolf')[0]!.profilesDir).toBe('/h/Library/Application Support/LibreWolf/Profiles');
    expect(firefoxRoots(win, 'librewolf')[0]!.profilesDir).toBe('C:/Users/me/AppData/Roaming/librewolf/Profiles');
    expect(firefoxRoots({ home: '/h', platform: 'linux' }, 'librewolf')[0]!.profilesDir).toBe('/h/.librewolf');
    expect(firefoxRoots({ home: '/h', platform: 'darwin' }, 'floorp')[0]!.profilesDir).toBe('/h/Library/Application Support/Floorp/Profiles');
    expect(firefoxRoots(win, 'floorp')[0]!.profilesDir).toBe('C:/Users/me/AppData/Roaming/Floorp/Profiles');
    expect(firefoxRoots({ home: '/h', platform: 'linux' }, 'floorp')[0]!.profilesDir).toBe('/h/.floorp');
    expect(firefoxRoots({ home: '/h', platform: 'darwin' }, 'waterfox')[0]!.profilesDir).toBe('/h/Library/Application Support/Waterfox/Profiles');
    expect(firefoxRoots(win, 'waterfox')[0]!.profilesDir).toBe('C:/Users/me/AppData/Roaming/Waterfox/Profiles');
    expect(firefoxRoots({ home: '/h', platform: 'linux' }, 'waterfox')[0]!.profilesDir).toBe('/h/.waterfox');
    // A Chromium browser has no Firefox roots.
    expect(firefoxRoots({ home: '/h', platform: 'darwin' }, 'chrome')).toEqual([]);
  });

  it('reads Zen on macOS under Application Support/zen/Profiles, on Windows under %APPDATA%\\zen\\Profiles, and on Linux from ~/.zen and the flatpak, in the clear', () => {
    writeStoreAt(path.join(home, 'Library', 'Application Support', 'zen', 'Profiles', 'ab12.Default (release)'), 'MACZEN');
    const mac = scanBrowser('zen', HOST, ['canvas_session'], { home, platform: 'darwin' });
    expect(mac.installed).toBe(true);
    expect(mac.profiles[0]).toEqual({ profile: 'ab12.Default (release)', cookies: [{ name: 'canvas_session', value: 'MACZEN' }] });
    // Zen's tree is not Firefox's: firefox on the same machine is "not installed".
    expect(scanBrowser('firefox', HOST, ['canvas_session'], { home, platform: 'darwin' }).installed).toBe(false);

    const roaming = path.join(home, 'Roaming');
    writeStoreAt(path.join(roaming, 'zen', 'Profiles', 'q1w2.Default (release)'), 'WINZEN');
    const win = scanBrowser('zen', HOST, ['canvas_session'], { home, platform: 'win32', env: { APPDATA: roaming, LOCALAPPDATA: path.join(home, 'Local') } });
    expect(win.scanned).toBe(1);
    expect(win.profiles[0]!.cookies[0]!.value).toBe('WINZEN');

    writeStoreAt(path.join(home, '.zen', 'abcd.Default (release)'), 'DEBZEN');
    writeStoreAt(path.join(home, '.var', 'app', 'app.zen_browser.zen', '.zen', 'efgh.flat'), 'FLATZEN');
    const linux = scanBrowser('zen', HOST, ['canvas_session'], { home, platform: 'linux', env: {} });
    expect(linux.scanned).toBe(2);
    expect(linux.profiles.map((p) => p.cookies[0]!.value)).toEqual(['DEBZEN', 'FLATZEN']);
  });

  it('tries the forks after firefox, and all of them count as the Firefox family', () => {
    expect(BROWSER_ORDER).toEqual(['chrome', 'brave', 'edge', 'arc', 'chromium', 'firefox', 'zen', 'librewolf', 'floorp', 'waterfox']);
    expect(BROWSER_ORDER.filter(isFirefoxFamily)).toEqual(['firefox', 'zen', 'librewolf', 'floorp', 'waterfox']);
    expect(describeScan(scanBrowser('librewolf', HOST, ['canvas_session'], { home, platform: 'darwin' }), HOST)).toBe('librewolf: not installed');
  });
});
