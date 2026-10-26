import { execFileSync } from 'node:child_process';
import { pbkdf2Sync, createDecipheriv, createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

/*
 * `node:sqlite` is a prefix-only builtin, and the bundler (esbuild) rewrites a static `import … from 'node:sqlite'`
 * to a bare `'sqlite'` that Node cannot resolve. Loading it through createRequire keeps the specifier intact in the
 * bundle, and keeps it lazy so CLI commands that never read a cookie store don't pull in the experimental module.
 */
type DatabaseSyncCtor = typeof import('node:sqlite').DatabaseSync;
let databaseSyncCtor: DatabaseSyncCtor | undefined;
function DatabaseSyncClass(): DatabaseSyncCtor {
  if (!databaseSyncCtor) databaseSyncCtor = (createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite')).DatabaseSync;
  return databaseSyncCtor;
}

/*
 * Read cookies for one host out of a local browser's cookie store, on macOS. Replaces the Python
 * `browser_cookie3` helper (DECISIONS 043 / the retired local/canvas_cookie.py): Chromium stores are
 * AES-128-CBC encrypted with a key derived from a Keychain password; Firefox stores values in the clear.
 * The file is copied before it is opened because the running browser holds a lock on it. Cookie *values*
 * never leave this module except through the returned structure; nothing here prints or logs a value.
 */

export type BrowserId = 'chrome' | 'chromium' | 'brave' | 'edge' | 'arc' | 'firefox';

/** Order the connect flow tries browsers in when none is named. */
export const BROWSER_ORDER: BrowserId[] = ['chrome', 'brave', 'edge', 'arc', 'chromium', 'firefox'];

export const isBrowserId = (s: string): s is BrowserId => (BROWSER_ORDER as string[]).includes(s);

/** Reads the Chromium "Safe Storage" password for a Keychain service. Injected in tests. */
export type KeychainReader = (service: string) => string;

export const defaultKeychainReader: KeychainReader = (service) =>
  execFileSync('security', ['find-generic-password', '-w', '-s', service], { encoding: 'utf8' }).trim();

export interface FoundCookie {
  name: string;
  value: string;
}

export interface ProfileScan {
  /** Profile folder name, e.g. "Default", "Profile 1", or a Firefox profile dir. */
  profile: string;
  /** The requested cookies present and unexpired in this profile (values included, never logged). */
  cookies: FoundCookie[];
}

export interface BrowserScan {
  browser: BrowserId;
  installed: boolean;
  profiles: ProfileScan[];
  /** Why nothing could be read (Keychain prompt denied, locked store); profiles is empty when set. */
  error?: string;
}

export interface ScanOptions {
  /** Override the home dir (tests point this at a fixture tree). */
  home?: string;
  keychainPassword?: KeychainReader;
}

interface ChromiumDef {
  kind: 'chromium';
  /** Path under ~/Library/Application Support that holds the profile folders. */
  support: string;
  keychainService: string;
}
interface FirefoxDef {
  kind: 'firefox';
  support: string;
}

const BROWSERS: Record<BrowserId, ChromiumDef | FirefoxDef> = {
  chrome: { kind: 'chromium', support: 'Google/Chrome', keychainService: 'Chrome Safe Storage' },
  chromium: { kind: 'chromium', support: 'Chromium', keychainService: 'Chromium Safe Storage' },
  brave: { kind: 'chromium', support: 'BraveSoftware/Brave-Browser', keychainService: 'Brave Safe Storage' },
  edge: { kind: 'chromium', support: 'Microsoft Edge', keychainService: 'Microsoft Edge Safe Storage' },
  arc: { kind: 'chromium', support: 'Arc/User Data', keychainService: 'Arc Safe Storage' },
  firefox: { kind: 'firefox', support: 'Firefox' },
};

const supportRoot = (home: string): string => path.join(home, 'Library', 'Application Support');

/** Convert a Chromium `expires_utc` (microseconds since 1601) to whether the cookie is still valid at `nowMs`. */
function chromiumLive(expiresUtc: number, nowMs: number): boolean {
  if (!expiresUtc) return true; // 0 = session cookie, no expiry
  const unixMs = expiresUtc / 1000 - 11644473600000;
  return unixMs > nowMs;
}

/** Firefox `expiry` is seconds since the Unix epoch; 0/absent means a session cookie. */
function firefoxLive(expiry: number, nowMs: number): boolean {
  if (!expiry) return true;
  return expiry * 1000 > nowMs;
}

/** A cookie's host_key matches the wanted host if it is that host or a parent/child domain of it. */
function hostMatches(hostKey: string, host: string): boolean {
  const hk = hostKey.toLowerCase().replace(/^\./, '');
  const h = host.toLowerCase();
  return hk === h || h.endsWith(`.${hk}`) || hk.endsWith(`.${h}`);
}

export const PBKDF2_ITERATIONS = 1003;
export const PBKDF2_SALT = 'saltysalt';

/** The AES key Chromium derives on macOS from its Keychain "Safe Storage" password. */
export function deriveChromiumKey(password: string): Buffer {
  return pbkdf2Sync(password, PBKDF2_SALT, PBKDF2_ITERATIONS, 16, 'sha1');
}

const isPrintable = (buf: Buffer): boolean => {
  for (const b of buf) if (b < 0x20 || b > 0x7e) return false;
  return true;
};

/**
 * Decrypt one Chromium cookie value. `v10` marks AES-128-CBC with a 16-space IV and PKCS7 padding. Chrome 130+
 * prepends a 32-byte SHA-256 of the host key to the plaintext; it is stripped when those first bytes are not
 * printable (i.e. they are the hash, not the start of the value). Returns null if it cannot be decrypted.
 */
export function decryptChromiumValue(encrypted: Buffer, key: Buffer): string | null {
  if (encrypted.length === 0) return null;
  const prefix = encrypted.subarray(0, 3).toString('latin1');
  if (prefix !== 'v10') return encrypted.toString('utf8'); // unencrypted (rare on macOS)
  const iv = Buffer.alloc(16, 0x20);
  try {
    const decipher = createDecipheriv('aes-128-cbc', key, iv);
    let plain = Buffer.concat([decipher.update(encrypted.subarray(3)), decipher.final()]);
    if (plain.length >= 32 && !isPrintable(plain.subarray(0, 32))) plain = plain.subarray(32);
    return plain.toString('utf8');
  } catch {
    return null;
  }
}

/** The SHA-256 of a host key, as Chrome 130+ prepends it. Exported so tests can build fixtures the same way. */
export const hostKeyHash = (hostKey: string): Buffer => createHash('sha256').update(hostKey).digest();

interface CookieRow {
  host_key: string;
  name: string;
  encrypted_value: Uint8Array | null;
  value: string | null;
  expires_utc: number;
}

/** Open a copy of a Cookies sqlite DB, returning rows whose name is wanted and whose host matches; copy is deleted. */
function readChromiumRows(file: string, host: string, names: Set<string>, nowMs: number): CookieRow[] {
  const dir = mkdtempSync(path.join(tmpdir(), 'collected-cookies-'));
  const copy = path.join(dir, 'Cookies');
  try {
    copyFileSync(file, copy);
    const db = new (DatabaseSyncClass())(copy, { readOnly: true });
    try {
      const rows = db
        .prepare('SELECT host_key, name, encrypted_value, value, CAST(expires_utc AS REAL) AS expires_utc FROM cookies')
        .all() as unknown as CookieRow[];
      return rows.filter((r) => names.has(r.name) && hostMatches(r.host_key, host) && chromiumLive(r.expires_utc, nowMs));
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Chromium profile folders (each holds its own Cookies DB), default profile first. */
function chromiumProfiles(root: string): { profile: string; file: string }[] {
  if (!existsSync(root)) return [];
  const out: { profile: string; file: string }[] = [];
  for (const entry of readdirSync(root)) {
    const dir = path.join(root, entry);
    try {
      if (!statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    const file = [path.join(dir, 'Network', 'Cookies'), path.join(dir, 'Cookies')].find((f) => existsSync(f));
    if (file) out.push({ profile: entry, file });
  }
  out.sort((a, b) => (a.profile === 'Default' ? -1 : b.profile === 'Default' ? 1 : a.profile.localeCompare(b.profile)));
  return out;
}

function scanChromium(browser: BrowserId, def: ChromiumDef, host: string, names: Set<string>, opts: ScanOptions): BrowserScan {
  const home = opts.home ?? homedir();
  const root = path.join(supportRoot(home), def.support);
  const profiles = chromiumProfiles(root);
  if (!profiles.length) return { browser, installed: false, profiles: [] };

  const reader = opts.keychainPassword ?? defaultKeychainReader;
  let key: Buffer | undefined;
  let keyError: string | undefined;
  const getKey = (): Buffer | undefined => {
    if (key) return key;
    if (keyError) return undefined;
    try {
      key = deriveChromiumKey(reader(def.keychainService));
      return key;
    } catch (e) {
      keyError = `could not read the Keychain password for "${def.keychainService}" (prompt denied or no such item): ${(e as Error).message}`;
      return undefined;
    }
  };

  const result: ProfileScan[] = [];
  const now = Date.now();
  for (const { profile, file } of profiles) {
    let rows: CookieRow[];
    try {
      rows = readChromiumRows(file, host, names, now);
    } catch {
      continue; // unreadable/locked profile store; try the next profile
    }
    if (!rows.length) continue;
    const cookies: FoundCookie[] = [];
    for (const row of rows) {
      let value: string | null;
      if (row.encrypted_value && row.encrypted_value.length) {
        const k = getKey();
        if (!k) break; // Keychain unavailable: stop, report below
        value = decryptChromiumValue(Buffer.from(row.encrypted_value), k);
      } else {
        value = row.value ?? null;
      }
      if (value) cookies.push({ name: row.name, value });
    }
    if (cookies.length) result.push({ profile, cookies });
  }
  if (!result.length && keyError) return { browser, installed: true, profiles: [], error: keyError };
  return { browser, installed: true, profiles: result };
}

interface FirefoxRow {
  name: string;
  value: string;
  host: string;
  expiry: number;
}

function readFirefoxRows(file: string, host: string, names: Set<string>, nowMs: number): FoundCookie[] {
  const dir = mkdtempSync(path.join(tmpdir(), 'collected-cookies-'));
  const copy = path.join(dir, 'cookies.sqlite');
  try {
    copyFileSync(file, copy);
    const db = new (DatabaseSyncClass())(copy, { readOnly: true });
    try {
      const rows = db.prepare('SELECT name, value, host, CAST(expiry AS REAL) AS expiry FROM moz_cookies').all() as unknown as FirefoxRow[];
      return rows
        .filter((r) => names.has(r.name) && hostMatches(r.host, host) && firefoxLive(r.expiry, nowMs))
        .map((r) => ({ name: r.name, value: r.value }));
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function firefoxProfiles(root: string): { profile: string; file: string }[] {
  const dir = path.join(root, 'Profiles');
  if (!existsSync(dir)) return [];
  const out: { profile: string; file: string }[] = [];
  for (const entry of readdirSync(dir)) {
    const file = path.join(dir, entry, 'cookies.sqlite');
    if (existsSync(file)) out.push({ profile: entry, file });
  }
  const rank = (p: string): number => (/\.default-release$/.test(p) ? 0 : /\.default$/.test(p) ? 1 : 2);
  out.sort((a, b) => rank(a.profile) - rank(b.profile) || a.profile.localeCompare(b.profile));
  return out;
}

function scanFirefox(browser: BrowserId, def: FirefoxDef, host: string, names: Set<string>, opts: ScanOptions): BrowserScan {
  const home = opts.home ?? homedir();
  const root = path.join(supportRoot(home), def.support);
  const profiles = firefoxProfiles(root);
  if (!profiles.length) return { browser, installed: false, profiles: [] };
  const result: ProfileScan[] = [];
  const now = Date.now();
  for (const { profile, file } of profiles) {
    let cookies: FoundCookie[];
    try {
      cookies = readFirefoxRows(file, host, names, now);
    } catch {
      continue;
    }
    if (cookies.length) result.push({ profile, cookies });
  }
  return { browser, installed: true, profiles: result };
}

/** Read the wanted cookies for `host` from one browser, across its profiles. Never throws for a missing browser. */
export function scanBrowser(browser: BrowserId, host: string, names: Iterable<string>, opts: ScanOptions = {}): BrowserScan {
  const def = BROWSERS[browser];
  const set = new Set(names);
  return def.kind === 'chromium' ? scanChromium(browser, def, host, set, opts) : scanFirefox(browser, def, host, set, opts);
}
