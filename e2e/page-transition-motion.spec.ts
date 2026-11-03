import { expect, type Page, test } from '@playwright/test';

import { gotoHydrated, serveApp } from './support.ts';
import {
  landed,
  largestOverlap,
  lowestCoverage,
  recordTransitionFrames,
  routePosters,
  suiteLibrary,
  transitionFrames,
  type TransitionFrames,
} from './transition-frames.ts';

const REPLAY = 'demo-shop';

async function replayLibrary(page: Page, base: string) {
  await routePosters(page, REPLAY);
  await gotoHydrated(page, base);
  // why: grid cards lift on hover and press, the motion a returning card can still be easing out of.
  await page.getByRole('group', { name: 'Layout', exact: true }).getByRole('button', { name: 'Grid', exact: true }).click();
  const card = page.locator(`.feed-list [data-entry-id="session:${REPLAY}"]`).first();
  await expect(card.locator('.poster > img').first()).toHaveJSProperty('complete', true);
  await page.evaluate(recordTransitionFrames);
  return card.locator('a.row-target');
}

/** The replay picture's frames while its spring runs. */
const heroFrames = (record: TransitionFrames | undefined) =>
  (record?.frames ?? []).flatMap((frame) => frame.layers.filter((layer) => layer.name === 'vt-page-hero' && layer.running));

const server = serveApp({ REPLAYS_SSR: '1' });

test('suite sheets stay opaque while their pictures crossfade into the tiles', async ({ page }) => {
  const { link } = await suiteLibrary(page, server().origin);
  await page.evaluate(recordTransitionFrames);
  await link.click();
  await expect(page.locator('.ct-tile iframe')).toHaveCount(4);
  await landed(page);
  const [opening] = await transitionFrames(page);
  if (!opening) throw new Error('Expected the opening transition');
  const { lowest, crossfading } = lowestCoverage(opening);
  expect(crossfading).toBeGreaterThan(0);
  expect(lowest).toBeGreaterThan(0.97);
});

test('suite sheets stay opaque while their pictures crossfade back into the stack', async ({ page }) => {
  const { link } = await suiteLibrary(page, server().origin);
  await link.click();
  await expect(page.locator('.ct-tile iframe')).toHaveCount(4);
  await landed(page);
  await page.evaluate(recordTransitionFrames);
  await page.mouse.move(0, 0);
  await page.goBack();
  await expect(link).toBeVisible();
  await landed(page);
  const [returning] = await transitionFrames(page);
  if (!returning) throw new Error('Expected the returning transition');
  const { lowest, crossfading } = lowestCoverage(returning);
  expect(crossfading).toBeGreaterThan(0);
  expect(lowest).toBeGreaterThan(0.97);
});

test('suite sheets separate steadily once they leave the stack', async ({ page }) => {
  const { link } = await suiteLibrary(page, server().origin);
  await page.evaluate(recordTransitionFrames);
  await link.click();
  await expect(page.locator('.ct-tile iframe')).toHaveCount(4);
  await landed(page);
  const [opening] = await transitionFrames(page);
  const flying = (opening?.frames ?? [])
    .map((frame) => frame.layers.filter((layer) => layer.running))
    .filter((layers) => layers.length === 4);
  expect(flying.length).toBeGreaterThan(5);
  // why: grown in step with their spread and overshooting together, the sheets crossed again as they landed.
  let widest = Number.POSITIVE_INFINITY;
  for (const layers of flying) {
    const progress = Math.max(...layers.map((layer) => layer.progress));
    const overlap = largestOverlap(layers);
    if (progress > 0.3) expect(overlap).toBeLessThanOrEqual(widest + 1);
    if (progress > 0.3) widest = Math.min(widest, overlap);
  }
  expect(largestOverlap(flying.at(-1) ?? [])).toBeLessThan(1);
});

test('suite sheets land exactly on their tiles', async ({ page }) => {
  const { link } = await suiteLibrary(page, server().origin);
  await page.evaluate(recordTransitionFrames);
  await link.click();
  await expect(page.locator('.ct-tile iframe')).toHaveCount(4);
  await landed(page);
  const [opening] = await transitionFrames(page);
  const last = opening?.frames.filter((frame) => frame.layers.length === 4).at(-1)?.layers ?? [];
  const tiles = await page.locator('.ct-tile .ct-picture').evaluateAll((pictures) =>
    pictures.map((picture) => {
      const { x, y, width, height } = picture.getBoundingClientRect();
      return { x, y, width, height };
    }),
  );
  expect(last).toHaveLength(4);
  for (const layer of last) {
    const tile = tiles.find((candidate) => Math.abs(candidate.x - layer.rect.x) < 20 && Math.abs(candidate.y - layer.rect.y) < 20);
    if (!tile) throw new Error(`No tile under ${layer.name}`);
    for (const key of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(layer.rect[key] - tile[key])).toBeLessThan(1);
  }
});

test('a cold replay open lands its picture on the player before the transition ends', async ({ page }) => {
  const link = await replayLibrary(page, server().origin);
  await link.click();
  await expect(page.locator('.player-host iframe')).toBeAttached();
  const [opening] = await transitionFrames(page);
  const frames = heroFrames(opening);
  const last = frames.at(-1);
  const player = await page.locator('.player-frame').boundingBox();
  if (!last || !player) throw new Error('Expected the replay picture to fly into the player');
  // why: a destination swapped mid-flight aborts the transition with the picture still part of the way there.
  expect(Math.abs(last.rect.width - player.width)).toBeLessThan(player.width * 0.03);
  expect(Math.abs(last.rect.x - player.x)).toBeLessThan(6);
});

test('Back moves the replay picture along its spring from the first frame', async ({ page }) => {
  const link = await replayLibrary(page, server().origin);
  await link.click();
  await expect(page.locator('.player-host iframe')).toBeAttached();
  await landed(page);
  // why: Back by key or gesture leaves the pointer over the card, whose hover motion resumes when the library returns.
  await page.goBack();
  await expect(link).toBeVisible();
  await landed(page);
  const returning = (await transitionFrames(page)).at(-1);
  const frames = heroFrames(returning).filter((layer) => layer.expectedScale !== undefined);
  expect(frames.length).toBeGreaterThan(4);
  // why: while the returning card still eased out of its press, the picture held its size and then jumped.
  for (const layer of frames) expect(Math.abs(layer.scale - (layer.expectedScale ?? 0))).toBeLessThan(0.02);
});

test('Back pressed while a replay opens starts from where its picture is', async ({ page }) => {
  const link = await replayLibrary(page, server().origin);
  await link.click();
  await expect.poll(() => transitionFrames(page).then((records) => heroFrames(records[0]).length)).toBeGreaterThan(3);
  await page.goBack();
  await expect(link).toBeVisible();
  await landed(page);
  const [opening, returning] = await transitionFrames(page);
  const left = opening?.skipped?.find((layer) => layer.name === 'vt-page-hero');
  const resumed = heroFrames(returning)[0];
  if (!left || !resumed) throw new Error('Expected the picture in flight both ways');
  // why: a skipped transition used to land the picture first, so Back began from the full-size player.
  expect(Math.abs(resumed.rect.x - left.rect.x)).toBeLessThan(16);
  expect(Math.abs(resumed.rect.width - left.rect.width)).toBeLessThan(left.rect.width * 0.08);
});

test('an interrupted Back to a card with a looping animation leaves the next open usable', async ({ page }) => {
  const link = await replayLibrary(page, server().origin);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // why: a looping animation (a pulse, a hover preview) cannot be finished; holding the returning card once tried to.
  await link.evaluate((element) => element.closest('.feed-item')?.animate({ opacity: [1, 0.99] }, { duration: 400, iterations: Infinity }));
  await link.click();
  await expect.poll(() => transitionFrames(page).then((records) => heroFrames(records[0]).length)).toBeGreaterThan(3);
  await page.goBack();
  await expect(link).toBeVisible();
  await landed(page);
  await link.click();
  await expect(page.locator('.player-host iframe')).toBeAttached();
  await landed(page);
  expect(errors).toEqual([]);
});
