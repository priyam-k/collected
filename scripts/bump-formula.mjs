#!/usr/bin/env node
/*
 * Points the Homebrew formula at one published version of collected-cli.
 *
 *   node scripts/bump-formula.mjs <version> [--wait <seconds>]
 *
 * Asks the npm registry for that version's metadata, downloads its tarball, checks the bytes against the registry's
 * sha512 integrity, and rewrites the `url` and `sha256` lines of homebrew/Formula/collected-cli.rb in place. Nothing
 * else in the formula changes. `--wait` keeps asking the registry for up to that many seconds before giving up
 * (the registry lags a publish by a minute or so; release.yml passes 300). Exit 0 when the formula names the
 * version (changed or already there), 1 on any failure; the formula is untouched on failure.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE = 'collected-cli';
const REGISTRY = 'https://registry.npmjs.org';
const FORMULA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'homebrew', 'Formula', `${PACKAGE}.rb`);

const say = (s) => console.log(`[bump-formula] ${s}`);
const fail = (s) => {
  console.error(`[bump-formula] FAIL: ${s}`);
  process.exit(1);
};

const args = process.argv.slice(2);
const version = args.find((a) => !a.startsWith('--'));
const waitIdx = args.indexOf('--wait');
const waitSeconds = waitIdx === -1 ? 0 : Number(args[waitIdx + 1]);
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) fail('usage: node scripts/bump-formula.mjs <version> [--wait <seconds>]');
if (!Number.isFinite(waitSeconds) || waitSeconds < 0) fail('--wait takes a number of seconds');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The registry's record of this version, retried until `--wait` runs out. */
async function metadata() {
  const url = `${REGISTRY}/${PACKAGE}/${version}`;
  const deadline = Date.now() + waitSeconds * 1000;
  for (let attempt = 1; ; attempt++) {
    let status = 'no answer';
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(20_000) });
      if (res.ok) return await res.json();
      status = `${res.status}`;
    } catch (e) {
      status = e instanceof Error ? e.message : String(e);
    }
    if (Date.now() >= deadline) fail(`${PACKAGE}@${version} is not on the registry (${url}: ${status})`);
    const left = Math.ceil((deadline - Date.now()) / 1000);
    say(`${PACKAGE}@${version} not on the registry yet (${status}); retrying for up to ${left} s more`);
    await sleep(Math.min(10_000, Math.max(1000, left * 1000)));
  }
}

const meta = await metadata();
const tarball = typeof meta?.dist?.tarball === 'string' ? meta.dist.tarball : '';
const integrity = typeof meta?.dist?.integrity === 'string' ? meta.dist.integrity : '';
if (!tarball.startsWith(`${REGISTRY}/${PACKAGE}/-/`)) fail(`unexpected tarball location ${tarball || '(none)'}`);
if (!integrity.startsWith('sha512-')) fail(`no sha512 integrity for ${PACKAGE}@${version}`);

say(`downloading ${tarball}`);
const res = await fetch(tarball, { redirect: 'error', signal: AbortSignal.timeout(120_000) });
if (!res.ok) fail(`tarball download answered ${res.status}`);
const bytes = Buffer.from(await res.arrayBuffer());
const sha512 = createHash('sha512').update(bytes).digest('base64');
if (`sha512-${sha512}` !== integrity) fail(`downloaded bytes do not match the registry's integrity for ${version}`);
const sha256 = createHash('sha256').update(bytes).digest('hex');
say(`${bytes.length} bytes, sha256 ${sha256}`);

const before = readFileSync(FORMULA, 'utf8');
let urls = 0;
let shas = 0;
const after = before
  .replace(/^(\s*url ")[^"]+(")/m, (_, a, b) => (urls++, `${a}${tarball}${b}`))
  .replace(/^(\s*sha256 ")[0-9a-f]{64}(")/m, (_, a, b) => (shas++, `${a}${sha256}${b}`));
if (urls !== 1 || shas !== 1) fail(`${FORMULA} does not have exactly one url and one sha256 line`);
if (after === before) say(`${path.relative(process.cwd(), FORMULA)} already names ${version}`);
else {
  writeFileSync(FORMULA, after);
  say(`${path.relative(process.cwd(), FORMULA)} now names ${version}`);
}
