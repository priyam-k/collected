import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { pickShipped, shippedMigrations, shippedSeedConfig, shippedWebDist } from './paths.js';

describe('shipped files', () => {
  const dist = '/opt/node_modules/collected-cli/dist';

  it('prefers the copy next to the bundle', () => {
    const exists = (p: string) => p === path.join(dist, 'web', 'index.html');
    expect(pickShipped(dist, 'web', 'index.html', 'web/dist', exists)).toBe(path.join(dist, 'web'));
  });

  it('falls back to the checkout two levels up, never to a walk from node_modules', () => {
    expect(pickShipped(dist, 'web', 'index.html', path.join('web', 'dist'), () => false)).toBe('/opt/node_modules/web/dist');
    expect(pickShipped('/repo/agent/src', 'drizzle', 'meta/_journal.json', path.join('core', 'drizzle'), () => false)).toBe('/repo/core/drizzle');
  });

  it('a plain file is its own marker', () => {
    const exists = (p: string) => p === path.join(dist, 'seed-config.json');
    expect(pickShipped(dist, 'seed-config.json', '', 'artifacts/seed-config.json', exists)).toBe(path.join(dist, 'seed-config.json'));
  });

  it('resolves to real files from the source tree', () => {
    // Under vitest this file runs from agent/src, so every fallback is the repo's own copy.
    expect(shippedMigrations()).toMatch(/core[\\/]drizzle$/);
    expect(shippedSeedConfig()).toMatch(/artifacts[\\/]seed-config\.json$/);
    expect(shippedWebDist()).toMatch(/web[\\/]dist$/);
  });
});
