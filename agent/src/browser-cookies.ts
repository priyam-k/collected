import { execFileSync } from 'node:child_process';
import { pbkdf2Sync, createDecipheriv, createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
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
 * Read cookies for one host out of a local browser's cookie store. Replaces the Python `browser_cookie3` helper
 * (DECISIONS 043 / the retired local/canvas_cookie.py). Firefox stores values in the clear on every platform;
 * Chromium encrypts them with a per-platform key (DECISIONS 059):
 *   macOS    `v10`  AES-128-CBC, key from the Keychain "Safe Storage" password (PBKDF2, 1003 rounds)
 *   Windows  `v10`  AES-256-GCM, key in `Local State` under DPAPI; `v20` is app-bound and unreadable from here
 *   Linux    `v10`  AES-128-CBC, key from the fixed password "peanuts" (PBKDF2, 1 round: the basic store)
 *            `v11`  the same cipher with a password the desktop keyring holds; read through `secret-tool` when
 *                   that works, otherwise the store is locked for us
 * The file is copied before it is opened because the running browser holds a lock on it. Cookie *values*
 * never leave this module except through the returned structure; nothing here prints or logs a value.
 */

export type BrowserId = 'chrome' | 'chromium' | 'brave' | 'edge' | 'arc' | 'firefox';

/** Order the connect flow tries browsers in when none is named. */
export const BROWSER_ORDER: BrowserId[] = ['chrome', 'brave', 'edge', 'arc', 'chromium', 'firefox'];

export const isBrowserId = (s: string): s is BrowserId => (BROWSER_ORDER as string[]).includes(s);

/** Reads the Chromium "Safe Storage" password for a Keychain service (macOS). Injected in tests. */
export type KeychainReader = (service: string) => string;

export const defaultKeychainReader: KeychainReader = (service) =>
  execFileSync('security', ['find-generic-password', '-w', '-s', service], { encoding: 'utf8' }).trim();

/** Windows DPAPI `CryptUnprotectData` for the current user, over the key blob from `Local State`. Injected in tests. */
export type DpapiUnprotect = (blob: Buffer) => Buffer;

/**
 * No native module: PowerShell's `ProtectedData.Unprotect` is DPAPI. The blob travels as base64 in both directions,
 * which is the one alphabet that needs no quoting inside the single-quoted PowerShell literal.
 */
export const defaultDpapiUnprotect: DpapiUnprotect = (blob) => {
  const b64 = blob.toString('base64');
  if (!/^[A-Za-z0-9+/=]*$/.test(b64)) throw new Error('key blob is not base64');
  const script = `Add-Type -AssemblyName System.Security; [Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String('${b64}'), $null, 'CurrentUser'))`;
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 30_000 }).trim();
  if (!out) throw new Error('PowerShell returned nothing');
  return Buffer.from(out, 'base64');
};

/** The password a Linux desktop keyring holds for a Chromium browser's `v11` cookies, or undefined when it cannot be read. Injected in tests. */
export type LinuxKeyringReader = (application: string) => string | undefined;

/** `secret-tool` (libsecret) answers for GNOME Keyring and, through its D-Bus bridge, KWallet; anything else means locked. */
export const defaultLinuxKeyringReader: LinuxKeyringReader = (application) => {
  try {
    const out = execFileSync('secret-tool', ['lookup', 'xdg:schema', 'chrome_libsecret_os_crypt_password_v2', 'application', application], { encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'ignore'] });
    return out.length ? out : undefined;
  } catch {
    return undefined;
  }
};

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
  /** Profiles that hold at least one wanted cookie. */
  profiles: ProfileScan[];
  /** How many profile stores were opened, with or without a hit; what "no cookie" was measured against. */
  scanned: number;
  /** Why nothing could be read (Keychain prompt denied, app-bound encryption, locked keyring); profiles is empty when set. */
  error?: string;
}

/** The pieces of the machine the scan reads; tests inject all of them so the real home, platform and env are never touched. */
export interface ScanOptions {
  /** Override the home dir (tests point this at a fixture tree). */
  home?: string;
  /** `process.platform` by default; decides where the stores live and how Chromium encrypts. */
  platform?: NodeJS.Platform;
  /** `APPDATA` / `LOCALAPPDATA` on Windows; `process.env` by default. */
  env?: Record<string, string | undefined>;
  keychainPassword?: KeychainReader;
  dpapiUnprotect?: DpapiUnprotect;
  linuxKeyringPassword?: LinuxKeyringReader;
}

interface ChromiumDef {
  kind: 'chromium';
  /** Path under ~/Library/Application Support that holds the profile folders. */
  darwin: string;
  /** Path under %LOCALAPPDATA% that holds `Local State` and the profile folders; absent when the browser has no Windows build we know the layout of. */
  win32?: string;
  /** Path under ~/.config; absent when there is no Linux build. */
  linux?: string;
  keychainService: string;
  /** The `application` attribute Chromium gives its keyring entry on Linux. */
  keyringApp?: string;
}
interface FirefoxDef {
  kind: 'firefox';
}

const BROWSERS: Record<BrowserId, ChromiumDef | FirefoxDef> = {
  chrome: { kind: 'chromium', darwin: 'Google/Chrome', win32: 'Google/Chrome/User Data', linux: 'google-chrome', keychainService: 'Chrome Safe Storage', keyringApp: 'chrome' },
  chromium: { kind: 'chromium', darwin: 'Chromium', win32: 'Chromium/User Data', linux: 'chromium', keychainService: 'Chromium Safe Storage', keyringApp: 'chromium' },
  brave: { kind: 'chromium', darwin: 'BraveSoftware/Brave-Browser', win32: 'BraveSoftware/Brave-Browser/User Data', linux: 'BraveSoftware/Brave-Browser', keychainService: 'Brave Safe Storage', keyringApp: 'brave' },
  edge: { kind: 'chromium', darwin: 'Microsoft Edge', win32: 'Microsoft/Edge/User Data', linux: 'microsoft-edge', keychainService: 'Microsoft Edge Safe Storage', keyringApp: 'microsoft-edge' },
  // Arc ships for macOS and (as a packaged app) Windows; only the macOS layout is known here.
  arc: { kind: 'chromium', darwin: 'Arc/User Data', keychainService: 'Arc Safe Storage' },
  firefox: { kind: 'firefox' },
};

const supportRoot = (home: string): string => path.join(home, 'Library', 'Application Support');

/** `%LOCALAPPDATA%` / `%APPDATA%`, falling back to their usual place under the profile when the variable is unset. */
function windowsRoots(home: string, env: Record<string, string | undefined>): { local: string; roaming: string } {
  return {
    local: env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'),
    roaming: env.APPDATA || path.join(home, 'AppData', 'Roaming'),
  };
}

/** Where a Chromium browser keeps its profile folders on this platform; undefined when the layout is not known here. */
export function chromiumUserDataDir(browser: BrowserId, opts: ScanOptions = {}): string | undefined {
  const def = BROWSERS[browser];
  if (def.kind !== 'chromium') return undefined;
  const home = opts.home ?? homedir();
  const platform = opts.platform ?? process.platform;
  if (platform === 'darwin') return path.join(supportRoot(home), def.darwin);
  if (platform === 'win32') return def.win32 ? path.join(windowsRoots(home, opts.env ?? process.env).local, ...def.win32.split('/')) : undefined;
  if (def.linux) return path.join(home, '.config', def.linux);
  return undefined;
}

/** A directory holding Firefox profile folders, with the `profiles.ini` that orders them (when present). */
export interface FirefoxRoot {
  ini: string;
  profilesDir: string;
}

/** Every place Firefox profiles can live on this platform (the snap and flatpak sandboxes have their own on Linux). */
export function firefoxRoots(opts: ScanOptions = {}): FirefoxRoot[] {
  const home = opts.home ?? homedir();
  const platform = opts.platform ?? process.platform;
  if (platform === 'darwin') {
    const root = path.join(supportRoot(home), 'Firefox');
    return [{ ini: path.join(root, 'profiles.ini'), profilesDir: path.join(root, 'Profiles') }];
  }
  if (platform === 'win32') {
    const root = path.join(windowsRoots(home, opts.env ?? process.env).roaming, 'Mozilla', 'Firefox');
    return [{ ini: path.join(root, 'profiles.ini'), profilesDir: path.join(root, 'Profiles') }];
  }
  return [path.join(home, '.mozilla', 'firefox'), path.join(home, 'snap', 'firefox', 'common', '.mozilla', 'firefox'), path.join(home, '.var', 'app', 'org.mozilla.firefox', '.mozilla', 'firefox')].map((root) => ({
    ini: path.join(root, 'profiles.ini'),
    profilesDir: root,
  }));
}

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

/** Chromium's fixed password on Linux when no desktop keyring is used (the "basic" password store). */
export const LINUX_BASIC_PASSWORD = 'peanuts';
/** Linux derives with one PBKDF2 round, not macOS's 1003 (os_crypt_linux.cc). */
export const LINUX_PBKDF2_ITERATIONS = 1;

/** The AES key Chromium derives on Linux: the same salt and size as macOS, one round, `peanuts` unless a keyring holds another password. */
export function deriveLinuxChromiumKey(password: string = LINUX_BASIC_PASSWORD): Buffer {
  return pbkdf2Sync(password, PBKDF2_SALT, LINUX_PBKDF2_ITERATIONS, 16, 'sha1');
}

const isPrintable = (buf: Buffer): boolean => {
  for (const b of buf) if (b < 0x20 || b > 0x7e) return false;
  return true;
};

/** No control bytes: what a cookie value never contains and what a wrong key almost always produces. */
const hasNoControlBytes = (buf: Buffer): boolean => {
  for (const b of buf) if (b < 0x20 || b === 0x7f) return false;
  return true;
};

/**
 * Chrome 130+ prepends a 32-byte SHA-256 of the host key to the plaintext; it is stripped when those first bytes are
 * not printable (i.e. they are the hash, not the start of the value). What remains is rejected when it holds control
 * bytes: a wrong key (Linux, where the password is a guess) usually fails PKCS7 padding, and this catches the rest.
 */
function finishPlaintext(plain: Buffer): string | null {
  if (plain.length >= 32 && !isPrintable(plain.subarray(0, 32))) plain = plain.subarray(32);
  return hasNoControlBytes(plain) ? plain.toString('utf8') : null;
}

/**
 * Decrypt one Chromium cookie value as macOS and Linux write it: `v10` (or Linux's `v11`) marks AES-128-CBC with a
 * 16-space IV and PKCS7 padding. Returns null if it cannot be decrypted or does not decrypt to a cookie value.
 */
export function decryptChromiumValue(encrypted: Buffer, key: Buffer): string | null {
  if (encrypted.length === 0) return null;
  const prefix = encrypted.subarray(0, 3).toString('latin1');
  if (prefix !== 'v10' && prefix !== 'v11') return encrypted.toString('utf8'); // unencrypted (rare)
  const iv = Buffer.alloc(16, 0x20);
  try {
    const decipher = createDecipheriv('aes-128-cbc', key, iv);
    return finishPlaintext(Buffer.concat([decipher.update(encrypted.subarray(3)), decipher.final()]));
  } catch {
    return null;
  }
}

/** Decrypt one Chromium cookie value as Windows writes it: `v10` + 12-byte nonce + ciphertext + 16-byte GCM tag, AES-256. */
export function decryptChromiumValueWindows(encrypted: Buffer, key: Buffer): string | null {
  if (encrypted.length === 0) return null;
  const prefix = encrypted.subarray(0, 3).toString('latin1');
  if (prefix !== 'v10') return prefix === 'v20' ? null : encrypted.toString('utf8');
  if (encrypted.length < 3 + 12 + 16) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, encrypted.subarray(3, 15));
    decipher.setAuthTag(encrypted.subarray(encrypted.length - 16));
    return finishPlaintext(Buffer.concat([decipher.update(encrypted.subarray(15, encrypted.length - 16)), decipher.final()]));
  } catch {
    return null;
  }
}

/** The SHA-256 of a host key, as Chrome 130+ prepends it. Exported so tests can build fixtures the same way. */
export const hostKeyHash = (hostKey: string): Buffer => createHash('sha256').update(hostKey).digest();

const DISPLAY: Record<BrowserId, string> = { chrome: 'Chrome', chromium: 'Chromium', brave: 'Brave', edge: 'Edge', arc: 'Arc', firefox: 'Firefox' };

export const PASTE_INSTEAD = 'use Firefox, or paste the cookie from DevTools (Settings → Sources)';
/** Chrome 127+ (and Edge) on Windows: the cookie key is held by a service that answers only the browser itself. */
export const appBoundReason = (browser: BrowserId): string => `${DISPLAY[browser]} protects its cookies with app-bound encryption on Windows; ${PASTE_INSTEAD}`;
export const KEYRING_LOCKED_REASON = `cookies are locked by the desktop keyring (GNOME Keyring or KWallet); ${PASTE_INSTEAD}`;

/** Read the DPAPI-wrapped AES key out of a Windows `Local State` file (`os_crypt.encrypted_key`, base64, `DPAPI` prefix). */
export function readWindowsLocalStateKey(userDataDir: string, unprotect: DpapiUnprotect): Buffer {
  const file = path.join(userDataDir, 'Local State');
  const state = JSON.parse(readFileSync(file, 'utf8')) as { os_crypt?: { encrypted_key?: string } };
  const b64 = state.os_crypt?.encrypted_key;
  if (!b64) throw new Error('Local State has no os_crypt.encrypted_key');
  const blob = Buffer.from(b64, 'base64');
  if (blob.subarray(0, 5).toString('latin1') !== 'DPAPI') throw new Error('os_crypt.encrypted_key is not DPAPI-wrapped');
  const key = unprotect(blob.subarray(5));
  if (key.length !== 32) throw new Error(`DPAPI returned a ${key.length}-byte key, expected 32`);
  return key;
}

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

/** One value's fate: a value, nothing worth reporting (skip), or a reason the whole store is unreadable. */
type Decrypted = { value: string | null; reason?: string };

/**
 * The per-platform decryptor for one browser's store: fetches the key once (lazily, so a store with only plain
 * values never prompts) and remembers why it could not, so every profile reports the same reason.
 */
function chromiumDecryptor(browser: BrowserId, def: ChromiumDef, root: string, platform: NodeJS.Platform, opts: ScanOptions): (encrypted: Buffer) => Decrypted {
  let keyError: string | undefined;
  const once = <T>(get: () => T): (() => T | undefined) => {
    let v: T | undefined;
    let tried = false;
    return () => {
      if (tried) return v;
      tried = true;
      try {
        v = get();
      } catch (e) {
        keyError = keyError ?? (e as Error).message;
      }
      return v;
    };
  };

  if (platform === 'win32') {
    const unprotect = opts.dpapiUnprotect ?? defaultDpapiUnprotect;
    const key = once(() => {
      try {
        return readWindowsLocalStateKey(root, unprotect);
      } catch (e) {
        throw new Error(`could not unwrap the cookie key with DPAPI (Local State under ${root}): ${(e as Error).message}`);
      }
    });
    return (encrypted) => {
      if (encrypted.subarray(0, 3).toString('latin1') === 'v20') return { value: null, reason: appBoundReason(browser) };
      const k = key();
      if (!k) return { value: null, reason: keyError };
      const value = decryptChromiumValueWindows(encrypted, k);
      return value === null ? { value: null, reason: 'the cookie did not decrypt with the key from Local State' } : { value };
    };
  }

  if (platform === 'darwin') {
    const reader = opts.keychainPassword ?? defaultKeychainReader;
    const key = once(() => {
      try {
        return deriveChromiumKey(reader(def.keychainService));
      } catch (e) {
        throw new Error(`could not read the Keychain password for "${def.keychainService}" (prompt denied or no such item): ${(e as Error).message}`);
      }
    });
    return (encrypted) => {
      const k = key();
      if (!k) return { value: null, reason: keyError };
      const value = decryptChromiumValue(encrypted, k);
      return value === null ? { value: null, reason: 'the cookie did not decrypt with the Keychain key' } : { value };
    };
  }

  // Linux: `v10` is the basic store; `v11` is keyring-backed. Try the keyring's password when one can be read, then
  // the fixed one (a keyring that handed Chromium the default would still write v11), and name the keyring when
  // neither yields a cookie-shaped value.
  const keyring = opts.linuxKeyringPassword ?? defaultLinuxKeyringReader;
  const basicKey = deriveLinuxChromiumKey();
  const keyringKey = once(() => {
    const pw = def.keyringApp ? keyring(def.keyringApp) : undefined;
    return pw === undefined ? undefined : deriveLinuxChromiumKey(pw);
  });
  return (encrypted) => {
    const prefix = encrypted.subarray(0, 3).toString('latin1');
    if (prefix === 'v11') {
      const kk = keyringKey();
      const viaKeyring = kk ? decryptChromiumValue(encrypted, kk) : null;
      if (viaKeyring !== null) return { value: viaKeyring };
    }
    const value = decryptChromiumValue(encrypted, basicKey);
    if (value !== null) return { value };
    return { value: null, reason: KEYRING_LOCKED_REASON };
  };
}

function scanChromium(browser: BrowserId, def: ChromiumDef, host: string, names: Set<string>, opts: ScanOptions): BrowserScan {
  const platform = opts.platform ?? process.platform;
  const root = chromiumUserDataDir(browser, opts);
  if (!root) return { browser, installed: false, profiles: [], scanned: 0 };
  const profiles = chromiumProfiles(root);
  if (!profiles.length) return { browser, installed: false, profiles: [], scanned: 0 };

  const decrypt = chromiumDecryptor(browser, def, root, platform, opts);
  const result: ProfileScan[] = [];
  const now = Date.now();
  let scanned = 0;
  let reason: string | undefined;
  for (const { profile, file } of profiles) {
    let rows: CookieRow[];
    try {
      rows = readChromiumRows(file, host, names, now);
    } catch {
      continue; // unreadable/locked profile store; try the next profile
    }
    scanned++;
    if (!rows.length) continue;
    const cookies: FoundCookie[] = [];
    for (const row of rows) {
      let value: string | null;
      if (row.encrypted_value && row.encrypted_value.length) {
        const d = decrypt(Buffer.from(row.encrypted_value));
        value = d.value;
        if (d.reason) reason = reason ?? d.reason;
      } else {
        value = row.value ?? null;
      }
      if (value) cookies.push({ name: row.name, value });
    }
    if (cookies.length) result.push({ profile, cookies });
  }
  if (!result.length && reason) return { browser, installed: true, profiles: [], scanned, error: reason };
  return { browser, installed: true, profiles: result, scanned };
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

/**
 * The profile folder names `profiles.ini` marks as default: `[Install…] Default=<path>` (the one the installed
 * build opens) first, then `[Profile…]` sections with `Default=1`. Relative or not, only the last path segment is
 * compared, since the folders are enumerated next to the ini anyway.
 */
export function firefoxDefaultProfiles(ini: string): string[] {
  let text: string;
  try {
    text = readFileSync(ini, 'utf8');
  } catch {
    return [];
  }
  const installs: string[] = [];
  const defaults: string[] = [];
  let section = '';
  let sectionPath: string | undefined;
  let sectionDefault = false;
  const flush = () => {
    if (sectionPath && /^Profile/i.test(section) && sectionDefault) defaults.push(sectionPath);
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const head = line.match(/^\[(.+)\]$/);
    if (head) {
      flush();
      section = head[1]!;
      sectionPath = undefined;
      sectionDefault = false;
      continue;
    }
    const kv = line.match(/^([^=]+)=(.*)$/);
    if (!kv) continue;
    const key = kv[1]!.trim();
    const value = kv[2]!.trim();
    if (key === 'Path') sectionPath = path.basename(value.replace(/\\/g, '/'));
    else if (key === 'Default') {
      if (/^Install/i.test(section)) installs.push(path.basename(value.replace(/\\/g, '/')));
      else sectionDefault = value === '1';
    }
  }
  flush();
  return [...new Set([...installs, ...defaults])];
}

function firefoxProfiles(root: FirefoxRoot): { profile: string; file: string }[] {
  if (!existsSync(root.profilesDir)) return [];
  const out: { profile: string; file: string }[] = [];
  for (const entry of readdirSync(root.profilesDir)) {
    const file = path.join(root.profilesDir, entry, 'cookies.sqlite');
    if (existsSync(file)) out.push({ profile: entry, file });
  }
  const preferred = firefoxDefaultProfiles(root.ini);
  const rank = (p: string): number => {
    const i = preferred.indexOf(p);
    if (i >= 0) return i;
    return preferred.length + (/\.default-release$/.test(p) ? 0 : /\.default$/.test(p) ? 1 : 2);
  };
  out.sort((a, b) => rank(a.profile) - rank(b.profile) || a.profile.localeCompare(b.profile));
  return out;
}

function scanFirefox(browser: BrowserId, host: string, names: Set<string>, opts: ScanOptions): BrowserScan {
  const profiles = firefoxRoots(opts).flatMap(firefoxProfiles);
  if (!profiles.length) return { browser, installed: false, profiles: [], scanned: 0 };
  const result: ProfileScan[] = [];
  const now = Date.now();
  let scanned = 0;
  for (const { profile, file } of profiles) {
    let cookies: FoundCookie[];
    try {
      cookies = readFirefoxRows(file, host, names, now);
    } catch {
      continue;
    }
    scanned++;
    if (cookies.length) result.push({ profile, cookies });
  }
  return { browser, installed: true, profiles: result, scanned };
}

/** Read the wanted cookies for `host` from one browser, across its profiles. Never throws for a missing browser. */
export function scanBrowser(browser: BrowserId, host: string, names: Iterable<string>, opts: ScanOptions = {}): BrowserScan {
  const def = BROWSERS[browser];
  const set = new Set(names);
  return def.kind === 'chromium' ? scanChromium(browser, def, host, set, opts) : scanFirefox(browser, host, set, opts);
}

/** One line per browser for the "nothing found" error: what was looked at, so a locked store never reads as a missing cookie. */
export function describeScan(scan: BrowserScan, host: string): string {
  if (!scan.installed) return `${scan.browser}: not installed`;
  if (scan.error) return `${scan.browser}: ${scan.error}`;
  return `${scan.browser}: ${scan.scanned} profile${scan.scanned === 1 ? '' : 's'}, no session cookie for ${host}`;
}
