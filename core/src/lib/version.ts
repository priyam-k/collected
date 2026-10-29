import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { BuildInfo } from '../context.js';

export interface BuildInfoSources {
  /** The COLLECTED_COMMIT env the Dockerfile sets. */
  fromEnv?: string | undefined;
  /** The build-info.json the image build writes next to the server. */
  buildInfoFile?: string | undefined;
  /** A checkout to ask `git rev-parse` (development). */
  gitDir?: string | undefined;
}

/**
 * Which commit is running. In order: the COLLECTED_COMMIT env the Dockerfile sets, the build-info.json the image
 * build writes next to the server, `git rev-parse` when a checkout is present (development), else "dev". The update
 * check compares this against upstream main, so a wrong answer here means a wrong banner, never a wrong write.
 */
export function resolveBuildInfo({ fromEnv, buildInfoFile, gitDir }: BuildInfoSources): BuildInfo {
  const file = buildInfoFile ? readBuildInfoFile(buildInfoFile) : null;
  if (fromEnv && fromEnv !== 'dev') return { commit: shortSha(fromEnv), builtAt: file?.builtAt ?? null };
  if (file?.commit && file.commit !== 'dev') return { commit: shortSha(file.commit), builtAt: file.builtAt };
  const git = gitDir ? gitHead(gitDir) : null;
  if (git) return { commit: git, builtAt: file?.builtAt ?? null };
  return { commit: 'dev', builtAt: file?.builtAt ?? null };
}

function readBuildInfoFile(file: string): { commit: string | null; builtAt: string | null } | null {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { commit?: unknown; builtAt?: unknown };
    return {
      commit: typeof raw.commit === 'string' && raw.commit.trim() ? raw.commit.trim() : null,
      builtAt: typeof raw.builtAt === 'string' && raw.builtAt.trim() ? raw.builtAt.trim() : null,
    };
  } catch {
    return null;
  }
}

function gitHead(rootDir: string): string | null {
  if (!existsSync(path.join(rootDir, '.git'))) return null;
  try {
    const out = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: rootDir, encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] });
    const sha = out.trim();
    return /^[0-9a-f]{4,40}$/.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

/** Seven characters is what GitHub prints; a full sha from the env is cut to match build-info and the compare URL. */
export function shortSha(sha: string): string {
  const s = sha.trim();
  return /^[0-9a-f]{40}$/i.test(s) ? s.slice(0, 7).toLowerCase() : s;
}
