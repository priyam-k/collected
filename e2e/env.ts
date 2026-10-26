import path from 'node:path';

/** Paths and ports shared by the config, the global hooks and the specs. Override the port with E2E_PORT. */
export const ROOT = path.resolve(import.meta.dirname, '..');
export const PORT = Number(process.env.E2E_PORT) || 4300;
export const BASE_URL = `http://localhost:${PORT}`;
export const SEED_CONFIG = path.join(ROOT, 'e2e', 'fixtures', 'seed-config.json');
export const WEB_DIST = path.join(ROOT, 'web', 'dist');
export const AGENT_CLI = path.join(ROOT, 'agent', 'dist', 'cli.js');

/** Course ids the seed file produces (term-code-section, lowercased). */
export const COURSE = {
  cmsc422: '2026-fall-cmsc422-0101',
  math423: '2026-fall-math423-0301',
  stat410: '2026-fall-stat410-0601',
  cmsc330: '2026-fall-cmsc330-0103',
} as const;
