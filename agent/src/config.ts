import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import path from 'node:path';

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
   */
  courses: Record<string, { root?: string; targets?: Record<string, string>; index?: string }>;
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
  /** Or the TYPESAFE_API_KEY environment variable. Set with: collected-agent auth model <key> */
  apiKey?: string;
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

export function saveConfig(cfg: AgentConfig): void {
  mkdirSync(agentHome(), { recursive: true });
  writeFileSync(configPath(), `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 });
}

export const expandHome = (p: string): string => (p.startsWith('~/') ? path.join(homedir(), p.slice(2)) : p);

/** Absolute path of the course-wide index file, when configured. */
export function courseIndexPath(cfg: AgentConfig, courseId: string): string | null {
  const c = cfg.courses[courseId];
  if (!c?.index) return null;
  return path.resolve(c.root ? expandHome(c.root) : process.cwd(), expandHome(c.index));
}

/** Absolute folder for a target on this machine, or null when neither a mapping nor a course root exists. */
export function targetDir(cfg: AgentConfig, courseId: string, target: string): string | null {
  const c = cfg.courses[courseId];
  if (!c) return null;
  // A target path may be absolute, ~-relative, or relative to the course root ("Slides").
  const base = c.root ? expandHome(c.root) : process.cwd();
  const explicit = c.targets?.[target];
  if (explicit) return path.resolve(base, expandHome(explicit));
  if (c.root) return path.resolve(base, target);
  return null;
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
