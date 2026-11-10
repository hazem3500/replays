import { expect, type Locator, type Page, test } from '@playwright/test';

import { gotoHydrated, serveApp, compareSuiteEnv } from './support.ts';
import { landed, suiteLibrary } from './transition-frames.ts';

interface TileFrame {
  opacity: number;
  shadow: string;
  focused: boolean;
}
interface Sample {
  phase: string;
  tiles: TileFrame[];
}
interface FrameProbe {
  read: () => TileFrame[];
  samples: Sample[];
  atStart: TileFrame[][];
}
declare global {
  interface Window {
    frameProbe?: FrameProbe;
  }
}

/** Records each run-colour frame (`.ct-tile::after`) on every animation frame, and as every view transition begins. */
function installFrameProbe() {
  const root = document.documentElement;
  const read = (): TileFrame[] =>
    [...root.querySelectorAll('.ct-tile')].flatMap((tile) => {
      const style = getComputedStyle(tile, '::after');
      if (style.content === 'none') return [];
      return [{ opacity: Number(style.opacity), shadow: style.boxShadow, focused: tile.hasAttribute('data-focused') }];
    });
  const probe: FrameProbe = { read, samples: [], atStart: [] };
  window.frameProbe = probe;
  const start = document.startViewTransition.bind(document);
  document.startViewTransition = (update) => {
    probe.atStart.push(read());
    return start(update);
  };
  const sample = () => {
    probe.samples.push({ phase: root.dataset.pageTransition ?? 'none', tiles: read() });
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
}

const probed = (page: Page) =>
  page.evaluate(() => ({ samples: window.frameProbe?.samples ?? [], atStart: window.frameProbe?.atStart ?? [] }));

/** The rendered run colour of every tile, in tile order, as the frame's box-shadow spells it. */
const tileColours = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.ct-tile')].map((tile) => {
      const swatch = document.createElement('span');
      swatch.style.color = 'var(--tile)';
      tile.append(swatch);
      const colour = getComputedStyle(swatch).color;
      swatch.remove();
      return colour;
    }),
  );

const frames = (page: Page) => page.evaluate(() => window.frameProbe?.read() ?? []);

const frameOpacities = async (page: Page) => (await frames(page)).map((tile) => tile.opacity);

/** The keyboard ring's box lives on the tile's `::after`; `evaluate` serializes this, so it reads the tile itself. */
const ringOf = (ring: Locator) =>
  ring.evaluate((tile) => ({
    opacity: getComputedStyle(tile, '::after').opacity,
    shadow: getComputedStyle(tile, '::after').boxShadow,
  }));

const server = serveApp(() => ({ REPLAYS_SSR: '1', ...compareSuiteEnv() }));

test.describe('comparison tile frames during page transitions', () => {
  test('stay hidden while the sheets fly into their tiles, then fade in once they have landed', async ({ page }) => {
    const { link } = await suiteLibrary(page, server().origin);
    await page.evaluate(installFrameProbe);
    await link.click();
    await expect(page.locator('.ct-tile iframe')).toHaveCount(4);
    await landed(page);
    const { samples } = await probed(page);
    const flying = samples.filter((sample) => sample.phase === 'motion-page' && sample.tiles.length === 4);
    expect(flying.length).toBeGreaterThan(0);
    for (const sample of flying) for (const tile of sample.tiles) expect(tile.opacity).toBe(0);
    await expect.poll(() => frameOpacities(page)).toEqual([1, 1, 1, 1]);
    const [colours, landedFrames] = [await tileColours(page), await frames(page)];
    for (const [index, tile] of landedFrames.entries()) expect(tile.shadow).toContain(colours[index] ?? 'missing');
    expect(landedFrames.filter((tile) => tile.focused)).toHaveLength(1);
    expect(landedFrames.find((tile) => tile.focused)?.shadow).toContain('2.5px');
  });

  test('draw the keyboard ring above the colour frame once landed', async ({ page }) => {
    const { link } = await suiteLibrary(page, server().origin);
    await page.evaluate(installFrameProbe);
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.ct-tile iframe')).toHaveCount(4);
    await landed(page);
    await page.keyboard.press('Tab');
    await page.locator('.ct-tile[data-current] .ct-hit').focus();
    const ring = page.locator('.ct-tile:has(> .ct-hit:focus-visible)');
    await expect(ring).toHaveCount(1);
    await expect.poll(() => ringOf(ring)).toMatchObject({ opacity: '1', shadow: expect.stringMatching(/(inset.*){3}/) });
  });

  test('fade out before the sheets fly back to the index', async ({ page }) => {
    const { link } = await suiteLibrary(page, server().origin);
    await link.click();
    await expect(page.locator('.ct-tile iframe')).toHaveCount(4);
    await landed(page);
    await page.evaluate(installFrameProbe);
    await expect.poll(() => frameOpacities(page)).toEqual([1, 1, 1, 1]);
    await page.mouse.move(0, 0);
    await page.goBack();
    await expect(link).toBeVisible();
    await landed(page);
    const { samples, atStart } = await probed(page);
    expect(atStart).toHaveLength(1);
    expect(atStart[0]).toHaveLength(4);
    for (const tile of atStart[0] ?? []) expect(tile.opacity).toBe(0);
    for (const sample of samples.filter((candidate) => candidate.phase === 'motion-page'))
      for (const tile of sample.tiles) expect(tile.opacity).toBe(0);
  });

  test('show at once with reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const { link } = await suiteLibrary(page, server().origin);
    await page.evaluate(installFrameProbe);
    await link.click();
    await expect(page.locator('.ct-tile iframe')).toHaveCount(4);
    await expect.poll(() => frameOpacities(page)).toEqual([1, 1, 1, 1]);
    const { samples } = await probed(page);
    for (const sample of samples) for (const tile of sample.tiles) expect(tile.opacity).toBe(1);
  });

  test('show at once on a direct load', async ({ page }) => {
    const { link } = await suiteLibrary(page, server().origin);
    const href = await link.getAttribute('href');
    if (!href) throw new Error('Expected the suite link address');
    await gotoHydrated(page, new URL(href, server().origin).href);
    await page.evaluate(installFrameProbe);
    await expect(page.locator('.ct-tile iframe')).toHaveCount(4);
    await expect.poll(() => frameOpacities(page)).toEqual([1, 1, 1, 1]);
  });
});
