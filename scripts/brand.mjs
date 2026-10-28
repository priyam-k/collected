// Draws the collected logo files from one geometry (the same numbers as web/src/components/Logo.tsx):
//   web/public/icons/icon.svg          favicon and the About page tile
//   web/public/icons/icon-180.png      apple-touch-icon (full bleed; iOS rounds it)
//   web/public/icons/icon-192.png      manifest icon
//   web/public/icons/icon-512.png      manifest icon, maskable (mark inside the safe zone)
//   docs/brand/mark.svg                the bare mark, for anyone who needs it
//   docs/brand/logo-light.png, logo-dark.png   mark and wordmark for the README
// Run from the repo root after `pnpm --filter e2e exec playwright install chromium`:  node scripts/brand.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const require = createRequire(path.join(ROOT, 'e2e', 'package.json'));
const { chromium } = require('@playwright/test');

const INK = '#1f1c17';
const PAPER = '#f3efe6';
const ACCENT = '#2e5aa8'; // eggshell blue
const ACCENT_LIFTED = '#7d9fe0'; // charcoal blue, for the dot on a dark tile

/** The mark on its 32 grid: a tall tile, a square tile, and the round accent tile (the period). */
const mark = (fill, dot) =>
  `<rect x="2.5" y="2.5" width="12" height="27" rx="4" fill="${fill}"/><rect x="17.5" y="2.5" width="12" height="12" rx="4" fill="${fill}"/><circle cx="23.5" cy="23.5" r="6" fill="${dot}"/>`;

/** The mark on a dark tile; `scale` is the mark's share of the tile, `radius` the tile's corner (0 = full bleed). */
const tile = (size, scale, radius) => {
  const m = size * scale;
  const off = (size - m) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" fill="${INK}"/><g transform="translate(${off} ${off}) scale(${m / 32})">${mark(PAPER, ACCENT_LIFTED)}</g></svg>`;
};

const out = (p, data) => {
  const full = path.join(ROOT, p);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, data);
  console.log('wrote', p);
};

out('web/public/icons/icon.svg', tile(64, 0.62, 15));
out('docs/brand/mark.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">${mark(INK, ACCENT)}</svg>`);

const font = readFileSync(path.join(ROOT, 'web/public/fonts/MonaSans-Variable.woff2')).toString('base64');
const wordmarkPage = (text, dot) => `<!doctype html><html><head><style>
@font-face { font-family: "Mona Sans"; src: url(data:font/woff2;base64,${font}) format("woff2"); font-weight: 200 900; }
html, body { margin: 0; background: transparent; }
#logo { display: inline-flex; align-items: center; gap: 22px; padding: 8px 12px; font: 640 64px/1 "Mona Sans"; letter-spacing: -0.035em; color: ${text}; }
#logo i { font-style: normal; color: ${dot}; }
</style></head><body><span id="logo"><svg viewBox="0 0 32 32" width="84" height="84">${mark(text, dot)}</svg><span>collected<i>.</i></span></span></body></html>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const [name, size, scale, radius] of [
    ['icon-180.png', 180, 0.6, 0],
    ['icon-192.png', 192, 0.62, 44],
    ['icon-512.png', 512, 0.52, 0],
  ]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0;background:transparent">${tile(size, scale, radius)}</body></html>`);
    out(`web/public/icons/${name}`, await page.locator('svg').screenshot({ omitBackground: true }));
  }
  const hi = await browser.newPage({ deviceScaleFactor: 2 });
  for (const [name, text, dot] of [
    ['logo-light.png', INK, ACCENT],
    ['logo-dark.png', '#eeede9', ACCENT_LIFTED],
  ]) {
    await hi.setContent(wordmarkPage(text, dot));
    await hi.evaluate(() => document.fonts.ready);
    out(`docs/brand/${name}`, await hi.locator('#logo').screenshot({ omitBackground: true }));
  }
} finally {
  await browser.close();
}
