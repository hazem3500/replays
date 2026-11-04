import { expect, type Locator, type Page, test } from '@playwright/test';

import { createSuite, gotoHydrated, serveApp, uniqueId } from './support.ts';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface Picture {
  id: string;
  name: string;
  depth: number;
  filter: string;
  rect: Box;
}
interface Geometry {
  name: string;
  rect: Box;
  moving: boolean;
  resizing: boolean;
}
interface Capture {
  before: Picture[];
  after: Picture[];
  geometry: Geometry[];
}
declare global {
  interface Window {
    recordingNavigationSnapshots: Capture[];
  }
}

function cardGeometry(card: HTMLElement) {
  const front = card.querySelector('.suite-sheet > .shuffle-window > .poster:not(.poster-outgoing), .stack-front > .poster');
  const body = card.querySelector('.feed-body');
  if (!front || !body) throw new Error('Expected the suite thumbnail and information');
  const a = front.getBoundingClientRect();
  const b = body.getBoundingClientRect();
  return {
    frontRect: { x: a.x, y: a.y, width: a.width, height: a.height },
    bodyRect: { x: b.x, y: b.y, width: b.width, height: b.height },
    text: body.textContent,
  };
}

async function warmSuite(page: Page, card: Locator, link: Locator) {
  await link.click();
  await expect(page.locator('.ct-tile[data-current] iframe')).toBeAttached();
  await page.mouse.move(0, 0);
  await page.goBack();
  await expect(link).toBeVisible();
  await expect(page.locator('html')).not.toHaveAttribute('data-page-transition', /.+/);
  const images = card.locator('.poster > img');
  await expect
    .poll(() =>
      images.evaluateAll((nodes) => {
        for (const image of nodes) if (!(image instanceof HTMLImageElement) || !image.complete || image.naturalWidth === 0) return false;
        return true;
      }),
    )
    .toBe(true);
}

function installRecordingProbe() {
  const root = document;
  function pictures() {
    return [...root.querySelectorAll<HTMLElement>('[style*="view-transition-name: vt-page-sheet-"]')].map((element) => {
      const rect = element.getBoundingClientRect();
      const tile = element.closest<HTMLElement>('[data-tile-id]');
      const sheet = element.closest<HTMLElement>('[data-replay-id]');
      return {
        id: tile?.dataset.tileId ?? sheet?.dataset.replayId ?? '',
        name: element.style.viewTransitionName,
        depth: Number(sheet?.dataset.stackDepth ?? 0),
        filter: getComputedStyle(element).filter,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      };
    });
  }
  const start = root.startViewTransition.bind(root);
  window.recordingNavigationSnapshots = [];
  root.startViewTransition = (update) => {
    const capture: Capture = { before: pictures(), after: [], geometry: [] };
    window.recordingNavigationSnapshots.push(capture);
    const transition = start(async () => {
      if (typeof update !== 'function') throw new Error('Expected a navigation commit callback');
      await update();
      capture.after = pictures();
    });
    void transition.ready.then(() =>
      requestAnimationFrame(() => {
        for (const animation of root.getAnimations()) {
          if (animation.playState === 'finished' || animation.playState === 'idle') continue;
          const effect = animation.effect;
          if (!(effect instanceof KeyframeEffect)) continue;
          const match = /^::view-transition-group\((vt-page-sheet-[^)]+)\)$/.exec(effect.pseudoElement ?? '');
          if (!match?.[1]) continue;
          const frames = effect.getKeyframes();
          const last = frames.at(-1)?.transform;
          if (typeof last !== 'string') continue;
          const style = getComputedStyle(root.documentElement, effect.pseudoElement);
          const matrix = new DOMMatrix(last);
          let resizing = false;
          for (const frame of frames) if ('width' in frame || 'height' in frame) resizing = true;
          capture.geometry.push({
            name: match[1],
            moving: frames[0]?.transform !== last,
            resizing,
            rect: {
              x: matrix.e,
              y: matrix.f,
              width: Number.parseFloat(style.width) * matrix.a,
              height: Number.parseFloat(style.height) * matrix.d,
            },
          });
        }
      }),
    );
    return transition;
  };
}

async function suiteCard(page: Page, base: string, layout: string) {
  const suiteId = uniqueId('navigation-sheet');
  const ids = Array.from({ length: 4 }, (_, index) => `${suiteId}-${index}`);
  await createSuite(
    page.request,
    base,
    suiteId,
    ids.map((replayId, index) => ({
      id: `run-${index}`,
      label: `Browser ${index + 1}`,
      status: 'passed' as const,
      replayId,
    })),
  );
  await page.route(`**/api/replays/${suiteId}-*/poster?*`, (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="#eee"/></svg>',
    }),
  );
  await gotoHydrated(page, base);
  await page.getByRole('group', { name: 'Layout', exact: true }).getByRole('button', { name: layout, exact: true }).click();
  const card = page.locator(`[data-entry-id="suite:${suiteId}"]`);
  await expect(page.locator('.feed-list').filter({ has: card })).toHaveAttribute('data-view', layout.toLowerCase());
  await expect(page.locator('html')).not.toHaveAttribute('data-feed-transition', /.+/);
  const link = card.locator('a.row-target');
  await warmSuite(page, card, link);
  return { card, link, ids };
}

function expectRect(actual: Box, expected: Box) {
  for (const key of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(actual[key] - expected[key])).toBeLessThan(1);
}

function expectIdentityPairs(capture: Capture, ids: string[]) {
  expect(capture.before.map((picture) => picture.id).toSorted()).toEqual(ids.toSorted());
  expect(capture.after.map((picture) => picture.id).toSorted()).toEqual(ids.toSorted());
  expect(new Set(capture.after.map((picture) => `${picture.rect.x}:${picture.rect.y}`)).size).toBe(4);
  for (const source of capture.before) {
    const destination = capture.after.find((picture) => picture.id === source.id);
    const geometry = capture.geometry.find((layer) => layer.name === source.name);
    if (!destination || !geometry) throw new Error(`Missing paired recording ${source.id}`);
    expect(destination.name).toBe(source.name);
    expect(geometry).toMatchObject({ moving: true, resizing: false });
    expectRect(geometry.rect, destination.rect);
  }
}

test.describe('suite recording navigation', () => {
  const server = serveApp({ REPLAYS_SSR: '1' });
  for (const layout of ['List', 'Grid']) {
    test(`${layout} sends every stack sheet to its own recording and returns it to its original depth`, async ({ page }) => {
      const { card, link, ids } = await suiteCard(page, server().origin, layout);
      await page.evaluate(() => {
        document.documentElement.dataset.theme = 'dark';
      });
      const original = await card.evaluate(cardGeometry);
      await page.evaluate(installRecordingProbe);
      await link.focus();
      await page.keyboard.press('Enter');
      await expect(page.locator('.ct-tile iframe')).toHaveCount(4);
      await expect(page.locator('html')).not.toHaveAttribute('data-page-transition', /.+/);
      const opening = await page.evaluate(() => window.recordingNavigationSnapshots[0]);
      if (!opening) throw new Error('Expected the opening capture');
      expectIdentityPairs(opening, ids);
      const focused = page.locator('.ct-tile[data-current]');
      const frame = () => focused.evaluate((tile) => getComputedStyle(tile, '::after').boxShadow);
      await expect.poll(frame).toContain('2.5px');
      await page.keyboard.press('Tab');
      await focused.locator('.ct-hit').focus();
      await expect.poll(frame).toMatch(/(inset.*){3}/);
      await page.goBack();
      await expect(link).toBeVisible();
      await expect(page.locator('html')).not.toHaveAttribute('data-page-transition', /.+/);
      const captures = await page.evaluate(() => window.recordingNavigationSnapshots);
      expect(captures).toHaveLength(2);
      const returning = captures[1];
      if (!returning) throw new Error('Expected the return capture');
      expectIdentityPairs(returning, ids);
      expect(returning.after.find((picture) => picture.depth === 0)?.filter).toBe('none');
      await expect(card.locator('.shuffle-window > .poster:not(.poster-outgoing) > img, .stack-front > .poster > img')).toHaveCSS(
        'filter',
        'none',
      );
      for (const source of opening.before) {
        const restored = returning.after.find((picture) => picture.id === source.id);
        if (!restored) throw new Error(`Missing restored sheet ${source.id}`);
        expect(restored.depth).toBe(source.depth);
        expectRect(restored.rect, source.rect);
      }
      expect(await card.evaluate(cardGeometry)).toEqual(original);
      await expect(page.locator('[style*="view-transition-name: vt-page-sheet-"]')).toHaveCount(0);
      await expect(page.locator('style[data-page-hero-canvas]')).toHaveCount(0);
    });
  }
});
