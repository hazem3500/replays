/* why: public/assets/brand (favicon, app icons, web manifest) is drawn from the mark's geometry in
 * src/client/components/brand-mark-geometry.ts, so the tab icon cannot drift from the header mark. Vite copies it to
 * dist/client/assets/brand. Needs Chrome to rasterise: CHROME_PATH, else Playwright's own browser.
 *   node --experimental-strip-types --no-warnings scripts/build-icons.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { chromium } from 'playwright-core';

import { FAVICON_MARK, HEADER_MARK, markShapes } from '../src/client/components/brand-mark-geometry.ts';
import { PRODUCT_NAME } from '../src/shared/brand.ts';

const root = resolve(import.meta.dirname, '..');
const out = join(root, 'public/assets/brand');

/**
 * The default dark theme (src/client/styles.css): the header's own colours on its own page, so the icons are the mark
 * as the app shows it. The favicon follows the tab's scheme instead: light #3d4fd1, dark #8b9dff.
 */
const PAGE = '#0c0e12';
const ACCENT = '#8b9dff';
const TEXT = '#eef0f5';

/** The mark's drawn box on its grid: segments, stem and knob. */
const bounds = (mark) => {
  const { x, width, knob, bottom } = mark.playhead;
  const left = Math.min(mark.segments[0][0], x - width);
  const [lastX, lastWidth] = mark.segments.at(-1);
  const right = Math.max(lastX + lastWidth, x + width);
  const top = knob - width;
  return { left, top, width: right - left, height: Math.max(bottom, mark.top + mark.height) - top };
};

/**
 * The mark centred on an opaque page-coloured square, its drawn width `fill` of the side; `rx` is a fraction of the
 * side (0: full bleed, for platforms that round icons themselves).
 */
const tile = (mark, size, { fill, rx }) => {
  const box = bounds(mark);
  const side = box.width / fill;
  const viewBox = [box.left + box.width / 2 - side / 2, box.top + box.height / 2 - side / 2, side, side].map((n) => +n.toFixed(3));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
<rect width="${size}" height="${size}" rx="${size * rx}" fill="${PAGE}"/>
<svg width="${size}" height="${size}" viewBox="${viewBox.join(' ')}">${markShapes(mark, { accent: ACCENT, rest: TEXT })}</svg>
</svg>`;
};

/** One colour (the unplayed tail is the accent at 35 %), so the tab icon reads on any tab strip. */
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${FAVICON_MARK.grid} ${FAVICON_MARK.grid}">
<style>svg{color:#3d4fd1}@media (prefers-color-scheme: dark){svg{color:#8b9dff}}</style>
${markShapes(FAVICON_MARK, { accent: 'currentColor', rest: 'currentColor' })}
</svg>
`;

/**
 * The 32 px fallback is the 16 px cut on a tile with the app's 6 px radius. Apple and maskable icons are full bleed
 * (the platform rounds them) and keep the five-segment mark inside the maskable 80 % safe circle (a 0.56-wide mark
 * reaches ~35 % of the side from the centre).
 */
const rasters = [
  { file: 'favicon-32.png', size: 32, mark: FAVICON_MARK, fill: 0.84, rx: 6 / 32 },
  { file: 'apple-touch-icon.png', size: 180, mark: HEADER_MARK, fill: 0.62, rx: 0 },
  { file: 'icon-192.png', size: 192, mark: HEADER_MARK, fill: 0.56, rx: 0 },
  { file: 'icon-512.png', size: 512, mark: HEADER_MARK, fill: 0.56, rx: 0 },
];

/** Relative URLs resolve against the manifest itself, so one file serves every BASE_PATH. */
const manifest = {
  name: PRODUCT_NAME,
  short_name: PRODUCT_NAME,
  start_url: '../../',
  scope: '../../',
  display: 'browser',
  background_color: PAGE,
  theme_color: PAGE,
  icons: [
    { src: 'favicon.svg', type: 'image/svg+xml', sizes: 'any', purpose: 'any' },
    { src: 'icon-192.png', type: 'image/png', sizes: '192x192', purpose: 'maskable' },
    { src: 'icon-512.png', type: 'image/png', sizes: '512x512', purpose: 'maskable' },
  ],
};

await mkdir(out, { recursive: true });
await writeFile(join(out, 'favicon.svg'), favicon);
await writeFile(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

const executablePath = process.env.CHROME_PATH || undefined;
const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox'] });
try {
  const context = await browser.newContext({ deviceScaleFactor: 1 });
  const page = await context.newPage();
  for (const { file, size, mark, fill, rx } of rasters) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<body style="margin:0;background:transparent">${tile(mark, size, { fill, rx })}</body>`);
    await writeFile(join(out, file), await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } }));
  }
  await context.close();
} finally {
  await browser.close();
}
console.log(`wrote ${out}: favicon.svg, manifest.json, ${rasters.map((raster) => raster.file).join(', ')}`);
