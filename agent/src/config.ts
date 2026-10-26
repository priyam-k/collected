import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import path from 'node:path';
import { isInside } from './place.js';

/**
 * ~/.collected/agent.json. Paths live here and only here (DESIGN "File sync to a laptop"): the server knows
 * target names; this file says where each one is on this machine.
 */
export interface AgentConfig {
  /** Where collected runs, e.g. https://collected.priyamkabra.com or http://localhost:3000 */
  server: string;
  auth: {
    /** Cloudflare Access service token (prod). */
    cfAccessClientId?: string;
    cfAccessClientSecret?: string;
    /** LOCAL_HELPER_KEY (local dev, or an Access bypass). */
    helperKey?: string;
  };
  /** Name this machine reports; defaults to the hostname. */
  device: string;
  /** Pristine copies live here; targets are hard links (or copies) of it. */
  cacheDir: string;
  /** hardlink (default) shares bytes with the cache; copy for folders a sync service manages (iCloud Drive, Dropbox). */
  linkMode?: 'hardlink' | 'copy';
  /**
   * courseId → root folder and per-target overrides. An unmapped target is <root>/<target>. `index` is a file to
   * write one course-wide manifest to (e.g. <root>/_data/canvas.md) instead of a `_collected.md` in each target.
   * `facts` is a folder for assignments.md, announcements.md and syllabus.md (e.g. _data).
   */
  courses: Record<string, { root?: string; targets?: Record<string, string>; index?: string; facts?: string }>;
  /** Never download a file larger than this (a lecture video in a synced folder). Default 100. */
  maxFileMb?: number;
  /** Canvas host `collected connect canvas` reads the session cookie for. Default umd.instructure.com. */
  canvasHost?: string;
  /** Shell command run once after a sync that placed files. Env: COLLECTED_PLACED (newline-separated paths), COLLECTED_COURSES. */
  onPlace?: string;
  model: ModelConfig;
}

/** The decision model: TypeSafe's hosted Jev by default; any server speaking POST /v1/systemone works (laya-serve locally). */
export interface ModelConfig {
  enabled: boolean;
  /** Default https://api.typesafe.ai */
  baseUrl?: string;
  /** Default jev-latest */
  model?: string;
  /** Or the TYPESAFE_API_KEY environment variable. Set with: collected-agent auth model */
  apiKey?: string;
  /**
   * The API key is only sent to typesafe.ai hosts. Set true to send it to another `baseUrl` (a proxy of your own);
   * nothing sets this for you, since the key would go to whatever the URL says.
   */
  trustHost?: boolean;
}

export const agentHome = (): string => process.env.COLLECTED_AGENT_HOME || path.join(homedir(), '.collected');
export const configPath = (): string => path.join(agentHome(), 'agent.json');

export function defaultConfig(server = 'http://localhost:3000'): AgentConfig {
  return { server, auth: {}, device: hostname().replace(/\.local$/, ''), cacheDir: path.join(agentHome(), 'cache'), courses: {}, model: { enabled: true, baseUrl: 'https://api.typesafe.ai', model: 'jev-latest' } };
}

export function loadConfig(): AgentConfig {
  const file = configPath();
  if (!existsSync(file)) throw new Error(`No agent config at ${file}. Run: collected-agent init <server-url>`);
  const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<AgentConfig>;
  const base = defaultConfig(raw.server);
  return { ...base, ...raw, auth: raw.auth ?? {}, courses: raw.courses ?? {}, model: { ...base.model, ...(raw.model ?? {}) } };
}

/** Owner-only, written to a temp name and renamed in, so a crash never leaves a truncated or readable copy. */
export function writePrivate(file: string, content: string): void {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, content, { mode: 0o600 });
  chmodSync(tmp, 0o600); // `mode` applies only on create; a leftover tmp keeps its old bits otherwise
  renameSync(tmp, file);
}

export function saveConfig(cfg: AgentConfig): void {
  writePrivate(configPath(), `${JSON.stringify(cfg, null, 2)}\n`);
}

export const expandHome = (p: string): string => (p.startsWith('~/') ? path.join(homedir(), p.slice(2)) : p);

/** The course's root folder on this machine, when one is configured. */
export function courseRoot(cfg: AgentConfig, courseId: string): string | null {
  const r = cfg.courses[courseId]?.root;
  return r ? path.resolve(expandHome(r)) : null;
}

/** Absolute folder for the course facts files, when configured. */
export function courseFactsDir(cfg: AgentConfig, courseId: string): string | null {
  const c = cfg.courses[courseId];
  if (!c?.facts) return null;
  return path.resolve(c.root ? expandHome(c.root) : process.cwd(), expandHome(c.facts));
}

/** Absolute path of the course-wide index file, when configured. */
export function courseIndexPath(cfg: AgentConfig, courseId: string): string | null {
  const c = cfg.courses[courseId];
  if (!c?.index) return null;
  return path.resolve(c.root ? expandHome(c.root) : process.cwd(), expandHome(c.index));
}

const realpathOr = (p: string): string => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};

/**
 * Absolute folder for a target on this machine, or null when neither a mapping nor a course root exists. A target
 * without an explicit mapping is `<root>/<target>` and must stay under the root: lexically, and again after
 * resolving symlinks on whatever part of it exists. Only an explicit mapping (the user's own path) may point elsewhere.
 */
export function targetDir(cfg: AgentConfig, courseId: string, target: string): string | null {
  const c = cfg.courses[courseId];
  if (!c) return null;
  // A target path may be absolute, ~-relative, or relative to the course root ("Slides").
  const base = c.root ? expandHome(c.root) : process.cwd();
  const explicit = c.targets?.[target];
  if (explicit) return path.resolve(base, expandHome(explicit));
  if (!c.root) return null;
  const root = path.resolve(base);
  const dir = path.resolve(root, target);
  if (!isInside(root, dir)) return null;
  const realRoot = realpathOr(root);
  const realDir = existsSync(dir) ? realpathOr(dir) : path.join(realRoot, path.relative(root, dir));
  return isInside(realRoot, realDir) ? dir : null;
}

/** Every target path this device knows for a course (for the report / UI). */
export function knownTargets(cfg: AgentConfig, courseId: string, names: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of names) {
    const d = targetDir(cfg, courseId, n);
    if (d) out[n] = d;
  }
  return out;
}
