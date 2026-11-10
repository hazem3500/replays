import { expect, type Locator, type Page, test } from '@playwright/test';

import { createSuite, gotoHydrated, serveApp, uniqueId, COMPARE_SUITE_PROFILE, compareSuiteEnv } from './support.ts';
import { landed, routePosters } from './transition-frames.ts';

const RUNS = 6;
/** The rear sheets an index stack shows (src/client/index/suite-stack.ts), behind its front poster. */
const SHOWN_SHEETS = 3;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
/** A picture named for a page transition: the tile or the stack depth it belongs to. */
interface Named {
  name: string;
  tile: string | undefined;
  depth: number;
  rect: Box;
}
/** One picture's flying group on one frame, with the boxes its own keyframes start and end at. */
interface Layer {
  name: string;
  running: boolean;
  progress: number;
  zIndex: number;
  rect: Box;
  from: Box;
  to: Box;
  opacity: { from: number; to: number };
}
interface Flight {
  before: Named[];
  after: Named[];
  frames: Layer[][];
}
declare global {
  interface Window {
    stackFlights?: Flight[];
  }
}

/** Records every page transition: its named pictures on both sides and every flying picture group on every frame. */
function installFlightProbe() {
  const root = document.documentElement;
  const group = /^::view-transition-group\((vt-page-sheet-[^)]+)\)$/;
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- why: page.evaluate runs this alone, without the module scope.
  const named = (): Named[] =>
    [...document.querySelectorAll<HTMLElement>('[style*="view-transition-name: vt-page-sheet-"]')].map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        name: element.style.viewTransitionName,
        tile: element.closest<HTMLElement>('[data-tile-id]')?.dataset.tileId,
        depth: Number(element.closest<HTMLElement>('[data-stack-depth]')?.dataset.stackDepth ?? 0),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      };
    });
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- why: page.evaluate runs this alone, without the module scope.
  const boxOf = (transform: string, width: number, height: number): Box => {
    const matrix = transform === 'none' ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(transform);
    return { x: matrix.e, y: matrix.f, width: width * matrix.a, height: height * matrix.d };
  };
  const layers = () => {
    const found: Layer[] = [];
    for (const animation of document.getAnimations()) {
      const { effect } = animation;
      if (!(effect instanceof KeyframeEffect)) continue;
      const name = group.exec(effect.pseudoElement ?? '')?.[1];
      const frames = effect.getKeyframes();
      const [first, last] = [frames[0], frames.at(-1)];
      if (!name || typeof first?.transform !== 'string' || typeof last?.transform !== 'string') continue;
      const style = getComputedStyle(root, `::view-transition-group(${name})`);
      const [width, height] = [Number.parseFloat(style.width), Number.parseFloat(style.height)];
      found.push({
        name,
        running: animation.playState === 'running',
        progress: effect.getComputedTiming().progress ?? 0,
        zIndex: Number(style.zIndex),
        rect: boxOf(style.transform, width, height),
        from: boxOf(first.transform, width, height),
        to: boxOf(last.transform, width, height),
        opacity: { from: Number(first.opacity ?? 1), to: Number(last.opacity ?? 1) },
      });
    }
    return found;
  };
  const flights: Flight[] = [];
  window.stackFlights = flights;
  const start = document.startViewTransition.bind(document);
  document.startViewTransition = (update) => {
    const flight: Flight = { before: named(), after: [], frames: [] };
    flights.push(flight);
    const transition = start(async () => {
      if (typeof update !== 'function') throw new Error('Expected a navigation commit callback');
      await update();
      flight.after = named();
    });
    let done = false;
    const sample = () => {
      if (done) return;
      flight.frames.push(layers());
      requestAnimationFrame(sample);
    };
    void transition.ready.then(
      () => requestAnimationFrame(sample),
      () => {},
    );
    void transition.finished.finally(() => {
      done = true;
    });
    return transition;
  };
}

/** A six-run suite on the index, its posters loaded and opened once so the next open is a warm one. */
async function sixRunSuite(page: Page, base: string, layout?: 'List' | 'Grid') {
  const suiteId = uniqueId('stack-overflow');
  const ids = Array.from({ length: RUNS }, (_, index) => `${suiteId}-${index}`);
  await createSuite(
    page.request,
    base,
    suiteId,
    ids.map((replayId, index) => ({ id: `run-${index}`, label: `Browser ${index + 1}`, status: 'passed' as const, replayId })),
    undefined,
    { profile: COMPARE_SUITE_PROFILE },
  );
  await routePosters(page, suiteId);
  await gotoHydrated(page, base);
  if (layout) await page.getByRole('group', { name: 'Layout', exact: true }).getByRole('button', { name: layout, exact: true }).click();
  const card = page.locator(`[data-entry-id="suite:${suiteId}"]`);
  await expect(card.locator('.poster > img').first()).toHaveJSProperty('complete', true);
  await expect(page.locator('html')).not.toHaveAttribute('data-feed-transition', /.+/);
  const link = card.locator('a.row-target');
  await link.click();
  await expect(page.locator('.ct-tile iframe')).toHaveCount(RUNS);
  await landed(page);
  await page.goBack();
  await expect(link).toBeVisible();
  await landed(page);
  return { card, link };
}

const flights = (page: Page) => page.evaluate(() => window.stackFlights ?? []);

/** The comparison tiles a viewer can see, by recording, with their pictures' boxes. */
const shownTiles = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.ct-tile[data-tile-id]')].flatMap((tile) => {
      const picture = tile.querySelector('.ct-picture')?.getBoundingClientRect();
      const visible = picture && picture.width > 0 && picture.right > 0 && picture.left < innerWidth && picture.bottom > 0;
      if (tile.dataset.role === 'hidden' || !visible) return [];
      return [{ id: tile.dataset.tileId ?? '', rect: { x: picture.x, y: picture.y, width: picture.width, height: picture.height } }];
    }),
  );

const KEYS = ['x', 'y', 'width', 'height'] as const;
const distance = (a: Box, b: Box) => Math.max(...KEYS.map((key) => Math.abs(a[key] - b[key])));

function expectNear(actual: Box, expected: Box) {
  expect(distance(actual, expected)).toBeLessThan(1);
}

/** How far a frame's mean flight progress is from halfway. */
const offMiddle = (frame: Layer[]) => Math.abs(frame.reduce((sum, layer) => sum + layer.progress, 0) / frame.length - 0.5);

/** On its middle frame, each named picture flies inside the span from its start box to its end box, at neither end. */
function expectMidFlight(flight: Flight, names: readonly string[]) {
  const complete = flight.frames.filter((frame) => names.every((name) => frame.some((layer) => layer.name === name && layer.running)));
  expect(complete.length, 'frames where every picture flies').toBeGreaterThan(0);
  const frame = complete.toSorted((a, b) => offMiddle(a) - offMiddle(b))[0] ?? [];
  for (const name of names) {
    const layer = frame.find((candidate) => candidate.name === name);
    if (!layer) throw new Error(`Missing flying picture ${name}`);
    for (const key of KEYS) {
      expect(layer.rect[key], `${name} ${key}`).toBeGreaterThanOrEqual(Math.min(layer.from[key], layer.to[key]) - 2);
      expect(layer.rect[key], `${name} ${key}`).toBeLessThanOrEqual(Math.max(layer.from[key], layer.to[key]) + 2);
    }
    expect(distance(layer.rect, layer.from), `${name} left its start`).toBeGreaterThan(2);
    expect(distance(layer.rect, layer.to), `${name} has not landed yet`).toBeGreaterThan(2);
  }
  return frame;
}

/** The first frame's layer of each name: where every flight starts and ends, and how deep it flies. */
function layersOf(flight: Flight) {
  const first = new Map<string, Layer>();
  for (const frame of flight.frames) for (const layer of frame) if (!first.has(layer.name)) first.set(layer.name, layer);
  return first;
}

async function expectAtRest(page: Page) {
  await landed(page);
  await expect(page.locator('[style*="view-transition-name: vt-page-sheet-"]')).toHaveCount(0);
  await expect(page.locator('style[data-page-hero-canvas]')).toHaveCount(0);
  const flying = await page.evaluate(() =>
    document
      .getAnimations()
      .flatMap(({ effect, playState }) =>
        effect instanceof KeyframeEffect && effect.pseudoElement?.startsWith('::view-transition') ? [playState] : [],
      ),
  );
  expect(flying.filter((state) => state === 'running')).toEqual([]);
}

/** Opens the suite and checks every shown tile flew there, past-the-stack runs from under its deepest shown sheet. */
async function openAndCheck(page: Page, link: Locator) {
  await page.evaluate(installFlightProbe);
  await link.click();
  await expect(page.locator('.ct-tile iframe')).toHaveCount(RUNS);
  await expectAtRest(page);
  const tiles = await shownTiles(page);
  const [opening] = await flights(page);
  if (!opening) throw new Error('Expected the opening transition');
  const names = tiles.map(({ id }) => opening.after.find((picture) => picture.tile === id)?.name ?? `unnamed ${id}`);
  expectMidFlight(opening, names);
  const layers = layersOf(opening);
  for (const [index, tile] of tiles.entries()) {
    const layer = layers.get(names[index] ?? '');
    if (!layer) throw new Error(`Missing flight for ${tile.id}`);
    expectNear(layer.to, tile.rect);
  }
  const extras = names.filter((candidate) => !opening.before.some((picture) => picture.name === candidate));
  const deepest = opening.before.toSorted((a, b) => b.depth - a.depth)[0];
  const deepestLayer = layers.get(deepest?.name ?? '');
  for (const name of extras) {
    const layer = layers.get(name);
    if (!layer || !deepestLayer) throw new Error(`Missing flight for ${name} or the deepest shown sheet`);
    expectNear(layer.from, deepestLayer.from);
    expect(layer.zIndex).toBeLessThan(deepestLayer.zIndex);
    expect(layer.opacity.from).toBe(0);
  }
  return { tiles, opening };
}

/** Returns to the index and checks every shown tile flew back, past-the-stack runs into the deepest shown sheet. */
async function returnAndCheck(page: Page, link: Locator, tiles: Awaited<ReturnType<typeof shownTiles>>) {
  await page.mouse.move(0, 0);
  await page.goBack();
  await expect(link).toBeVisible();
  await expectAtRest(page);
  const returning = (await flights(page))[1];
  if (!returning) throw new Error('Expected the return transition');
  const names = tiles.map(({ id }) => returning.before.find((picture) => picture.tile === id)?.name ?? `unnamed ${id}`);
  expectMidFlight(returning, names);
  const layers = layersOf(returning);
  const deepest = returning.after.toSorted((a, b) => b.depth - a.depth)[0];
  if (!deepest) throw new Error('Expected the deepest shown sheet to receive its run');
  for (const name of names.filter((candidate) => !returning.after.some((picture) => picture.name === candidate))) {
    const layer = layers.get(name);
    if (!layer) throw new Error(`Missing flight for ${name}`);
    expectNear(layer.to, deepest.rect);
    expect(layer.opacity.to).toBe(0);
  }
}

const server = serveApp(() => ({ REPLAYS_SSR: '1', ...compareSuiteEnv() }));

test.describe('a suite with more runs than its stack shows', () => {
  for (const layout of ['List', 'Grid'] as const) {
    test(`${layout} flies every run to its tile and back, the extra ones from under the deepest sheet`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      const { card, link } = await sixRunSuite(page, server().origin, layout);
      await expect(card.locator('[data-stack-depth]:not([data-stack-reserve])')).toHaveCount(SHOWN_SHEETS);
      const { tiles, opening } = await openAndCheck(page, link);
      expect(tiles).toHaveLength(RUNS);
      expect(opening.before).toHaveLength(SHOWN_SHEETS + 1);
      await returnAndCheck(page, link, tiles);
    });
  }
});

test.describe('a suite with more runs than its stack shows, on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('flies the one shown tile in and back, and leaves the rest at rest', async ({ page }) => {
    const { link } = await sixRunSuite(page, server().origin);
    const { tiles } = await openAndCheck(page, link);
    expect(tiles).toHaveLength(1);
    await returnAndCheck(page, link, tiles);
  });
});
